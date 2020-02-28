'use strict'

const {inherits} = require('util')
const shimmer = require('ximmer')
const semver = require('semver');

const ao = require('..')
const conf = ao.probes.zlib

const logMissing = ao.makeLogMissing('probes.zlib')

// turn this on for debugging checks and output.
const debugging = false;

const nodeVersionLessThan8 = semver.lt(process.version, '8.0.0');

const classes = [
  'Deflate',
  'Inflate',
  'Gzip',
  'Gunzip',
  'DeflateRaw',
  'InflateRaw',
  'Unzip'
]

const methods = [
  'deflate',
  'deflateRaw',
  'gzip',
  'gunzip',
  'inflate',
  'inflateRaw',
  'unzip'
]

if (semver.gte(process.version, '11.7.0')) {
  classes.push('BrotliCompress');
  classes.push('BrotliDecompress');
  methods.push('brotliCompress');
  methods.push('brotliDecompress');
}

function makeKvPairs (name, options) {
  const kvpairs = {Operation: name}
  if (options) {
    kvpairs.Options = JSON.stringify(options)
  }
  return kvpairs
}

const spans = new WeakMap()

function wrapClassEmit (proto) {
  if (typeof proto.emit !== 'function') {
    logMissing('zlib.prototype.emit()')
    return
  }
  shimmer.wrap(proto, 'emit', fn => function (name, err) {
    try {
      if (['close', 'error', 'end'].indexOf(name) >= 0) {
        const span = spans.get(this)
        if (span) {
          if (err) {
            span.events.exit.error = err
          }
          spans.delete(this)
          span.exit()
        }
      } else {
        debugging && ao.clsCheck(`ignoring wrapClassEmit.${name}`)
      }
    } catch (e) {
      ao.loggers.error('failed to exit zlib.span on %s', name, e);
    }

    return fn.apply(this, arguments)
  })
}

function wrapConstructor (proto, name) {
  if (typeof proto[name] !== 'function') {
    logMissing(`zlib.prototype.${name}()`)
    return
  }
  shimmer.wrap(proto, name, Real => {
    function WrappedZlib (options) {
      const last = ao.lastSpan;
      try {
        if (last && conf.enabled && !spans.get(this)) {
          const span = last.descend('zlib', makeKvPairs(name, options))
          spans.set(this, span)
          span.async = true
          span.enter()
        }
      } catch (e) {
        ao.loggers.error('zlib failed to enter span', e)
      }

      const em = last ? ao.bindEmitter(this) : this;
      Real.call(em, options)
    }
    inherits(WrappedZlib, Real)
    wrapClassEmit(WrappedZlib.prototype)
    return WrappedZlib
  })
}

function wrapCreator (proto, name) {
  const creator = 'create' + name
  if (typeof proto[creator] !== 'function') {
    logMissing(`zlib.prototype.${creator}()`)
    return
  }
  if (nodeVersionLessThan8) {
    proto[creator] = function (options) {
      return new proto[name](options)
    }
  } else {
    // zlib changed in node 8 so that the creator function object
    // is read-only. It is still configurable. This should work for
    // previous versions as well.
    Object.defineProperty(proto, creator, {
      value: function (...args) {
        return new proto[name](...args)
      },
      writable: true,
      configurable: true
    })
  }

}

function wrapClass (proto, name) {
  wrapConstructor(proto, name)
  wrapCreator(proto, name)
}

function wrapMethod (proto, name) {
  if (typeof proto[name] === 'function') {
    shimmer.wrap(proto, name, fn => function (...args) {
      const cb = args.pop()
      return ao.instrument(
        () => {
          return {name: 'zlib', kvpairs: makeKvPairs(name, args[1])}
        },
        cb => fn.apply(this, args.concat(cb)),
        conf,
        cb
      )
    })
  } else {
    logMissing(`zlib.prototype.${name}()`)
  }

  const syncMethod = name + 'Sync'
  if (typeof proto[syncMethod] === 'function') {
    shimmer.wrap(proto, syncMethod, fn => function () {
      return ao.instrument(
        () => {
          return {name: 'zlib', kvpairs: makeKvPairs(syncMethod, arguments[1])}
        },
        () => fn.apply(this, arguments),
        conf
      )
    })
  } else {
    logMissing(`zlib.prototype.${syncMethod}()`)
  }
}

module.exports = function (zlib) {
  classes.forEach(name => wrapClass(zlib, name))
  methods.forEach(method => wrapMethod(zlib, method))
  return zlib
}
