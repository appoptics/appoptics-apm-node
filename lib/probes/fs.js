'use strict'

const shimmer = require('ximmer')
const ao = require('..')
const conf = ao.probes.fs
const log = ao.loggers

module.exports = function (fs) {
  patchFdMethods(fs)
  patchPathMethods(fs)
  patchLinkMethods(fs)
  return fs
}

function fdOf (span, name) {
  const e = span.events[name]
  return e && e.kv.FileDescriptor
}

// helper to return the spanInfo maker function.
function fdSpan (method, fd) {
  return () => {
    const kvpairs = {
      Spec: 'filesystem',
      Operation: method,
      FileDescriptor: fd,
    }

    return {
      name: 'fs',
      kvpairs,
      finalize (span, last) {
        if (fdOf(last, 'entry') === fd || fdOf(last, 'exit') === fd) {
          // if there is a file path then store it. there is at least one place
          // in node/lib/internal/fs.js for SyncWriteStream.prototype._write where
          // fs.writeSync is called. SyncWriteStream is a "temporary hack for
          // process.stdout and process.stderr when piped to files", so the need
          // for this *might* go away.
          if (typeof last.events.entry.kv.FilePath === 'string') {
            span.events.entry.addKVs({FilePath: last.events.entry.kv.FilePath})
          }
        }
      }
    }
  }
}

// fd
function patchFdMethods (fs) {
  const methods = [
    'ftruncate',
    'fchown',
    'fchmod',
    'fstat',
    'close',
    'futimes',
    'fsync',
    'write',
    'read'
  ]

  methods.forEach(method => patchFdMethod(fs, method))
}

function patchFdMethod (fs, method) {
  if (typeof fs[method] === 'function') {
    shimmer.wrap(fs, method, fn => function (...args) {
      const cb = args.pop()
      return ao.instrument(
        fdSpan(method, args[0]),
        cb => fn.apply(this, args.concat(cb)),
        conf,
        cb
      )
    })
  } else {
    log.patching('fs.%s not a function', method)
  }

  const syncMethod = method + 'Sync'
  if (typeof fs[syncMethod] === 'function') {
    shimmer.wrap(fs, syncMethod, fn => function (...args) {
      return ao.instrument(
        fdSpan(syncMethod, args[0]),
        () => fn.apply(this, args),
        conf
      )
    })
  } else {
    log.patching('fs.%s not a function', syncMethod)
  }
}

// path
function patchPathMethods (fs) {
  const methods = [
    'truncate',
    'chown',
    'chmod',
    'stat',
    'lstat',
    'readlink',
    'realpath',
    'unlink',
    'rmdir',
    'mkdir',
    'readdir',
    'open',
    'utimes',
    'readFile',
    'writeFile',
    'appendFile',
    'exists',
    'access'
  ]

  methods.forEach(method => patchPathMethod(fs, method))
}

function patchPathMethod (fs, method) {
  if (typeof fs[method] === 'function') {
    shimmer.wrap(fs, method, fn => {
      const f = function (...args) {
        const cb = args.pop()
        let span
        return ao.instrument(
          () => {
            return {
              name: 'fs',
              kvpairs: {
                Spec: 'filesystem',
                Operation: method,
                FilePath: args[0],
              },
              finalize (createdSpan) {
                span = createdSpan;
                if (conf.ignoreErrors && method in conf.ignoreErrors) {
                  span.setIgnoreErrorFn(function (err) {
                    // if looking at operation and/or path in the future:
                    // span.events.entry.kv.Operation === 'open' ditto.FilePath
                    return err.code in conf.ignoreErrors[method];
                  })
                }
              }
            }
          },
          cb => fn.apply(this, args.concat(function (err, fd) {
            // there might not be an fd if there was an error.
            if (span && method === 'open' && !err) {
              span.events.exit.addKVs({FileDescriptor: fd})
            }
            return cb.apply(this, arguments)
          })),
          conf,
          cb
        )
      }
      if (method === 'realpath') {
        f.native = fn.native
      }
      return f
    })
  } else {
    log.patching('fs.%s not a function', method)
  }

  const syncMethod = method + 'Sync'
  if (typeof fs[syncMethod] === 'function') {
    shimmer.wrap(fs, syncMethod, fn => {
      const f = function (...args) {
        const spanInfo = {
          name: 'fs',
          kvpairs: {
            Spec: 'filesystem',
            Operation: syncMethod,
            FilePath: args[0]
          },
        }
        if (method === 'open') {
          spanInfo.finalize = function (createdSpan) {
            span = createdSpan;
            if (conf.ignoreErrors && method in conf.ignoreErrors) {
              span.setIgnoreErrorFn(function (err) {
                // if looking at operation and/or path in the future:
                // span.events.entry.kv.Operation === 'openSync' ditto.FilePath
                return err.code in conf.ignoreErrors[method];
              })
            }
          }
        }
        let span
        return ao.instrument(
          () => spanInfo,
          () => {
            const ret = fn.apply(this, args)
            if (span && method === 'open') {
              span.events.exit.addKVs({FileDescriptor: ret})
            }
            return ret
          },
          conf
        )
      }
      // method realpath has a native function but maybe others will be added.
      if (fn.native) {
        log.patching(`fs.${method} - adding native method`);
        f.native = fn.native;
      }
      return f
    })
  } else {
    log.patching('fs.%s not a function', syncMethod)
  }
}

// path, dest
function patchLinkMethods (fs) {
  const methods = [ 'rename', 'symlink', 'link' ]
  methods.forEach(method => patchLinkMethod(fs, method))
}

function patchLinkMethod (fs, method) {
  if (typeof fs[method] === 'function') {
    shimmer.wrap(fs, method, fn => function (...args) {
      const cb = args.pop()
      return ao.instrument(
        () => {
          return {
            name: 'fs',
            kvpairs: {
              Spec: 'filesystem',
              Operation: method,
              FilePath: args[0],
              NewFilePath: args[1],
            }
          }
        },
        cb => fn.apply(this, args.concat(cb)),
        conf,
        cb
      )
    })
  } else {
    log.patching('fs.%s not a function', method)
  }

  const syncMethod = method + 'Sync'
  if (typeof fs[syncMethod] === 'function') {
    shimmer.wrap(fs, syncMethod, fn => function (...args) {
      return ao.instrument(
        () => {
          return {
            name: 'fs',
            kvpairs: {
              Spec: 'filesystem',
              Operation: syncMethod,
              FilePath: args[0],
              NewFilePath: args[1],
            }
          }
        },
        () => fn.apply(this, args),
        conf
      )
    })
  } else {
    log.patching('fs.%s not a function', syncMethod)
  }
}
