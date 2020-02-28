'use strict'

const requirePatch = require('../require-patch')
const flatten = require('array-flatten')
const shimmer = require('ximmer')
const methods = require('methods')
const semver = require('semver')
const utility = require('../utility')
const ao = require('..')
const log = ao.loggers
const conf = ao.probes.express

const logMissing = ao.makeLogMissing('express')

//
// Patch routing system to create spans for each routing function
//
function patchRoutes (express, version) {

  function makeSpanInfo (req, res, func) {
    const httpSpan = res._ao_http_span

    // previous
    //   const Controller = req.route.path
    //   const Action = func.name || '(anonymous)'
    let Controller
    let Action

    if (conf.legacyTxname) {
      // old way of setting these
      Controller = req.route.path
      Action = func.name || 'anonymous'
    } else {
      // new way
      Controller = 'express.' + (func.name || 'anonymous')
      Action = req.method + req.route.path
    }

    let txname
    // if a custom transaction name function has been supplied
    // use it.
    if (conf.customNameFunc) {
      res._ao_metrics.customNameFuncCalls += 1
      try {
        txname = conf.customNameFunc(req, res)
      } catch (e) {
        log.error('express customNameFunc() error:', e)
      }
    }

    // if no custom name function or it failed or returned null-like,
    // supply the default name.
    if (!txname) {
      txname = `${Controller}.${Action}`
    }
    res._ao_metrics.txname = txname

    // Store the latest middleware Controller/Action on exit
    const data = {Controller, Action}
    httpSpan.events.exit.addKVs(data)

    // construct the name of the span.
    const name = func.name ? `express-route:${func.name}` : 'express-route'
    return {name, kvpairs: data}
  }


  //
  // Each routing callback is patched as an 'express-route[:function-name]' span.
  //
  function expressRoute (func) {
    return function (req, res, next) {
      let span
      const spanInfo = makeSpanInfo(req, res, func)
      spanInfo.finalize = function (createdSpan) {
        span = createdSpan
      }
      return ao.instrumentHttp(
        () => spanInfo,
        () => {
          // Create wrapper to only send exit once
          try {
            if (span) {
              shimmer.wrap(span, 'exit', utility.once)
              arguments[2] = function () {
                span.exit()
                return next.apply(this, arguments)
              }
            } else if (ao.probes.express.enabled) {
              // the spanInfo function will never be called by instrumentHttp if
              // the probe is disabled.
              log.error('express.expressRoute failed to build span')
            }
          } catch (e) {
            log.error('express.expressRoute failed to patch span exit')
          }
          return func.apply(this, arguments)
        },
        conf,
        res
      )
    }
  }

  //
  // Patch express 3.x style apps
  //
  function v3 (express) {
    const proto = express.Router && express.Router.prototype
    if (!proto || typeof proto.route !== 'function') {
      logMissing('v3 Router.route()')
      return
    }
    shimmer.wrap(proto, 'route', fn => function (method) {
      const ret = fn.apply(this, arguments)
      const routes = ret.map ? ret.map[method.toLowerCase()] : []
      const route = routes[routes.length - 1]
      if (route && Array.isArray(route.callbacks)) {
        route.callbacks = route.callbacks.map(expressRoute)
      }
      return ret
    })
  }

  //
  // Patch express 4.x style apps
  //
  function v4 (express) {
    const proto = express.Route && express.Route.prototype
    if (!proto) {
      logMissing('v4 Route.prototype')
      return
    }
    methods.concat('all').forEach(method => {
      if (typeof proto[method] !== 'function') {
        logMissing(`v4 Route.${method}()`)
        return
      }
      shimmer.wrap(proto, method, method => function (...args) {
        return method.apply(this, flatten(args).map(expressRoute))
      })
    })
  }

  //
  // Use appropriate patch for express version
  //
  if (semver.satisfies(version, '>=4.0.0')) {
    v4(express)
  } else {
    v3(express)
  }
}


//
// Patch rendering system to create spans for render calls
//
function patchRendering (express, version) {

  //
  // The View constructor is patched to report render timing
  //
  const patchedViews = new WeakMap()
  function patchView (proto) {
    if (typeof proto.render !== 'function') return
    if (patchedViews.get(proto)) return
    patchedViews.set(proto, true)

    shimmer.wrap(proto, 'render', render => {
      return function (...args) {
        return ao.instrument(
          () => {
            return {
              name: 'express-render',
              kvpairs: {
                TemplateFile: this.name,
                TemplateLanguage: this.ext
              }
            }
          },
          (callback) => render.apply(this, args.concat(callback)),
          conf,
          typeof args[args.length - 1] === 'function' ? args.pop() : noop
        )
      }
    })
  }

  // Skip instrumentation on old versions
  if (semver.satisfies(version, '< 3.2.0')) {
    log.patching(`express ${version} does not support render spans`)
    return
  }

  // The View constructor needs to be patched to trace render calls,
  // but is only accessible after defaultConfiguration is called.
  shimmer.wrap(express.application, 'defaultConfiguration', fn => function () {
    const ret = fn.apply(this)
    const View = this.get('view')
    const proto = View && View.prototype
    if (proto) patchView(proto)
    return ret
  })
}

// NOTE: For express 4.x the 'handle' method is in express.application,
// while for 3.x it is actually in connect itself.
function patchHandle (app) {
  if (typeof app.handle !== 'function') {
    logMissing('app.handle()')
    return
  }
  shimmer.wrap(app, 'handle', handle => function (req, res, next) {
    return ao.instrumentHttp(
      'express',
      () => handle.call(this, req, res, next),
      conf,
      res
    )
  })
}

//
// Patch app.handle() to create express span
//
function expressSpan (express) {
  function createApplication () {
    const app = express()
    patchHandle(app)
    return app
  }

  // Copy properties to createApplication proxy function
  for (const i in express) {
    createApplication[i] = express[i]
  }

  return createApplication
}

function noop () {}

//
// Apply express patches
//
module.exports = function (express) {
  const {version} = requirePatch.relativeRequire('express/package.json')

  // Wrap everything in express inside an express span
  express = expressSpan(express)

  // make spans for each route callback
  patchRoutes(express, version)

  // make spans for each render call
  patchRendering(express, version)

  return express
}
