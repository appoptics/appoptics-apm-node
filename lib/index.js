'use strict'

// create or get this symbol.
const aoOnce = Symbol.for('AppOptics.Apm.Once')

const alreadyLoaded = Object.keys(require.cache).filter(f => f !== __filename)

// if this symbol is in the global registry then set exports
// to the value cached there. Otherwise set a global property
// to exports (the bottom of the file in the else). This exists
// to prevent problems with the request package which uses
// stealthy-require to brute force multiple instantiations.
if (global[aoOnce]) {
  module.exports = global[aoOnce]
  module.exports.loggers.warn('appoptics-apm is being executed more than once')
} else {
/* eslint-disable indent */
// disable eslint's indent so it doesn't complain because everything in the else
// (all of the file when it's required the first time) isn't indented.

// make global context object with noop testing function. ao.g.testing() is
// setup differently for tests but this allows a single test to run without
// error.
exports.g = {
  testing: function (filename) {
    exports.g.current = filename
  },
  taskDict: {}
}

/**
 * @class ao
 *
 * @example
 * The name ao can be any name you choose. Just require
 * appoptics-apm. In this document ao is used.
 *
 * const ao = require('appoptics-apm')
 */

// read the config file first so that if it disables appoptics then
// the bindings are not loaded.
const path = require('path')
const env = process.env

const udp = env.APPOPTICS_REPORTER === 'udp'
exports.nodeEnv = env.NODE_ENV

const {logger, loggers} = require('./loggers')
exports.logger = logger
const log = exports.loggers = loggers


/**
 * @name ao.logLevel
 * @property {string} - comma separated list of log settings
 * @example <caption>Sets the log settings</caption>
 * ao.logLevel = 'warn,error'
 * @example <caption>Get the log settings</caption>
 * var settings = ao.logLevel
 */
Object.defineProperty(exports, 'logLevel', {
  get () {return logger.logLevel},
  set (value) {logger.logLevel = value}
})

/**
 * Add log levels to the existing set of log levels.
 *
 * @method ao.logLevelAdd
 * @param {string} levels - comma separated list of levels to add
 * @return {string|undefined} - the current log levels or undefined if an error
 *
 * @example
 * ao.logLevelAdd('warn,debug')
 */
exports.logLevelAdd = logger.addEnabled.bind(logger)

/**
 * Remove log levels from the current set.
 *
 * @method ao.logLevelRemove
 * @param {string} levels - comma separated list of levels to remove
 * @return {string|undefined} - log levels after removals or undefined if an
 *                              error.
 * @example
 * var previousLogLevel = ao.logLevel
 * ao.logLevelAdd('debug')
 * ao.logLevelRemove(previousLogLevel)
 */
exports.logLevelRemove = logger.removeEnabled.bind(logger)

//
// now the logging facility is setup
//

if (alreadyLoaded.length && env.NODE_ENV && env.NODE_ENV.toLowerCase() === 'production') {
  log.error('the following files were loaded before appoptics-apm:', alreadyLoaded)
}

//
// get any user settings from the configuration file. no extension is specified so that
// it can be a .json file or a .js module.
//
const defaultConfigFile = path.join(process.cwd(), 'appoptics-apm')
let configFile = defaultConfigFile
if (env.APPOPTICS_APM_CONFIG_NODE) {
  configFile = path.resolve(env.APPOPTICS_APM_CONFIG_NODE);
}

let config
try {
  config = require(configFile)
} catch (e) {
  if (e.code !== 'MODULE_NOT_FOUND' || configFile !== defaultConfigFile) {
    log.error('Cannot read config file %s', configFile, config.configError)
  }
  config = {}
}

// only these non-probe defaults are taken from the config file. because
// probes have a variety of probe-dependent options those are not restricted
// in the same way.
const defaults = {
  global: {
    enabled: true,
    hostnameAlias: undefined,
    traceMode: undefined,
    sampleRate: undefined,
    serviceKey: undefined,
    ignoreConflicts: false,
    domainPrefix: false,
    insertTraceIdsIntoLogs: false,
    insertTraceIdsIntoMorgan: false,    // separate setting because this mucks with log formats directly
    createTraceIdsToken: false,         // 'morgan' to create for morgan. no others supported yet, nor multiple.
  }
}

// now get the probe defaults
try {
  defaults.probes = require('./config-defaults').probes
} catch (e) {
  log.error('Cannot read probe defaults "./config-defaults"', e)
}

config = require('./parse-config')(config, defaults)

// TODO BAM warn about unused config and probe entries?

// get the probes and special URLs before resetting config
exports.probes = config.probes
exports.specialUrls = config.transactionSettings && config.transactionSettings.filter(s => s.type === 'url')
exports.cfg = config = config.global

// if inserting into morgan then a token must be created.
// TODO BAM need to make config setter so this can be done even
// when changed dynamically.
if (config.insertTraceIdsIntoMorgan) {
  config.createTraceIdsToken = true;
}

//
// there isn't really a better place to put this
// it takes an http request object argument.
//
exports.getDomainPrefix = function (req) {
  const h = req.headers
  const s = req.socket || {localPort: 80}
  let prefix = h && h['x-forwarded-host'] || h['host'] || ''
  const parts = prefix.split(':')
  // if the port is included in the header then use it
  if (parts.length === 2 && parts[1]) {
    return prefix
  }
  // use the first part (strips off ':' with nothing after)
  prefix = parts[0]
  if (s.localPort !== 80 && s.localPort !== 443 && prefix !== '') {
    prefix = prefix + ':' + s.localPort
  }
  return prefix
}

//
// Utility function to create function that issues consistently formatted
// messages for patching errors.
//
exports.makeLogMissing = function makeLogMissing (name) {
  const s = `probes.${name} "%s" not found`
  return function logMissing (missing) {
    log.patching(s, missing)
  }
}

//
// Disable module when conflicts are found
//
if (!config.ignoreConflicts) {
  const modules = Object.keys(require.cache)
  const possibleConflicts = [
    'newrelic',
    'strong-agent',
    'appdynamics'
  ]
  function checkMod (conflict, mod) {
    return (new RegExp(`/node_modules/${conflict}/`)).test(mod)
  }
  const conflicts = possibleConflicts.filter(conflict => {
    return modules.filter(mod => checkMod(conflict, mod)).length > 0
  })

  function andList (list) {
    const last = list.pop()
    return (list.length ? list.join(', ') + ', and ' : '') + last
  }

  if (conflicts.length > 0) {
    enabled = false
    log.error([
      'Users have reported that the following modules conflict',
      `with AppOptics instrumentation: ${andList(conflicts)}.`,
      'Please uninstall them and restart the application.'
    ].join(' '))
  }
}

function validKey (key) {
  return !!key.match(/^[A-Fa-f0-9]{64}:[a-z0-9.:_-]{1,255}$/)
}

// mask the service key so it's not revealed when logging. do not presume a
// a valid service key, i.e., 64-hex-digits:1-to-255-valid-name
function mask (key) {
  const parts = key.split(':')
  let keyOnly = parts.shift()
  if (keyOnly.length < 8) {
    keyOnly += '.'.repeat(8 - key.length)
  }
  return keyOnly.slice(0, 4) + '...' + keyOnly.slice(-4) + ':' + parts.join(':')
}

//
// if the service key is defined in the environment then use that. if
// not see if it is defined in the config file.
//
const environmentKey = process.env.APPOPTICS_SERVICE_KEY
let serviceKey = environmentKey
// make sure service key is not undefined and use config value if present
if (!serviceKey) {
  serviceKey =  ''
  if (config.serviceKey) {
    log.debug('using config.serviceKey')
    serviceKey = config.serviceKey
  }
}

// remember if the original key is valid so if the only modification
// is lowercasing it we don't log a warning.
const originalKeyValid = validKey(serviceKey)

// lower case, spaces to hyphens, allow only [a-z0-9.:_-]
const cleansedKey = serviceKey.toLowerCase()
  .replace(/ /g, '-')
  .replace(/[^a-z0-9.:_-]/g, '')

// save the key that is being used
/**
 * @name ao.serviceKey
 * @property {string} - the service key
 */
exports.serviceKey = cleansedKey

// and update the config with the key we actually used.
config.serviceKey = cleansedKey;

// now go through a sequence of checks and tests that can result in
// appoptics being disabled. accumulate the errors so a single message
// with the enabled status can be output at the end of the checks.
let enabled = config.enabled
const errors = []

if (!enabled) {
  log.warn('Disabled by config file')
  errors.push('disabled by config file')
}

if (!validKey(cleansedKey)) {
  enabled = false
  log.error('No valid serviceKey')
  errors.push('no valid service key')
} else if (!originalKeyValid) {
  log.warn('Invalid service key specified: "%s", using: "%s"', mask(serviceKey), mask(cleansedKey))
} else {
  log.debug('Setting ao.serviceKey to %s', mask(cleansedKey))
}


// map valid modes to oboe values for an easy way to validate/convert.
const modeMap = {0: 0, 1: 1, never: 0, always: 1, disabled: 0, enabled: 1, undefined: 1}
const modeToStringMap = {0: 'disabled', 1: 'enabled'}

if (!(config.traceMode in modeMap)) {
  enabled = false
  log.error('invalid traceMode: %s', config.traceMode)
  errors.push('invalid traceMode')
}
// undefined is only valid if missing from the config
delete modeMap.undefined

//
// Try to load bindings if not disabled. Handle failure or disabled
// gracefully.
//
let bindings

if (enabled && !env.AO_TEST_NO_BINDINGS) {
  try {
    bindings = require('appoptics-bindings')
  } catch (e) {
    log.error('Can\'t load bindings', e.stack)
    errors.push('bindings not loaded')
  }
}

// whether because explicitly disabled or an error get the essentials
if (!bindings) {
  enabled = false
  bindings = require('./addon-sim')
  // issue message that bindings are disabled intentionally
  log.debug('appoptics-bindings intentionally disabled')
  errors.push('bindings intentionally not loaded')
}
exports.addon = bindings

//
// Load dependencies
//
// TODO BAM consider not loading these at all if not enabled.
const contextProviders = {
  cls: 'continuation-local-storage',
  clsHooked: 'cls-hooked'
}
// if set via environment variable use that context provider otherwise
if (env.AO_CLS in contextProviders) {
  exports.contextProvider = contextProviders[env.AO_CLS]
} else {
  exports.contextProvider = contextProviders.clsHooked
}
log.debug('using context provider:', exports.contextProvider)

let cls
try {
  cls = require(exports.contextProvider)
} catch (e) {
  enabled = false
  log.error('Can\'t load %s', exports.contextProvider, e.stack)
  errors.push('context provider not loaded')
}

const shimmer = require('ximmer')
const fs = require('fs')

exports.version = require('../package.json').version

function clsCheck (msg) {
  const c = exports.requestStore
  const ok = c && c.active
  if (msg) {
    log.debug('CLS%s %s', ok ? '' : ' NOT ACTIVE', msg)
  }
  return ok
}

exports.clsCheck = clsCheck

if (!enabled) {
  log.error('AppopticsAPM disabled due to: %s', errors.join(', '))
}


// Eagerly create variables to store classes. ES6 does not hoist let statements.
let Event
let Span

const ao = exports   // eslint-disable-line no-unused-vars

// this is not a class in bindings v6 and addon-essentials will
// provide skeleton functions if bindings was not loaded.
exports.reporter = bindings.Reporter

// set up a debugging logging controller for specific places
exports.control = {logging: {}}

//
// Abstract settings with setters and getters
//
let traceMode, sampleRate

/**
 * Check whether the appoptics agent is ready to sample. It will wait up to
 * the specified number of milliseconds before returning.
 * @method ao.readyToSample
 * @param {Number} ms - milliseconds to wait; default 0 means don't wait (poll).
 * @param {Object} [obj] - if present obj.status will receive low level status
 * @returns {boolean} - true if ready to sample; false if not
 */
/**
 * @ignore
 * UNKNOWN 0
 * OK 1
 * TRY_LATER 2
 * LIMIT_EXCEEDED 3
 * INVALID_API_KEY 4
 * CONNECT_ERROR 5
 */
exports.readyToSample = function (ms, obj) {
  const status = exports.reporter.isReadyToSample(ms)
  // if the caller wants the actual status provide it
  if (obj && typeof obj === 'object') {
    obj.status = status
  }

  return status === 1
}

/**
 * Get and set the trace mode
 *
 * @name ao.traceMode
 * @property {string} - the sample mode
 */
Object.defineProperty(exports, 'traceMode', {
  get () {return modeToStringMap[traceMode]},
  set (value) {
    if (!(value in modeMap)) {
      log.error('invalid traceMode', value)
      return
    }
    log.info('setting traceMode to ' + value)
    value = modeMap[value]
    bindings.Context.setTracingMode(value)
    traceMode = value
  }
})

/**
 * @ignore
 * Get and set the sample rate. The number is parts of 1,000,000
 * so 100,000 represents a 10% sample rate.
 *
 * @name ao.sampleRate
 * @property {number} - this value divided by 1000000 is the sample rate.
 */
Object.defineProperty(exports, 'sampleRate', {
  get () {return sampleRate},
  set (value) {
    log.info('set sample rate to ' + value)
    const rateUsed = bindings.Context.setDefaultSampleRate(value)
    if (rateUsed !== value && value !== -1) {
      if (rateUsed === -1) {
        // value was not a valid number, don't use it
        log.warn('Invalid sample rate: %s, not changed', value)
        return;
      }
      //
      log.warn('Sample rate (%s) out of range, using %s', value, rateUsed)
    }
    sampleRate = rateUsed
  }
})


//
// Use continuation-local-storage to follow traces through a request
//
const storeName = 'ao-request-store'
Object.defineProperty(exports, 'requestStore', {
  get () {
    return cls.getNamespace(storeName) || cls.createNamespace(storeName)
  }
})

exports.resetRequestStore = function () {
  cls.destroyNamespace(storeName)
}

/**
 * Return whether or not the current code path is being traced.
 *
 * @name ao.tracing
 * @property {boolean}
 * @readOnly
 */
Object.defineProperty(exports, 'tracing', {
  get () {return !!Event.last}
})

/**
 * Get X-Trace ID of the last event
 *
 * @name ao.traceId
 * @property {string} - the trace ID as a string or undefined if not tracing.
 * @readOnly
 */
Object.defineProperty(exports, 'traceId', {
  get () {
    const last = Event && Event.last
    if (last) return last.toString()
  }
})

Object.defineProperty(exports, 'lastEvent', {
  get () {
    return Event && Event.last
  }
})

Object.defineProperty(exports, 'lastSpan', {
  get () {
    return Span && Span.last
  }
})

/**
 * Expose debug logging global and create a function to turn
 * logging on/off.
 *
 * @name ao.loggers
 * @property {object} - the loggers available for use
 */
exports.debugLogging = function (setting) {
  log.enabled = setting
}

//
// ao.stack - generate a stack trace with this call removed
//
// text - used as Error(text)
// n - the depth of the stack trace to generate.
//
exports.stack = function (text, n) {
  const original = Error.stackTraceLimit
  // increase the stackTraceLimit by one so this function call
  // can be removed.
  if (!n) {
    n = Error.stackTraceLimit
  }
  Error.stackTraceLimit = n + 1

  const e = new Error(text)
  const stackLines = e.stack.split('\n')

  Error.stackTraceLimit = original
  // remove the call to this function
  return [stackLines[0]].concat(stackLines.slice(2)).join('\n')
}

/**
 * Bind a function to the CLS context if tracing.
 *
 * @method ao.bind
 * @param {function} fn - The function to bind to the context
 * @return {function} The bound function or the unmodified argument if it can't
 *   be bound.
 */
exports.bind = function (fn) {
  try {
    if (exports.tracing && typeof fn === 'function') {
      return exports.requestStore.bind(fn)
    }

    const name = fn ? fn.name : 'anonymous'
    // it's not quite right so issure diagnostic message
    if (!clsCheck()) {
      const e = new Error('CLS NOT ACTIVE')
      log.bind('ao.bind(%s) - no context', name, e.stack)
    } else if (!exports.tracing) {
      log.bind('ao.bind(%s) - not tracing', name)
    } else if (fn !== undefined) {
      const e = new Error('Not a function')
      log.bind('ao.bind(%s) - not a function', fn, e.stack)
    }
  } catch (e) {
    log.error('failed to bind callback', e.stack)
  }

  // return the caller's argument no matter what.
  return fn
}

const dbBind = new log.Debounce('bind')
const dbInfo = new log.Debounce('info')
//const dbNotTracing = new log.Debounce('info')
//const dbNotEmitter = new log.Debounce('error')
//const dbUnknown = new log.Debounce('info')

/**
 * Bind an emitter if tracing
 *
 * @method ao.bindEmitter
 * @param {EventEmitter} em The emitter to bind to the trace context
 * @return {EventEmitter} The bound emitter or the original emitter if an error.
 */
exports.bindEmitter = function (em) {
  let emitter = false
  try {
    if (em && typeof em.on === 'function') {
      emitter = true
      // allow binding if tracing or an http emitter (duck-typing check). no
      // last event has been setup when the http instrumentation binds the
      // events but there must be CLS context.
      if (exports.tracing || (clsCheck() && (em.headers && em.socket))) {
        exports.requestStore.bindEmitter(em)
        return em
      }
    }

    const e = new Error('CLS NOT ACTIVE')
    if (!clsCheck()) {
      dbBind.log('ao.bindEmitter - no context', e.stack)
    } else if (!exports.tracing) {
      dbInfo.log('ao.bindEmitter - not tracing')
    } else if (!emitter) {
      dbBind.log('ao.bindEmitter - non-emitter', e.stack)
    } else {
      dbBind.log('ao.bindEmitter - couldn\'t bind emitter')
    }
  } catch (e) {
    log.error('failed to bind emitter', e.stack)
  }

  // return the original if it couldn't be bound for any reason.
  return em
}


/**
 * Generate a backtrace string
 *
 * @method ao.backtrace
 * @returns {string} the backtrace
 */
exports.backtrace = function ()  {
  const e = new Error('backtrace')
  return e.stack.replace(/[^\n]*\n\s+/, '').replace(/\n\s*/g, '\n')
}

/**
 * Set a custom transaction name function for a specific probe. This is
 * most commonly used when setting custom names for all or most routes.
 *
 * @method ao.setCustomTxNameFunction
 * @param {string} probe - The probe to set the function for
 * @param {function} fn - A function that returns a string custom name or a
 *                        falsey value indicating the default should be used.
 *                        Pass a falsey value for the function to clear.
 * @returns {boolean} true if successfully set else false
 *
 * @example
 * // custom transaction function signatures for supported probes:
 * express: customFunction (req, res)
 * hapi: customFunction (request)
 */
exports.setCustomTxNameFunction = function (probe, fn) {
  // if the probe exists set the function and return success
  if (probe in exports.probes && typeof fn === 'function') {
    exports.probes[probe].customNameFunc = fn
    return true
  }
  // return failure
  return false
}

function noop () {}

// give a quick update
log.debug(
  `apm ${exports.version}, bindings ${bindings.version}, oboe ${bindings.Config.getVersionString()}`
)

//
// The remaining things require bindings to be present. Supply dummy functions to make
// the API work if the agent is disabled.
//
if (!enabled) {
  exports.reportError = noop
  exports.instrument = function (build, run, opts, cb) {
    return run(typeof opts === 'function' ? opts : cb)
  }
  exports.startOrContinueTrace = function (xtrace, build, run, opts, cb) {
    return run(typeof opts === 'function' ? opts : cb)
  }
  exports.getTraceSettings = function (xtrace, localMode) {
    return bindings.Context.getTraceSettings({xtrace})
  }
  //
  // from api.js
  //
  exports.sendMetric = function () {
    return 0;
  }
  exports.getFormattedTraceId = function () {
    return '0000000000000000000000000000000000000000-0'
  }
  exports.insertLogObject = function (object) {
    return object;
  }

  exports.Span = {};
  exports.Event = {};
} else {
  //
  // initialize liboboe
  //
  const options = {}
  if (exports.cfg.hostnameAlias) {
    options.hostnameAlias = exports.cfg.hostnameAlias
  }

  // delete the environment variable, init oboe, and restore it. this is
  // done because oboe will prefer the environment variable to anything
  // specified here.
  delete env.APPOPTICS_SERVICE_KEY
  bindings.oboeInit(cleansedKey, options)
  if (environmentKey || environmentKey === '') {
    env.APPOPTICS_SERVICE_KEY = environmentKey
  }

  /**
   * @typedef {object} TraceSettings
   * @property {boolean} doSample - the sample decision
   * @property {boolean} doMetrics - the metrics decision
   * @property {Metadata} metadata - the metadata to use
   * @property {boolean} edge - whether to edge back to metadata
   * @property {number} source - the sample decision source
   * @property {number} rate - the sample rate used
   */

  /**
   * make an alias for what will become the new oboe sample call.
   *
   * @ignore
   * @method ao.getTraceSettings
   * @param {string} xtrace
   * @param {number} [localMode=undefined]
   * @returns {TraceSettings} settings
   */
  exports.getTraceSettings = function (xtrace, localMode) {
    const settings = {xtrace: xtrace || ''}

    if (localMode !== undefined) {
      settings.mode = localMode
    }
    const osettings = bindings.Context.getTraceSettings(settings)

    // handle this for testing
    if (udp) {
      osettings.doMetrics = osettings.doSample
    }

    exports.lastSettings = osettings

    if (osettings.error) {
      log.warn(`getTraceSettings() - ${osettings.message}(${osettings.error})`)
      return {
        doSample: false,
        doMetrics: false,
        source: 5,
        rate: 0,
        edge: false,
        metadata: bindings.Metadata.makeRandom(0)
      }
    }

    return osettings
  }

  // keep track of the last settings received from oboe
  exports.lastSettings = {}

  /**
   * Determine if the sample flag is set for the various forms of
   * metadata.
   *
   * @method ao.sampling
   * @param {string|Event|Metadata} item - the item to get the sampling flag of
   * @returns {boolean} - true if the sample flag is set else false.
   */

  exports.sampling = function (item) {
    if (typeof item === 'string') {
      return item.length === 60 && item[59] === '1'
    }

    if (item instanceof Event) {
      return item.event.getSampleFlag()
    }

    if (item instanceof bindings.Metadata) {
      return item.getSampleFlag()
    }

    throw new Error('Sampling called with ' + item)
  }

  /**
   * Convert an xtrace ID to a metadata object.
   *
   * @method ao.stringToMetadata
   * @param {string} xtrace - X-Trace ID, string version of Metadata.
   * @return {bindings.Metadata|undefined} - bindings.Metadata object if
   *                                         successful.
   */
  exports.stringToMetadata = function (xtrace) {
    // if the conversion fails undefined is returned
    let md

    // the oboe conversion function doesn't check for an all-zero op ID.
    if (xtrace.indexOf('0000000000000000', 42) !== 42) {
      md = bindings.Metadata.fromString(xtrace)
    }
    return md
  }


  /**
   * Patch an HTTP response object to trigger ao-response-end events
   *
   * @ignore
   * @method ao.patchResponse
   * @param {HTTPResponse} res HTTP Response object
   */
  const responseIsPatched = new WeakMap()
  exports.patchResponse = function (res) {
    if (!responseIsPatched.get(res)) {
      responseIsPatched.set(res, true)
      shimmer.wrap(res, 'end', fn => function () {
        // Find and run finalizers
        const finalizers = responseFinalizers.get(res) || []
        finalizers.reverse().forEach(finalizer => finalizer())

        // Cleanup after ourselves
        responseFinalizers.delete(res)
        responseIsPatched.delete(res)

        // Run the real end function
        return fn.apply(this, arguments)
      })
    }
  }


  /**
   * Add a finalizer to trigger when the response ends
   *
   * @ignore
   * @method ao.addResponseFinalizer
   * @param {HTTPResponse} res - HTTP Response to attach a finalizer to
   * @param {function} finalizer - Finalization function
   */
  const responseFinalizers = new WeakMap()
  exports.addResponseFinalizer = function (res, finalizer) {
    const finalizers = responseFinalizers.get(res)
    finalizers
      ? finalizers.push(finalizer)
      : responseFinalizers.set(res, [finalizer])
  }

  /**
   * @typedef {object} spanInfo
   * @property {string} name - the name for the span
   * @property {object} [kvpairs] - kvpairs to add to the span
   * @property {function} [finalize] - callback receiving created span
   */

  /**
   * @typedef {function} spanInfoFunction
   * @returns {spanInfo}
   */

  /**
   * Instrument HTTP request/response
   *
   * @method ao.instrumentHttp
   * @param {string|spanInfoFunction} span - name or function returning spanInfo
   * @param {function} run - code to instrument and run
   * @param {object} [options] - options
   * @param {object} [options.enabled] - enable tracing, on by default
   * @param {object} [options.collectBacktraces] - collect backtraces
   * @param {HTTPResponse} res - HTTP response to patch
   * @returns the value returned by the run function or undefined if it can't be run.
   */
  exports.instrumentHttp = function (build, run, options, res) {
    // If not tracing, skip
    const last = Span.last
    if (!last) {
      log.warn('instrumentHttp: no last span')
      return run()
    }
    if ('enabled' in options && !options.enabled) {
      log.info('instrumentHttp: disabled by option')
      return run()
    }

    exports.patchResponse(res)

    let span
    try {
      let name = build
      let kvpairs = {}
      let finalize
      // Build span
      if (typeof build === 'function') {
        const spanInfo = build()
        name = spanInfo.name
        kvpairs = spanInfo.kvpairs || {}
        finalize = spanInfo.finalize
      }

      // attach backtrace if this trace is sampled and configured.
      if (options.collectBacktraces && last.doSample) {
        kvpairs.Backtrace = exports.backtrace(4)
      }
      span = last.descend(name, kvpairs)

      if (finalize) {
        finalize(span, last)
      }

    } catch (e) {
      log.error('instrumentHttp failed to build span %s', e.stack)
    }

    let ctx
    try {
      if (span && !span.descended) {
        ctx = exports.requestStore.createContext()
        exports.requestStore.enter(ctx)
      }
    } catch (e) {
      log.error('instrumentHttp failed to enter span %l', span)
    }

    if (span) {
      span.enter()
      exports.addResponseFinalizer(res, () => {
        span.exit()
        try {
          if (ctx) {
            exports.requestStore.exit(ctx)
          } else if (!span.descended) {
            log.error('no context for undescended span')
          }
        } catch (e) {
          log.error('instrumentHttp failed to exit span %l', span)
        }
      })
    }

    try {
      return run.call(span)
    } catch (err) {
      if (span) span.setExitError(err)
      throw err
    }
  }

  // don't issue errors during startup
  let startup = true

  /**
   * Apply custom instrumentation to a synchronous or async-callback function.
   *
   * @method ao.instrument
   * @param {string|spanInfoFunction} span - span name or span-info function
   *     If `span` is a string then a span is created with that name. If it
   *     is a function it will be run only if tracing; it must return a
   *     spanInfo-compatible object - see instrumenting-a-module.md in guides/.
   * @param {function} run - the function to instrument<br/><br/>
   *     Synchronous `run` function:<br/>
   *     the signature has no callback, e.g., `function run () {...}`. If a
   *     synchronous `run` function throws an error appoptics will report that
   *     error for the span and re-throw the error.<br/>
   *     <br/>
   *     Asynchronous `run` function:<br/>
   *     the signature must include a done callback that is used to let
   *     AppOptics know when your instrumented async code is done running,
   *     e.g., `function run (done) {...}`. In order to report an error for
   *     an async span the done function must be called with an Error object
   *     as the argument.
   * @param {object} [options] - options
   * @param {boolean} [options.enabled=true] - enable tracing
   * @param {boolean} [options.collectBacktraces=false] - collect stack traces.
   * @param {function} [callback] - optional callback, if async
   * @returns {value} the value returned by the run function or undefined if it can't be run
   *
   * @example
   * //
   * // A synchronous `run` function.
   * //
   * //   If the run function is synchronous the signature does not include
   * //   a callback, e.g., `function run () {...}`.
   * //
   *
   * function spanInfo () {
   *   return {name: 'custom', kvpairs: {Foo: 'bar'}}
   * }
   *
   * function run () {
   *   const contents = fs.readFileSync('some-file', 'utf8')
   *   // do things with contents
   * }
   *
   * ao.instrument(spanInfo, run)
   *
   * @example
   * //
   * // An asynchronous `run` function.
   * //
   * // Rather than callback directly, you give the done argument.
   * // This tells AppOptics when your instrumented code is done running.
   * //
   * // The `callback` function is the callback you normally would have given
   * // directly to the code you want to instrument. It receives the same
   * // arguments as were received by the `done` callback for the `run` function
   * // and the same `this` context is also applied to it.
   *
   * function spanInfo () {
   *   return {name: 'custom', {Foo: 'bar'}}
   * }
   *
   * function run (done) {
   *   fs.readFile('some-file', done)
   * }
   *
   * function callback (err, data) {
   *   console.log('file contents are: ' + data)
   * }
   *
   * ao.instrument(spanInfo, run, callback)
   */
  exports.instrument = function (span, run, options, callback) {
    // Verify that a run function is given
    if (typeof run !== 'function') {
      log.error(`ao.instrument() run function is ${typeof run}`)
      return
    }

    // Normalize dynamic arguments
    try {
      if (typeof options === 'function') {
        callback = options
        options = {enabled: true}
      } else {
        if (typeof options !== 'object') {
          if (options !== undefined) {
            log.warn(`ao.instrument() options is ${typeof options}`)
          }
          options = {}
        }
        // default enabled to true if not explicitly false
        options = Object.assign({enabled: true}, options)
      }

      if (!callback && run.length) {
        callback = noop
      }
    } catch (e) {
      log.error('ao.instrument failed to normalize arguments', e.stack)
    }

    // If not tracing, there is some error, skip.
    const last = Span.last
    if (!last) {
      if (!startup) {
        log.info('ao.instrument found no lastSpan')
      }
      return run(callback)
    }

    // If not enabled, skip but maintain context
    if (!options.enabled) {
      log.info('ao.instrument disabled by option')
      return run(exports.bind(callback))
    }

    return runInstrument(last, span, run, options, callback)
  }

  /**
   * Apply custom instrumentation to a promise-returning asynchronous function.
   *
   * @method ao.pInstrument
   * @param {string|spanInfoFunction} span - span name or span-info function
   *     If `span` is a string then a span is created with that name. If it
   *     is a function it will be run only if tracing; it must return a
   *     spanInfo-compatible object - see instrumenting-a-module.md in guides/.
   * @param {function} run - the function to instrument<br/><br/>
   *     This function must return a promise.
   * @param {object} [options] - options
   * @param {boolean} [options.enabled=true] - enable tracing
   * @param {boolean} [options.collectBacktraces=false] - collect stack traces.
   * @returns {Promise} the value returned by the run function or undefined if it can't be run
   *
   * @example
   * //
   * // A synchronous `run` function.
   * //
   * //   If the run function is synchronous the signature does not include
   * //   a callback, e.g., `function run () {...}`.
   * //
   *
   * function spanInfo () {
   *   return {name: 'custom', kvpairs: {Foo: 'bar'}}
   * }
   *
   * function run () {
   *   return axios.get('https://google.com').then(r => {
   *     ...
   *     return r;
   *   })
   * }
   *
   * ao.pInstrument(spanInfo, run).then(...)
   */
  exports.pInstrument = function pInstrument (name, task, options = {}) {
    if (typeof task !== 'function') {
      return exports.instrument(...arguments)
    }

    const wrapped = cb => {
      const p = task();
      if (!p || !p.then) {
        cb();
        return p
      }
      return p.then(r => {
        cb();
        return r;
      }).catch(e => {
        cb(e);
        throw e;
      })
    }

    // this needs to appear async to ao.instrument, so wrapped supplies a callback. but
    // this code doesn't have a callback because the resolution of the promise is what
    // signals the task function's completion, so no 4th argument is supplied.
    //
    // ao.instrument returns wrapped()'s value which is the original promise
    // that task() returns. the resolution of the promise is the value that
    // task() resolved the promise with or a thrown error. the point of
    // wrapped() is to make the callback that results in exiting the the span before
    // resolving the promise.
    return exports.instrument(name, wrapped, options)
  }

  //
  // This builds a span descending from the supplied span using the ao.instrument's arguments
  //
  function runInstrument (last, make, run, options, callback) {
    // Verify that a name or span-info function is given
    if (!~['function', 'string'].indexOf(typeof make)) {
      log.error('ao.runInstrument found no span name or span-info function')
      return run(callback)
    }

    // Build span. Because last must exist this function cannot be used
    // for a root span.
    let span
    try {
      let name = make
      let kvpairs = {}
      let finalize
      if (typeof make === 'function') {
        const spanInfo = make(last)
        name = spanInfo.name
        kvpairs = spanInfo.kvpairs
        finalize = spanInfo.finalize
      }
      if (name) {
        span = last.descend(name, kvpairs)
      }

      if (finalize) {
        finalize(span, last)
      }
    } catch (e) {
      log.error('ao.runInstrument failed to build span', e.stack)
    }

    // run span
    return runSpan(span, run, options, callback)
  }

  //
  // Set backtrace, if configured to do so, and run already constructed span
  //
  function runSpan (span, run, options, callback) {
    if (!span) {
      return run(callback)
    }

    // Attach backtrace if sampling and enabled.
    if (span.doSample && options.collectBacktraces) {
      span.events.entry.set({Backtrace: exports.backtrace()})
    }

    // save the transaction name properties if doing metrics.
    if (span.topSpan && span.doMetrics) {
      span.defaultTxName = options.defaultTxName
      span.customTxName = options.customTxName
    }

    // Detect if sync or async, and run span appropriately
    return callback
      ? span.runAsync(makeWrappedRunner(run, callback))
      : span.runSync(run)
  }

  // This makes a callback-wrapping span runner
  function makeWrappedRunner (run, callback) {
    return wrap => run(wrap(callback))
  }

  /**
   * Start or continue a trace. Continue is in the sense of continuing a
   * trace based on an X-Trace ID received from an external source, e.g.,
   * HTTP headers or message queue headers.
   *
   * @method ao.startOrContinueTrace
   * @param {string} xtrace - X-Trace ID to continue from or null
   * @param {string|spanInfoFunction} span - name or function returning spanInfo
   * @param {function} run - run this function. sync if no arguments, async if one.
   * @param {object}  [opts] - options
   * @param {boolean} [opts.enabled=true] - enable tracing
   * @param {boolean} [opts.collectBacktraces=false] - collect backtraces
   * @param {string|function} [opts.customTxName] - name or function
   * @returns {value} the value returned by the run function or undefined if it can't be run
   *
   * @example
   * ao.startOrContinueTrace(
   *   null,
   *   'sync-span-name',
   *   functionToRun,           // synchronous so function takes no arguments
   *   {customTxName: 'special-span-name'}
   * )
   * @example
   * ao.startOrContinueTrace(
   *   null,
   *   'sync-span-name',
   *   functionToRun,
   *   // note - no context is provided for the customTxName function. If
   *   // context is required the caller should wrap the function in a closure.
   *   {customTxName: customNameFunction}
   * )
   * @example
   * // this is the function that should be instrumented
   * request('https://www.google.com', function realCallback (err, res, body) {...})
   * // because asyncFunctionToRun only accepts one parameter it must be
   * // wrapped, so the function to run becomes
   * function asyncFunctionToRun (cb) {
   *   request('https://www.google.com', cb)
   * }
   * // and realCallback is supplied as the optional callback parameter
   *
   * ao.startOrContinueTrace(
   *   null,
   *   'async-span-name',
   *   asyncFunctionToRun,     // async, so function takes one argument
   *   // no options this time
   *   realCallback            // receives request's callback arguments.
   * )
   */
  exports.startOrContinueTrace = function (xtrace, build, run, opts, cb) {
    // Verify that a run function is given
    if (typeof run !== 'function') return

    try {
      if (typeof opts !== 'object') {
        cb = opts
        opts = {enabled: true}
      } else {
        // default enabled to true if not explicitly false
        opts = Object.assign({enabled: true}, opts)
      }

      if (!cb && run.length) {
        cb = noop
      }
    } catch (e) {
      log.error('ao.startOrContinueTrace can\'t normalize arguments', e.stack)
    }

    // verify that a span name or span-info function is provided. it is called
    // build for historical reasons.
    if (!~['function', 'string'].indexOf(typeof build)) {
      return run(cb)
    }

    // If not enabled, skip
    if (!opts.enabled) {
      return run(exports.bind(cb))
    }

    // If already tracing, continue the existing trace ignoring
    // any xtrace passed as the first argument.
    const last = Span.last
    if (last) {
      return runInstrument(last, build, run, opts, cb)
    }

    // Should this be sampled?
    let settings
    try {
      settings = exports.getTraceSettings(xtrace)
    } catch (e) {
      log.error('ao.startOrContinueTrace can\'t get a sample decision', e.stack)
      settings = {doSample: false, doMetrics: false, source: 5, rate: 0}
    }

    let span
    try {
      // try to create the span
      let name = build
      let kvpairs = {}
      let finalize
      if (typeof build === 'function') {
        const spanInfo = build()
        name = spanInfo.name
        kvpairs = spanInfo.kvpairs
        finalize = spanInfo.finalize
      }
      span = Span.makeEntrySpan(name, settings, kvpairs)

      if (finalize) {
        // no last or runInstrument() would already have been called.
        finalize(span)
      }
    } catch (e) {
      log.error('ao.startOrContinueTrace failed to build span %s', build)
    }

    // if no span can't do sampling or inbound metrics - need a context.
    if (!span) {
      return run(cb)
    }

    // Add sampling data to entry if there was not already an xtrace ID
    if (settings.doSample && !xtrace) {
      span.events.entry.set({
        SampleSource: settings.source,
        SampleRate: settings.rate
      })
    }

    // supply a default in case the user didn't provide a txname or a
    // function to return a txname. if the span is unnamed then let oboe
    // provide "unknown"
    opts.defaultTxName = span.name ? 'custom-' + span.name : ''

    return runSpan(span, run, opts, cb)
  }

  /**
   * Start or continue a trace running a function that returns a promise. Continue is in
   * the sense of continuing a trace based on an X-Trace ID received from an external
   * source, e.g., HTTP headers or message queue headers.
   *
   * @method ao.pStartOrContinueTrace
   * @param {string} xtrace - X-Trace ID to continue from or null
   * @param {string|spanInfoFunction} span - name or function returning spanInfo
   * @param {function} run - the promise-returning function to instrument
   * @param {object}  [opts] - options
   * @param {boolean} [opts.enabled=true] - enable tracing
   * @param {boolean} [opts.collectBacktraces=false] - collect backtraces
   * @param {string|function} [opts.customTxName] - name or function
   * @returns {Promise} the value returned by the run function or undefined if it can't be run
   *
   * @example
   *
   * function spanInfo () {
   *   return {name: 'custom', kvpairs: {Foo: 'bar'}}
   * }
   *
   * // axios returns a promise
   * function functionToRun () {
   *   return axios.get('https://google.com').then(r => {
   *     ...
   *     return r;
   *   })
   * }
   *
   * ao.pStartOrContinueTrace(
   *   null,
   *   spanInfo,
   *   functionToRun,
   * ).then(...)
   */
  exports.pStartOrContinueTrace = function (xtrace, name, task, options = {}) {
    if (typeof task !== 'function') {
      return exports.startOrContinueTrace(...arguments);
    }

    const wrapped = cb => {
      const p = task();
      if (!p || !p.then) {
        cb();
        return p
      }
      return p.then(r => {
        cb();
        return r;
      }).catch(e => {
        cb(e);
        throw e;
      })
    }

    return exports.startOrContinueTrace(xtrace, name, wrapped, options);
  }

  exports.noop = noop

  /**
   * Report an error event in the current trace.
   *
   * @method ao.reportError
   * @param {Error} error - The error instance to report
   */
  exports.reportError = function (error) {
    const last = Span.last
    if (last) last.error(error)
  }


  /**
   * Report an info event in the current trace.
   *
   * @method ao.reportInfo
   * @param {object} data - Data to report in the info event
   */
  exports.reportInfo = function (data) {
    const last = Span.last
    if (last) last.info(data)
  }


  //
  // Expose lower-level components
  //
  Span = require('./span')
  Event = require('./event')
  exports.Span = Span
  exports.Event = Event

  //
  // bring in the api. it needs access to ao.
  //
  const api = require('./api')(exports);

  for (const k of Object.keys(api)) {
    if (k in exports) {
      log.error(`api key ${k} conflicts, ignoring`);
    } else {
      exports[k] = api[k];
    }
  }


  const nextTick = enabled ? process.nextTick : noop
  //
  // Send __Init event
  //
  nextTick(function () {
    exports.requestStore.run(function () {
      const data = {
        '__Init': 1,
        'Layer': 'nodejs',
        'Label': 'single',
        'Node.Version': process.versions.node,
        'Node.V8.Version': process.versions.v8,
        'Node.LibUV.Version': process.versions.uv,
        'Node.OpenSSL.Version': process.versions.openssl,
        'Node.Ares.Version': process.versions.ares,
        'Node.ZLib.Version': process.versions.zlib,
        'Node.HTTPParser.Version': process.versions.http_parser,
        'Node.Oboe.Version': bindings.Config.getVersionString(),
      }

      const base = path.join(process.cwd(), 'node_modules')
      let modules
      try {
        modules = fs.readdirSync(base)
      } catch (e) {}

      if (Array.isArray(modules)) {
        modules.forEach(mod => {
          if (mod === '.bin' || mod[0] === '@') return
          try {
            const pkg = require(`${base}/${mod}/package.json`)
            data[`Node.Module.${pkg.name}.Version`] = pkg.version
          } catch (e) {}
        })
      }
      startup = false
      log.info('making nodejs:single event')
      const md = bindings.Metadata.makeRandom(1)
      const e = new Event('nodejs', 'single', md)

      const status = e.sendStatus(data)
      if (status < 0) {
        log.error(`init.sendStatus() failed (${status})`)
      } else {
        log.info('init.sendStatus() succeeded')
      }

    })
  })

  //
  // Enable require monkey-patcher
  //
  if (enabled) {
    const patcher = require('./require-patch')
    patcher.enable()
  }
// this is the end of the eanbled check
}

// this is the end of the unindented check around whether the
// file has already been loaded.
//
// cache the exports in our own global so they can be reused
// if a package like "stealthy-require" clears node's require
// cache.
global[aoOnce] = exports
}
