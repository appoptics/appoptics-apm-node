'use strict'

const shimmer = require('ximmer')
const ao = require('../')
const conf = ao.probes.koa

const logMissing = ao.makeLogMissing('koa')

module.exports = koa => {
  // allow the caller to invoke this with or without "new" by
  // not using an arrow function.
  return function () {
    const app = new koa()
    wrapApp(app)
    return app
  }
}

// Wrap the callback method that goes into listen(...)
function wrapApp (app) {
  if (!app.callback) {
    logMissing('app.callback()')
    return
  }
  shimmer.wrap(app, 'callback', callback => {
    return function () {
      const handle = callback.call(this)
      return function (req, res) {
        // Check if there is a trace to continue
        const last = ao.lastSpan;
        if (!last || !conf.enabled) {
          return handle.call(this, req, res)
        }

        // Create and enter koa span
        const span = last.descend('koa')
        wrapEnd(span, res)
        span.enter()

        // Run real handler
        return handle.call(this, req, res)
      }
    }
  })
}

// Exit koa span and response write
function wrapEnd (span, res) {
  if (!res.end) {
    logMissing('res.end()')
    return
  }
  shimmer.wrap(res, 'end', realEnd => {
    return function () {
      span.exit()
      return realEnd.apply(this, arguments)
    }
  })
}
