'use strict'

const shimmer = require('shimmer')
const Span = require('../span')
const ao = require('../')
const conf = ao.probes.koa

module.exports = Koa => {
  return function () {
    const app = new Koa();
    wrapApp(app);
    return app;
  }
}

// Wrap the callback method that goes into listen(...)
function wrapApp (app) {
  if (!app.callback) return
  shimmer.wrap(app, 'callback', callback => {
    return function () {
      const handle = callback.call(this)
      return function (req, res) {
        // Check if there is a trace to continue
        const last = Span.last
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
  if (!res.end) return
  shimmer.wrap(res, 'end', realEnd => {
    return function () {
      span.exit()
      return realEnd.apply(this, arguments)
    }
  })
}
