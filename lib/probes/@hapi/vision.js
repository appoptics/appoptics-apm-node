'use strict'

const ao = global[Symbol.for('AppOptics.Apm.Once')];
const path = require('path');

const shimmer = require('ximmer')
const semver = require('semver')
const log = ao.loggers
const conf = ao.probes.vision

//
// Apply vision patches
//
module.exports = function (vision, options) {
  const {version} = options;

  // only version 5 is handled
  if (semver.lt(version, '5.0.0')) {
    log.patching('vision instrumentation not active before v5')
    return vision
  }
  const plugin = vision.plugin

  if (!plugin || !plugin.pkg || semver.lt(plugin.pkg.version, '5.0.0')) {
    log.patching('vision instrumentation not supported before v5')
    return vision
  }

  shimmer.wrap(plugin, 'register', register => function wrappedRegister (server) {
    shimmer.wrap(server, 'decorate', wrapDecorate)
    const r = register.apply(this, arguments)
    shimmer.unwrap(server, 'decorate')
    return r
  })

  function wrapDecorate (decorate) {
    return function wrappedDecorate (type, name, handler) {
      if (type !== 'toolkit' || name !== 'view') {
        return decorate.apply(this, arguments)
      }
      const args = Array.from(arguments)
      args[2] = function wrappedHandler (template, context, options) {
        const last = ao.lastSpan
        // if not enabled when the handler is called just call the original
        if (!last || !conf.enabled) {
          return handler.apply(this, arguments)
        }
        let span

        try {
          span = last.descend('vision', {
            TemplateFile: template,
            TemplateLanguage: path.extname(template) || 'unknown'
          })
          span.async = true
          span.enter()
        } catch (e) {
          log.error('vision - failed to enter span')
        }

        const r = handler.apply(this, arguments)

        if (span) {
          span.exit()
        }

        return r
      }
      // continue trace if active
      return decorate.apply(this, args)
    }
  }

  return [vision, version];
}

/*
shimmer.wrap(request, 'prepare', fn => function (response, callback) {
  const last = ao.lastSpan
  if (!last || !conf.enabled) {
    return fn.call(this, response, callback)
  }

  try {
    const filename = response.source.template
    const span = last.descend('hapi-render', {
      TemplateFile: filename,
      TemplateLanguage: path.extname(filename) || this._defaultExtension,
    })

    trackedRenders.set(response, span)
    span.async = true
    span.enter()
  } catch (e) {
    log.error('hapi - failed to enter hapi-render span')
  }

  return fn.call(this, response, callback)
})
// */
