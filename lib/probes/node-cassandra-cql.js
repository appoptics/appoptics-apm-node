'use strict'

const requirePatch = require('../require-patch')
const shimmer = require('ximmer')
const semver = require('semver')
const ao = require('..')
const Sanitizer = ao.addon.Sanitizer
const conf = ao.probes['node-cassandra-cql']

module.exports = function (cassandra) {
  try {
    const {version} = requirePatch.relativeRequire(
      'node-cassandra-cql/package.json'
    )

    // Create reversed map of consistencies back to their names
    const types = cassandra.types
    const consistencies = {}
    Object.keys(types.consistencies).forEach(name => {
      const value = types.consistencies[name]
      if (typeof value === 'number') {
        consistencies[value] = name
      }
    })

    // Patch Connection
    {
      const proto = cassandra.Connection && cassandra.Connection.prototype
      if (proto) patchConnection(proto)
    }

    // Patch Client
    {
      const proto = cassandra.Client && cassandra.Client.prototype
      if (proto) patchClient(proto, version, consistencies)
    }
  } catch (e) {
    ao.loggers.patching('cassandra-cql patch failed', e);
  }

  return cassandra
}

function passthrough (proto, methods) {
  methods.forEach(method => {
    if (typeof proto[method] !== 'function') return
    shimmer.wrap(proto, method, fn => function (...args) {
      if (args.length) args.push(ao.bind(args.pop()))
      return fn.apply(this, args)
    })
  })
}

function patchConnectionExecutors (proto, methods) {
  methods.forEach(method => {
    if (typeof proto[method] !== 'function') return
    shimmer.wrap(proto, method, fn => function (...args) {
      const last = ao.lastSpan
      if (last) {
        const {host, port} = this.options
        last.info({RemoteHost: `${host}:${port}`})
      }
      return fn.apply(this, args)
    })
  })
}

function patchConnection (proto) {
  passthrough(proto, [
    'open',
    'close',
    'authenticate',
    'prepare'
  ])

  patchConnectionExecutors(proto, [
    'execute',
    'executePrepared'
  ])
}

function patchClientExecutors (proto, methods, consistencies) {
  methods.forEach(method => {
    if (typeof proto[method] !== 'function') return
    shimmer.wrap(proto, method, fn => function (...args) {
      const cb = args.pop()
      const [query, params = [], consistency] = args

      const {keyspace} = this.options
      // Create a hash to store even k/v pairs
      const kvpairs = {
        Spec: 'query',
        Flavor: 'cql',
        Keyspace: keyspace,
        Database: keyspace,
        ConsistencyLevel: consistencyOf(consistency, consistencies),
        Query: query
      }

      // If no args list has been supplied, assume the worst...
      if (conf.sanitizeSql) {
        kvpairs.Query = Sanitizer.sanitize(
          kvpairs.Query,
          Sanitizer.OBOE_SQLSANITIZE_KEEPDOUBLE
        )

        // Keyspace is planned to be an alternative to Database.
        // For now, Database is a required key, so map it back.
      } else if (params.length) {
        // Trim large values, ensure buffers are
        // converted to strings and serialize to json.
        kvpairs.QueryArgs = JSON.stringify(params.map(trim(1000)))
      }

      // Truncate long queries
      if (kvpairs.Query.length > 2048) {
        kvpairs.Query = kvpairs.Query.slice(0, 2048).toString()
        kvpairs.QueryTruncated = true
      }

      let span
      return ao.instrument(
        () => {
          return {
            name: 'cassandra',
            kvpairs,
            finalize (createdSpan) {
              span = createdSpan
            }
          }
        },
        done => fn.apply(this, args.concat(function (err) {
          reportErrors(span, err)
          return done.apply(this, arguments)
        })),
        conf,
        cb
      )
    })
  })
}

// When no consistency is supplied, the default is "quorum"
function consistencyOf (consistency, consistencies) {
  return consistency ? consistencies[consistency] : 'quorum'
}

function trim (n) {
  return arg => (arg.length > n ? arg.slice(0, n) : arg).toString()
}

function reportErrors (span, err) {
  if (span && err instanceof Error && Array.isArray(err.individualErrors)) {
    err.individualErrors.forEach(err => span.error(err))
  }
}

function patchClient (proto, version, consistencies) {
  const continuers = [ 'connect' ]

  // This is a newer thing. We don't yet instrument it,
  // but we need to propagate context through it.
  // TODO: Figure out how to report batch queries
  if (semver.satisfies(version, '>=0.4.4')) {
    continuers.push('executeBatch')
  }

  passthrough(proto, continuers)

  patchClientExecutors(proto, [
    'execute',
    'executeAsPrepared'
  ], consistencies)
}
