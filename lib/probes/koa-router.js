'use strict'

const shimmer = require('ximmer')
const methods = require('methods')
const semver = require('semver')

const utility = require('../utility')
const ao = require('../')
const requirePatch = require('../require-patch')
const conf = ao.probes['koa-router']

const {version} = requirePatch.relativeRequire('koa-router/package.json')

const logMissing = ao.makeLogMissing('koa-router')

module.exports = function (_router) {

  if (semver.gte(version, '6.0.0')) {
    // allow the caller to invoke this with or without "new" by not using
    // an arrow function.
    return function () {
      const router = new _router(...arguments)

      methods.concat('del', 'all').forEach(method => {
        patchAsyncMethod(router, method)
      })
      return router
    }
  }

  const v5 = semver.gte(version, '5.0.0')

  // version 5 and below
  return function (app) {
    const router = _router(app)
    // For 5.x+, the methods are on the router, not the app, so accomodate both.
    const target = v5 ? router : app
    if (!target) {
      logMissing('target to patch')
      return router
    }

    methods.concat('del').forEach(method => {
      patchGeneratorFunction(target, method)
    })
    return router
  }
}

//
// v6+ sequence: patchAsyncMethod, patchAsyncHandler
//
function patchAsyncMethod (target, method) {
  if (typeof target[method] !== 'function') {
    logMissing(method + '()')
    return
  }

  // routes are specified as:
  // [name] - string
  // url - string
  // handler [... , handler] - function
  shimmer.wrap(target, method, fn => {
    return function (...args) {
      const n = typeof args[1] === 'string' ? 2 : 1
      for (let i = n; i < args.length; i++) {
        args[i] = patchAsyncHandler(
          `${method} ${args[n - 1]}`,
          utility.fnName(args[i]),
          args[i]
        )
      }
      return fn.apply(this, args)
    }
  })
}

function patchAsyncHandler (Controller, Action, route) {
  // this is (at least logically) an async function so it
  // must return a promise.
  return (ctx, next) => {
    // Check if there is a trace to continue
    const last = ao.lastSpan;
    if (!last || !conf.enabled) {
      return Promise.resolve(route.call(this, ctx, next))
    }

    let span
    try {
      // Build controller/action data, assign to http
      // span exit, and create koa-router span. With v6+
      // 'this' is not set in this call, rather ctx is
      // passed as an argument with substantially the
      // same information.
      const data = {Controller, Action}
      ctx.res._ao_http_span.events.exit.addKVs(data)
      // make a name for the route using if the function has a name
      const name = route.name ? `koa-router:${route.name}` : 'koa-router'
      span = last.descend(name, data)
    } catch (e) {
      ao.loggers.error('koa-router failed to build span', e)
    }

    // Enter, run and exit
    if (span) span.enter()
    // route doesn't return a promise in our tests but handle one
    // if it does.
    let error
    //const res = route.call(this, ctx, next)
    return Promise.resolve(route.call(this, ctx, next))
      .catch(e => {
        error = e
      })
      .then(r => {
        if (span) {
          span.exitWithError(error)
        }
        if (error) {
          throw error
        }
        return r
      })
  }
}

//
// v5- sequence: patchGeneratorFunction, patchGeneratorHandler
//
function patchGeneratorFunction (target, method) {
  // The method might not exist at all
  if (typeof target[method] !== 'function') {
    logMissing(method + '()')
    return
  }

  shimmer.wrap(target, method, fn => {
    return function (url, route) {
      // Define controller/action at assignment time
      return fn.call(this, url, patchGeneratorHandler(
        method + ' ' + url,
        utility.fnName(route),
        route
      ))
    }
  })
}

function patchGeneratorHandler (Controller, Action, route) {
  return function* (next) {
    // Check if there is a trace to continue
    const last = ao.lastSpan;
    if (!last || !conf.enabled) {
      return yield route.call(this, next)
    }

    let span
    try {
      // Build controller/action data, assign to http
      // span exit, and create koa-route-handler span
      const data = {Controller, Action}
      this.res._ao_http_span.events.exit.addKVs(data)
      span = last.descend('koa-router-handler', data)
    } catch (e) {
      ao.loggers.error('koa-router failed to build span', e)
    }

    // Enter, run and exit
    if (span) span.enter()
    const res = yield route.call(this, next)
    if (span) span.exit()
    return res
  }
}

