'use strict'

const requirePatch = require('../require-patch')
const shimmer = require('ximmer')
const semver = require('semver')
const ao = require('..')
const Sanitizer = ao.addon.Sanitizer
const conf = ao.probes['cassandra-driver']


const logMissing = ao.makeLogMissing('cassandra-driver')

module.exports = function (cassandra) {
  // Create reversed map of consistencies back to their names
  const types = cassandra.types || {}
  const consistencies = {}

  if (types.consistencies) {
    Object.keys(types.consistencies).forEach(name => {
      const value = types.consistencies[name]
      if (typeof value === 'number') {
        consistencies[value] = name
      }
    })
  }

  // prior to v3.2.2 need to load request-handler. (sendOnConnection, this.connection)
  // after v3.3.0 need to load request-execution (_sendOnConnection, this._connection)
  //*
  requirePatch.disable()
  let pkg
  try {
    pkg = requirePatch.relativeRequire('cassandra-driver/package')
  } catch (e) {
    pkg = {version: '0.0.0'}
  }
  requirePatch.enable()

  // not all of these are needed for all versions
  const handlerPath = 'cassandra-driver/lib/request-handler'
  const executionPath = 'cassandra-driver/lib/request-execution'
  const prepareHandlerPath = 'cassandra-driver/lib/prepare-handler'
  // set these to defaults for the most recent version to favor
  // current software
  let sendOnConnection = '_sendOnConnection'
  let connection = '_connection'
  let version

  if (semver.satisfies(pkg.version, '>=3.3.0')) {
    version = '>=3.3.0'
  } else if (semver.satisfies(pkg.version, '>=3.2.0')) {
    version = '>=3.2.0'
    connection = 'connection'
  } else {
    version = '<3.2.0'
    sendOnConnection = 'sendOnConnection'
    connection = 'connection'
  }

  // RequestHandler is needed by all versions
  let RequestHandler
  try {
    RequestHandler = requirePatch.relativeRequire(handlerPath)
  }
  catch (e) {
    ao.loggers.patching('probe.cassandra-driver could not require', handlerPath)
  }

  let RequestExecution
  let PrepareHandler
  if (version === '>=3.3.0') {
    try {
      RequestExecution = requirePatch.relativeRequire(executionPath)
      PrepareHandler = requirePatch.relativeRequire(prepareHandlerPath)
      // don't patch unless both require's succeed.
      patchSendOnConnection(
        RequestExecution.prototype,
        sendOnConnection,
        connection
      )
      patchPrepareHandler(PrepareHandler)
    } catch (e) {
      ao.loggers.patching('probe.cassandra-driver failed to patch >=3.3.0')
    }
  } else {
    patchSendOnConnection(RequestHandler, sendOnConnection, connection)
  }

  if (cassandra.Client && cassandra.Client.prototype) {
    patchClient(cassandra.Client.prototype, consistencies)
  } else {
    logMissing('Client.prototype')
  }

  return cassandra
}

function patchSendOnConnection (where, sendName, connName) {
  if (typeof where[sendName] !== 'function') {
    logMissing(sendName + '()')
    return
  }
  shimmer.wrap(where, sendName, method => function () {
    const last = ao.lastSpan;
    if (last && conf.enabled && this[connName]) {
      const {address, port} = this[connName]
      last.info({RemoteHost: `${address}:${port}`})
    }
    return method.apply(this, arguments)
  })
}

function patchPrepareHandler (prepareHandler) {
  if (typeof prepareHandler.getPrepared !== 'function') {
    logMissing('PrepareHandler.getPrepared()')
    return
  }

  shimmer.wrap(prepareHandler, 'getPrepared', cb => function (...args) {
    if (args.length) {
      args.push(ao.bind(args.pop()))
    }
    return cb.apply(this, args)
  })
}

//
// patch connect
//
function patchClientConnect (client) {
  if (typeof client.connect !== 'function') {
    logMissing('client.connect()')
    return
  }
  shimmer.wrap(client, 'connect', method => function (...args) {
    // if there is a callback and context then bind the callback
    if (args.length && ao.lastEvent) {
      args.push(ao.bind(args.pop()))
    }
    return method.apply(this, args)
  })
}

function normalizeArgs (query, params, options) {
  return [
    query,
    params || [],
    options || {}
  ]
}

function serializeList (list) {
  return JSON.stringify(list.map(trim(1000)))
}

//
// patch stream which is an event emitter and doesn't use callbacks.
//
function patchClientStream (client, consistencies) {
  if (typeof client.stream !== 'function') {
    logMissing('client.stream()')
    return
  }

  shimmer.wrap(client, 'stream', stream => function (...args) {
    // bind the emitter that stream returns
    return ao.bindEmitter(stream.apply(this, args))
  })
}

function patchClientInnerExecute (client, consistencies) {
  if (typeof client._innerExecute !== 'function') {
    logMissing('client._innerExecute()')
    return
  }
  shimmer.wrap(client, '_innerExecute', execute => function (...args) {
    const cb = args.pop()
    const spanInfo = {
      name: 'cassandra',
      kvpairs: {
        Spec: 'query',
        Flavor: 'cql',
      }
    }

    return ao.instrument(
      last => {
        // Handle arguments
        let [query, params, options] = normalizeArgs(...args)
        if (!Array.isArray(params) && typeof params === 'object') {
          options = args[1]
          params = []
        }
        const consistency = options.consistency || {}
        const keyspace = this.options.keyspace || ''

        // Sanitize, if configured to do so
        query = conf.sanitizeSql ? sanitize(query) : query

        // Create a hash to store even k/v pairs
        const kvpairs = spanInfo.kvpairs
        // Keyspace is planned to be an alternative to Database.
        // But Database is a required key, so add it too.
        kvpairs.Keyspace = keyspace
        kvpairs.Database = keyspace
        kvpairs.ConsistencyLevel = consistencies[consistency] || 'one'
        kvpairs.Query = query

        // Serialize QueryArgs, if available
        if (!conf.sanitizeSql && params.length) {
          // Trim large values and ensure buffers are converted to strings
          kvpairs.QueryArgs = serializeList(params)
        }

        // Truncate long queries
        if (kvpairs.Query.length > 2048) {
          kvpairs.Query = trim(2048)(kvpairs.Query)
          kvpairs.QueryTruncated = true
        }

        return spanInfo
      },
      cb => {
        return execute.apply(this, args.concat(cb))
      },
      conf,
      cb
    )
  })
}

//
// Batch queries are handled slightly differently
//
function patchClientBatch (client, consistencies) {
  if (typeof client.batch !== 'function') {
    logMissing('client.batch()')
    return
  }
  shimmer.wrap(client, 'batch', fn => function (...args) {
    const cb = args.pop()

    const spanInfo = {
      name: 'cassandra',
      kvpairs: {
        Flavor: 'cql',
        Query: 'BATCH',
      }
    }

    return ao.instrument(
      () => {
        // Handle arguments
        const [queries, , {consistency}] = normalizeArgs(...args)
        const {keyspace} = this.options

        const kvpairs = spanInfo.kvpairs
        kvpairs.Keyspace = keyspace
        kvpairs.Database = keyspace
        kvpairs.ConsistencyLevel = consistencies[consistency] || 'one'

        // Grab query list, maybe sanitize, and serialize
        kvpairs.BatchQueries = serializeList(maybeSanitizeList(
          queries.map(mapProp('query'))
        ))

        // Only include QueryArgs when not sanitizing
        if (!conf.sanitizeSql) {
          kvpairs.BatchQueryArgs = serializeList(queries.map(mapProp('params')))
        }

        return spanInfo
      },
      cb => fn.apply(this, args.concat(cb)),
      conf,
      cb
    )
  })
}

function patchClient (client, consistencies) {
  patchClientConnect(client)
  patchClientInnerExecute(client, consistencies)
  patchClientStream(client, consistencies)
  patchClientBatch(client, consistencies)
}

// Trim a value, if it exceeds the specified length,
// and ensure buffers are converted to strings.
function trim (n) {
  return v => v && (v.length > n ? v.slice(0, n) : v).toString()
}

// Helper for mapping to properies
function mapProp (prop) {
  return item => item[prop]
}

function maybeSanitizeList (queries) {
  return conf.sanitizeSql
    ? queries.map(sanitize)
    : queries
}

function sanitize (query) {
  return Sanitizer.sanitize(query, Sanitizer.OBOE_SQLSANITIZE_KEEPDOUBLE)
}
