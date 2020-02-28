'use strict'

const shimmer = require('ximmer')
const semver = require('semver');

const ao = require('..')
const utility = require('../utility')
const requirePatch = require('../require-patch');

const logMissing = ao.makeLogMissing('restify');

const conf = ao.probes.restify


function patchServerMethodArg (method, opts, fn) {
  return function (...args) {
    const [, res] = args

    // Determine controller and action values
    // NOTE: restify has no "controller" concept, use url pattern
    const Controller = `${method.toUpperCase()} ${opts.path || opts}`
    const Action = utility.fnName(fn)

    // Create data object
    const kvpairs = {Controller, Action}

    // Store the latest middleware Controller/Action on exit
    const outer = res._ao_http_span
    if (outer) {
      outer.events.exit.addKVs(kvpairs)
    }

    let span
    return ao.instrumentHttp(
      () => {
        return {
          name: 'restify-route',
          kvpairs,
          finalize (createdSpan) {
            span = createdSpan
          }
        }
      },
      () => {
        try {
          if (span) {
            const {exit} = span
            span.exit = utility.once(() => exit.call(span))
            args.push(utility.before(
              args.pop(),
              () => span.exit()
            ))
          }
        } catch (e) {
          ao.loggers.error('error in restify runner', e)
        }
        return fn.apply(this, args)
      },
      conf,
      res
    )
  }
}

function patchServerMethod (server, method) {
  if (typeof server[method] !== 'function') {
    logMissing(`server.${method}()`);
    return
  }
  shimmer.wrap(server, method, fn => function (opts, ...args) {
    // Map all args after opts into patcher
    return fn.apply(this, [opts].concat(
      args.map(fn => patchServerMethodArg(method, opts, fn))
    ))
  })
}

function patchServer (server) {

  const methods = [
    'del',
    'get',
    'head',
    'opts',
    'post',
    'put',
    'patch'
  ];
  methods.forEach(method => patchServerMethod(server, method))
}

function patchCreateServer (restify, version) {
  if (typeof restify.createServer !== 'function') {
    logMissing('restify.createServer()');
    return
  }
  shimmer.wrap(restify, 'createServer', fn => function () {
    const server = fn.apply(this, arguments)
    patchServer(server)
    return server
  })
}

//
// Apply restify patches
//
module.exports = function (restify, options) {
  let proto;
  try {
    const Server = requirePatch.relReq('restify/lib/server.js');
    proto = Server.prototype;
  } catch (e) {
  }
  if (!proto) {
    logMissing('Server.prototype');
    return restify;
  }
  // _handle was changed to _onRequest in v7.0.0. additionally, while _handle was
  // just called prior to v7, _onRequest is bound in the call to createServer, so
  // wrapping it after createServer is called won't work. wrapping both here allows
  // the same code to work with both pre- and post-v7 (with just the name change).
  const name = semver.gte(options.version, '7.0.0') ? '_onRequest' : '_handle';

  if (typeof proto[name] !== 'function') {
    logMissing(`Server.prototype.${name}()`);
    return restify;
  }
  shimmer.wrap(proto, name, fn => function (req, res) {
    return ao.instrumentHttp(
      'restify',
      () => fn.apply(this, arguments),
      conf,
      res
    )
  })

  patchCreateServer(restify, options.version);
  return restify;
}
