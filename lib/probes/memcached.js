'use strict'

const shimmer = require('ximmer')
const ao = require('..')
const conf = ao.probes.memcached
let lastKey

function isGetter (expected) {
  return 0 !== ~['get', 'gets'].indexOf(expected)
}

function patchMulti (proto) {
  if (typeof proto.multi !== 'function') return
  shimmer.wrap(proto, 'multi', multi => function (keys, fn) {
    lastKey = keys
    return multi.call(this, keys, fn)
  })
}

function patchCommand (proto) {
  if (typeof proto.command !== 'function') return
  shimmer.wrap(proto, 'command', command => function (fn) {
    // Skip if not tracing
    if (!ao.tracing) {
      return command.call(this, fn)
    }

    // Memcached uses a builder function that returns
    // a query descriptor object. Lets patch that.
    return command.call(this, () => {
      const res = fn()
      res.callback = ao.bind(res.callback)
      runCommandSpan(this, res)
      return res
    })
  })
}

function runCommandSpan (ctx, desc) {
  if (!conf.enabled) return
  try {
    // Find server host
    const host = ctx.servers && ctx.servers[0]

    // res.key is not present on multi calls, so use lastKey
    const key = desc.key || lastKey

    // Define entry event data
    const data = {
      Spec: 'cache',
      RemoteHost: host,
      KVOp: desc.type,
      KVKey: key
    }

    if (desc.multi) {
      data.KVKey = JSON.stringify(data.KVKey)
    }

    const lastSpan = ao.lastSpan;

    // Collect backtraces, if configured to do so
    if (conf.collectBacktraces && lastSpan.doSample) {
      data.Backtrace = ao.backtrace()
    }

    // Create the span and run
    const span = lastSpan.descend('memcached', data)
    span.run(wrap => patchDescriptor(span, desc, key, wrap))
  } catch (e) {}
}

function patchDescriptor (span, desc, key, wrap) {
  // Getters need an alternate handler to include hit data
  desc.callback = isGetter(desc.type)
    ? wrap(desc.callback, makeHandler(span, desc, key))
    : wrap(desc.callback)
}

function makeHandler (span, desc, key) {
  return desc.multi
    ? makeMultiHandler(span, key)
    : makeNonMultiHandler(span)
}

function makeMultiHandler (span, key) {
  return (err, val) => {
    if (err) span.events.exit.error = err
    span.exit({
      KVKeyCount: key.length,
      KVHitCount: Object.keys(val).length
    })
  }
}

function makeNonMultiHandler (span) {
  return (err, val) => {
    if (err) span.events.exit.error = err
    span.exit({
      KVHit: typeof val !== 'undefined' && val !== false
    })
  }
}

module.exports = function (memcached) {
  const proto = memcached.prototype
  if (proto) {
    patchMulti(proto)
    patchCommand(proto)
  }

  return memcached
}
