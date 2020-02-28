'use strict'

const shimmer = require('ximmer')
const methods = require('methods')
const semver = require('semver')

const ao = require('../')
const requirePatch = require('../require-patch')
const utility = require('../utility')

const conf = ao.probes['koa-route']

const {version} = requirePatch.relativeRequire('koa-route/package.json')

module.exports = function (route) {

  let patcher;
  if (semver.gte(version, '3.0.0')) {
    patcher = patchAsyncHandler;
  } else {
    patcher = patchGeneratorHandler;
  }

  methods.concat('del')
    // The method might not exist at all
    .filter(method => typeof route[method] === 'function')
    .forEach(method => patchRoute(route, method, patcher))

  return route
}

function patchAsyncHandler (Controller, Action, route) {
  return function (ctx) {
    const last = ao.lastSpan;
    if (!last || !conf.enabled) {
      return route.call(this, ctx);
    }

    let span;
    try {
      const data = {Controller, Action};
      this.res._ao_http_span.events.exit.addKVs(data);
      span = last.descend('koa-route', data);
    } catch (e) {
      ao.loggers.error('koa-route failed to build span', e);
    }

    if (span) span.enter()
    const result = route.call(this, ctx);
    if (span) span.exit()
    return result;
  }
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
      // span exit, and create koa-route span
      const data = {Controller, Action}
      this.res._ao_http_span.events.exit.addKVs(data)
      span = last.descend('koa-route', data)
    } catch (e) {
      ao.loggers.error('koa-route failed to build span', e)
    }

    // Enter, run and exit
    if (span) span.enter()
    const res = yield route.call(this, next)
    if (span) span.exit()
    return res
  }
}

function patchRoute (route, method, patcher) {
  shimmer.wrap(route, method, fn => {
    return function (url, route) {
      // Define controller/action at assignment time
      return fn.call(this, url, patcher(
        `${method} ${url}`,
        utility.fnName(route),
        route
      ))
    }
  })
}
