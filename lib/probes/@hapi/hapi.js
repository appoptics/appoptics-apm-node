'use strict'

const ao = global[Symbol.for('AppOptics.Apm.Once')];
const path = require('path');

const requirePatch = require(path.resolve(ao.root, 'lib', 'require-patch'));
const shimmer = require('ximmer')
const semver = require('semver')
const utility = require(path.resolve(ao.root, 'lib', 'utility'));
const log = ao.loggers
const conf = ao.probes.hapi

const notFunction = 'hapi - %s is not a function'
const protoNotFound = 'hapi - %s.prototype not found'

// v17+ uses patchHandler
function patchHandler (handler) {
  if (typeof handler.execute !== 'function') {
    log.patching(notFunction, 'handler.execute')
    return
  }

  shimmer.wrap(handler, 'execute', execute => function (request) {
    // iam:: v17 handler patch
    const {res} = request.raw
    return ao.instrumentHttp(
      () => {
        ao.addResponseFinalizer(res, ao.bind(() => {
          const {exit} = res._ao_http_span.events

          exit.kv.Controller = 'hapi.' + (utility.fnName(request.route.settings.handler) || '(anonymous)')
          exit.kv.Action = request.route.method + request.route.path

          // generate a transaction name
          let txname

          // if a custom transaction name function has been supplied use it.
          if (conf.customNameFunc) {
            res._ao_metrics.customNameFuncCalls += 1
            try {
              // seems like passing hapi's request object is the right thing
              // to do for hapi users. req and res are in the request.raw object.
              txname = conf.customNameFunc(request)
            } catch (e) {
              log.error('hapi customNameFunc() error:', e)
            }
          }

          // if no custom name function or it failed or returned null-like,
          // supply the default name.
          if (!txname) {
            txname = `${exit.kv.Controller}.${exit.kv.Action}`
          }
          res._ao_metrics.txname = txname
        }));
        return {name: 'hapi'}
      },
      // make this right for execute. it doesn't return a value but
      // this function must so that hapi won't set request.response
      // to null.
      function () {
        const r = execute.bind(request, request)()
        // if it's already a promise just return it. this is
        // emulating being an async function.
        if (r.then) {
          return r
        }
        return Promise.resolve(request)
      },
      conf,
      res
    )
  })
}

const trackedRenders = new WeakMap()
function wrapPrepare (request) {
  if (typeof request.prepare !== 'function') {
    log.patching(notFunction, 'request.prepare')
    return
  }
  shimmer.wrap(request, 'prepare', fn => function (response, callback) {
    const last = ao.lastSpan
    if (!last || !conf.enabled) {
      return fn.call(this, response, callback)
    }

    try {
      const TemplateFile = response.source.template;

      let TemplateLanguage = path.extname(TemplateFile);
      if (TemplateLanguage[0] === '.') {
        TemplateLanguage = TemplateLanguage.slice(1);
      }
      if (!TemplateLanguage) {
        if (response.source.manager) {
          TemplateLanguage = response.source.manager._defaultExtension;
        } else {
          // TODO BAM it looks like this._defaultExtension is only valid
          // for older versions than we currently support.
          TemplateLanguage = this._defaultExtension || 'unknown';
        }
      }
      const span = last.descend('hapi-render', {TemplateFile, TemplateLanguage});

      trackedRenders.set(response, span)
      span.async = true
      span.enter()
    } catch (e) {
      log.error('hapi - failed to enter hapi-render span')
    }

    return fn.call(this, response, callback)
  })
}

function wrapMarshal (request) {
  if (typeof request.marshal !== 'function') {
    log.patching(notFunction, 'request.marshal')
    return
  }
  shimmer.wrap(request, 'marshal', fn => function (response, callback) {
    const span = trackedRenders.get(response)
    if (!span || !conf.enabled) {
      return fn.call(this, response, callback)
    }

    return fn.call(this, response, utility.before(() => span.exit(), callback))
  })
}

function wrapPrepareMarshal (request) {
  wrapPrepare(request)
  wrapMarshal(request)
}

function wrapManager (manager) {
  if (typeof manager._response !== 'function') {
    log.patching(notFunction, 'manager._response')
    return
  }
  shimmer.wrap(manager, '_response', fn => function () {
    const ret = fn.apply(this, arguments)
    wrapPrepareMarshal(ret._processors || {})
    return ret
  })
}

function wrapRender (render, version) {
  if (typeof render !== 'function') {
    log.patching(notFunction, 'render')
    return render
  }
  return function (filename, context, options, callback) {
    context = context || {}

    const run = version && semver.satisfies(version, '< 1.1.0')
      ? cb => render.call(this, filename, context, options, cb)
      : () => render.call(this, filename, context, options)

    return ao.instrument(
      () => {
        let extension = path.extname(filename);
        if (extension) {
          extension = extension.slice(1);
        } else {
          extension = this._defaultExtension;
        }
        return {
          name: 'hapi-render',
          kvpairs: {
            TemplateFile: filename,
            TemplateLanguage: extension,
          }
        }
      },
      run,
      conf,
      callback
    )
  }
}

const patchedViews = new WeakMap()
function patchView (view, version) {
  if (typeof view.render !== 'function') {
    log.patching(notFunction, 'view.render')
    return
  }
  if (patchedViews.get(view)) return
  patchedViews.set(view, true)
  shimmer.wrap(view, 'render', render => wrapRender(render, version))
}

function patchConnection (conn) {
  if (typeof conn.views !== 'function') {
    log.patching(notFunction, 'connection.views')
    return
  }

  function findViews (ctx) {
    return ctx._views ? ctx._views : (
      ctx.pack && ctx.pack._env.views ? ctx.pack._env.views : (
        ctx._server && ctx._server._env.views
      )
    )
  }

  shimmer.wrap(conn, 'views', fn => function () {
    const ret = fn.apply(this, arguments)
    const views = findViews(this)
    const proto = views && views.constructor && views.constructor.prototype
    if (proto) {
      patchView(proto)
    } else {
      log.patching(protoNotFound, 'views.constructor')
    }
    return ret
  })
}

function patchGenerator (generator) {
  if (typeof generator.request !== 'function') {
    log.patching(notFunction, 'generator.request')
    return
  }
  shimmer.wrap(generator, 'request', fn => function () {
    const ret = fn.apply(this, arguments)
    patchRequest(ret)
    return ret
  })
}

// before v17 request had an _execute() method.
function patchRequest (request) {
  if (typeof request._execute !== 'function') {
    log.patching(notFunction, 'request._execute')
    return
  }

  // The route argument existed from 1.2.0 and older
  shimmer.wrap(request, '_execute', execute => function (route) {
    const {res} = this.raw
    ao.instrumentHttp(
      () => {
        ao.addResponseFinalizer(res, ao.bind(() => {
          const {exit} = res._ao_http_span.events
          const route = this._route || {settings: {}}

          exit.kv.Controller = 'hapi.' + (utility.fnName(route.settings.handler) || '(anonymous)')
          exit.kv.Action = route.method + route.path

          // generate a transaction name
          let txname

          // if a custom transaction name function has been supplied use it.
          if (conf.customNameFunc) {
            res._ao_metrics.customNameFuncCalls += 1
            try {
              // seems like passing hapi's request object is the right thing
              // to do for hapi users. req and res are in the request.raw object.
              txname = conf.customNameFunc(request)
            } catch (e) {
              log.error('hapi customNameFunc() error:', e)
            }
          }

          // if no custom name function or it failed or returned null-like,
          // supply the default name.
          if (!txname) {
            txname = `${exit.kv.Controller}.${exit.kv.Action}`
          }
          res._ao_metrics.txname = txname

        }));
        return {name: 'hapi'}
      },
      execute.bind(this, route),
      conf,
      res
    )
  })
}

function patchDecorator (plugin, version) {
  if (typeof plugin.decorate !== 'function') {
    log.patching(notFunction, 'plugin.decorator')
    return
  }

  function wrapViews (views) {
    if (typeof views !== 'function') {
      log.patching(notFunction, 'plugin.decorator.views')
      return views
    }
    return function () {
      const ret = views.apply(this, arguments)

      const {plugins} = this.realm || {}
      const manager = plugins && plugins.vision && plugins.vision.manager
      if (manager) {
        if (version && semver.satisfies(version, '>= 9.0.0')) {
          wrapManager(manager)
        } else {
          manager.render = wrapRender(manager.render, version)
        }
      }

      return ret
    }
  }

  shimmer.wrap(plugin, 'decorate', fn => function (name, method, handler, options) {
    if (name === 'server' && method === 'views') {
      handler = wrapViews(handler)
    }
    return fn.call(this, name, method, handler, options)
  })
}

//
// Apply hapi patches
//
module.exports = function (hapi, options) {
  const {name, version} = options;

  if (semver.gte(version, '17.0.0')) {
    // v17 has completely different implementation. handler needs to be patched
    // where before v17 request needed to be patched.
    let handler
    try {
      handler = requirePatch.relativeRequire(`${name}/lib/handler`);
    } catch (e) {
      log.patching('Failed to load hapi/lib/handler')
    }

    if (handler) {
      patchHandler(handler)
    }
  } else {
    // v16 and below
    let Request
    try {
      Request = requirePatch.relativeRequire('hapi/lib/request')
    } catch (e) {
      log.patching('Failed to load hapi/lib/request')
    }

    if (Request && Request.prototype) {
      if (semver.gte(version, '8.5.0')) {
        patchGenerator(Request.prototype)
      } else {
        patchRequest(Request.prototype)
      }
    } else {
      log.patching(protoNotFound, 'Request')
    }
  }


  // After 8.0.0, the Plugin system was introduced
  if (semver.gte(version, '17.0.0')) {
    log.patching('hapi - v17 not looking for hapi/lib/plugin')
  } else if (semver.gte(version, '8.0.0')) {
    let Plugin
    try {
      Plugin = requirePatch.relativeRequire('hapi/lib/plugin')
    } catch (e) {}
    if (Plugin && Plugin.prototype) {
      patchDecorator(Plugin.prototype, version)
    } else {
      log.patching(protoNotFound, 'Plugin')
    }

  // After 7.2.0, Server became Connection
  } else if (semver.satisfies(version, '>= 7.2.0')) {
    let Connection
    try {
      Connection = requirePatch.relativeRequire('hapi/lib/connection')
    } catch (e) {}
    if (Connection && Connection.prototype) {
      patchConnection(Connection.prototype)
    } else {
      log.patching(protoNotFound, 'Connection')
    }

  // After 2.0.0, View was not patchable directly
  } else if (semver.satisfies(version, '>= 6.0.0')) {
    let Server
    try {
      Server = requirePatch.relativeRequire('hapi/lib/server')
    } catch (e) {}
    if (Server && Server.prototype) {
      patchConnection(Server.prototype)
    } else {
      log.patching(protoNotFound, 'Server')
    }

  // Beyond that, we can patch View directly
  } else {
    let View
    try {
      View = requirePatch.relativeRequire('hapi/lib/views')
    } catch (e) {}
    let patched = false
    if (View) {
      if (semver.satisfies(version, '> 2.0.0')) {
        if (View.Manager && View.Manager.prototype) {
          patchView(View.Manager.prototype)
          patched = true
        }
      } else if (View.prototype) {
        patchView(View.prototype, version)
        patched = true
      }
    }
    if (!patched) {
      log.patching('hapi - views not patched')
    }
  }

  return [hapi, version];
}
