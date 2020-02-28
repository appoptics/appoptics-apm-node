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

const ao = exports;

ao.version = require('../package.json').version;

ao.g = {
  testing: function (filename) {
    ao.g.current = filename
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

// first, set up logging so problems can be reported.
const path = require('path')
const env = process.env

ao.root = path.resolve(__dirname, '..');
ao.nodeEnv = env.NODE_ENV

// don't insert xtrace into outbound http request headers when this property is truthy.
ao.omitTraceId = Symbol('ao.omitTraceId');

const {logger, loggers} = require('./loggers')
ao.logger = logger
const log = ao.loggers = loggers


/**
 * @name ao.logLevel
 * @property {string} - comma separated list of log settings
 * @example <caption>Sets the log settings</caption>
 * ao.logLevel = 'warn,error'
 * @example <caption>Get the log settings</caption>
 * var settings = ao.logLevel
 */
Object.defineProperty(ao, 'logLevel', {
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
ao.logLevelAdd = logger.addEnabled.bind(logger)

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
ao.logLevelRemove = logger.removeEnabled.bind(logger)

//
// now the logging facility is setup
//
if (alreadyLoaded.length && env.NODE_ENV && env.NODE_ENV.toLowerCase() === 'production') {
  log.warn('the following files were loaded before appoptics-apm:', alreadyLoaded)
}

// read the config file so that if it disables the agent it's possible to
// skip loading the bindings.
const uc = (require('./get-unified-config'))();

if (uc.unusedConfig.length) {
  log.warn(`properties in ${uc.file} that were not recognized: ${uc.unusedConfig.join(', ')}`);
}
if (uc.unusedEnvVars.length) {
  log.warn(`environment variables not recognized: ${uc.unusedEnvVars.join(', ')}`);
}
if (uc.unusedProbes.length) {
  log.warn(`config file probes not recognized: ${uc.unusedProbes.join(', ')}`);
}
for (let i = 0; i < uc.errors.length; i++) {
  log.error(uc.errors[i]);
}
for (let i = 0; i < uc.warnings.length; i++) {
  log.warn(uc.warnings[i]);
}
for (let i = 0; i < uc.settingsErrors.length; i++) {
  log.error(uc.settingsErrors[i]);
}

//
// put in their historical variables.
//
ao.probes = uc.probes
ao.specialUrls = uc.transactionSettings && uc.transactionSettings.filter(s => s.type === 'url');
const config = uc.global;
ao.cfg = Object.assign({}, config);


// if inserting into morgan then a token must be created.
if (config.insertTraceIdsIntoMorgan) {
  config.createTraceIdsToken = 'morgan';
}

//
// there isn't really a better place to put this
// it takes an http request object argument.
//
ao.getDomainPrefix = function (req) {
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
ao.makeLogMissing = function makeLogMissing (name) {
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
  //return !!key.match(/^[A-Fa-f0-9]{64}:[a-z0-9.:_-]{1,255}$/)
  return !!key.match(/^([A-Fa-f0-9]{64}|[A-Za-z0-9_-]{71}):[A-Za-z0-9.:_-]{1,255}$/);
}

function cleanseKey (key) {
  let token = '';
  let name = key;

  const colonIndex = key.indexOf(':');
  if (colonIndex >= 0) {
    token = key.slice(0, colonIndex);
    name = key.slice(colonIndex);
  }
  // replace blanks with dashes then remove other illegal characters
  name = name.toLowerCase().replace(/ /g, '-').replace(/[^a-z0-9.:_-]/g, '');

  return token + name;
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

const serviceKey = config.serviceKey || '';

// remove/transform invalid characters.
const cleansedKey = cleanseKey(serviceKey);

// save the key that is being used
/**
 * @name ao.serviceKey
 * @property {string} - the service key
 */
ao.serviceKey = cleansedKey

// and update the config with the key we actually used.
ao.cfg.serviceKey = config.serviceKey = cleansedKey;

//
// now go through a sequence of checks and tests that can result in
// appoptics being disabled. accumulate the errors so a summary message
// with the enabled status can be output at the end of the checks.
//
let enabled = config.enabled
const errors = []

if (!enabled) {
  log.warn('Disabled by config file')
  errors.push('disabled by config file')
}

//
// there must be a valid service key
//
if (!validKey(cleansedKey)) {
  enabled = false
  log.error('No valid serviceKey')
  errors.push('no valid service key')
} else if (!validKey(serviceKey)) {
  // the cleansed key is valid but the original key was not
  log.warn('Invalid service key specified: "%s", using: "%s"', mask(serviceKey), mask(cleansedKey))
} else {
  log.debug('Setting ao.serviceKey to %s', mask(cleansedKey))
}


//
// map valid modes to oboe values for an easy way to validate/convert. They are defined
// here so they can be used when processing the config file.
//
Object.defineProperty(ao, 'modeMap', {
  get () {
    return {0: 0, 1: 1, never: 0, always: 1, disabled: 0, enabled: 1};
  }
})

Object.defineProperty(ao, 'modeToStringMap', {
  get () {
    return {0: 'disabled', 1: 'enabled'};
  }
})

//
// Load continuation-local-storage
//
const contextProviders = {
  clsHooked: 'cls-hooked',
  aceContext: 'ace-context',
}
// if set via environment variable use that context provider otherwise
if (env.AO_CONTEXT in contextProviders) {
  ao.contextProvider = contextProviders[env.AO_CONTEXT]
} else {
  ao.contextProvider = contextProviders.aceContext;
}
log.debug('using context provider:', ao.contextProvider)

//
// load the context provider. the agent will be disabled if the context
// provider cannot be loaded.
//
try {
  ao.cls = require(ao.contextProvider)
} catch (e) {
  enabled = false
  log.error('Can\'t load %s', ao.contextProvider, e.stack)
  errors.push('context provider not loaded')
}

//
// Try to load bindings if not disabled. Handle failure or disabled
// gracefully.
//
let bindings

if (enabled && !env.AO_TEST_NO_BINDINGS) {
  try {
    bindings = require('appoptics-bindings')
  } catch (e) {
    const args = ['Can\'t load bindings'];
    if (e.code !== 'MODULE_NOT_FOUND') {
      args.push(e.stack);
    }
    log.error.apply(log, args);
    errors.push(`require failed: ${e.code ? e.code : ''}`);
  }
} else {
  let msg;
  if (errors.length) {
    msg = 'appoptics-bindings not loaded due to previous errors';
  } else {
    msg = `appoptics-bindings not loaded by ${enabled ? 'env' : 'config'}`
  }
  log.debug(msg);
  errors.push(msg);
}

// whether because explicitly disabled or an error get the essentials
if (!bindings) {
  enabled = false
  bindings = require('./addon-sim')
}
ao.addon = bindings

//
// issue a summary error message if the agent is disabled.
//
if (!enabled) {
  log.error('AppopticsAPM disabled due to: %s', errors.join(', '))
}


// this is not a class in bindings v6. addon-sim will provide
// skeleton functions if bindings is not available.
ao.reporter = bindings.Reporter

// set up a debugging logging controller for specific places
ao.control = {logging: {}}


// don't issue errors for what are normal situations at startup.
let startup = true;
Object.defineProperty(ao, 'startup', {
  get () {
    return startup;
  },
  set (value) {
    startup = value;
  }
})

/**
 * Expose debug logging global and create a function to turn
 * logging on/off.
 *
 * @name ao.loggers
 * @property {object} - the loggers available for use
 */
ao.debugLogging = function (setting) {
  log.enabled = setting
}

// give a quick update
log.debug(
  `apm ${ao.version}, bindings ${bindings.version}, oboe ${bindings.Config.getVersionString()}`
)


//
// bring in the api or simulated api. it needs access to ao.
//
const api = require(enabled ? './api' : './api-sim')(ao);

for (const k of Object.keys(api)) {
  if (k in ao) {
    log.error(`api key ${k} conflicts, ignoring`);
  } else {
    ao[k] = api[k];
  }
}

ao.Event.init(ao);
ao.Span.init(ao);
ao.MB.init(ao);

if (config.traceMode === 0) {
  log.debug('tracing disabled by config');
}

//
// now that the api is loaded the trace mode can be set
//
ao.traceMode = ao.cfg.traceMode;


//
// the rest of the code is only relevant if bindings are loaded.
//
if (enabled) {
  const options = Object.assign({}, ao.cfg);

  // replace the serviceKey with our cleansed service key. the agent
  // will be disabled if the service key doesn't at least look valid.
  options.serviceKey = cleansedKey;

  //
  // initialize liboboe.
  //
  const status = bindings.oboeInit(options)

  let nextTick = process.nextTick;
  if (status > 0) {
    log.error(`failed to initialize, error: ${status}`);
    // don't continue initialization.
    nextTick = function () {};
    // don't enable patching.
    enabled = false;
  }

  //
  // start metrics and send __Init event
  //
  nextTick(function () {

    if (config.runtimeMetrics) {
      ao.metrics = new ao.Metrics();
      ao.metrics.start();
    }

    ao.tContext.run(function () {
      const v = process.versions;
      const kvpairs = {
        '__Init': 1,
        'Node.Version': v.node,
        'Node.V8.Version': v.v8,
        'Node.LibUV.Version': v.uv,
        'Node.OpenSSL.Version': v.openssl,
        'Node.Ares.Version': v.ares,
        'Node.ZLib.Version': v.zlib,
        'Node.HTTPParser.Version': v.llhttp || v.http_parser,
        'Node.Oboe.Version': bindings.Config.getVersionString(),
      }

      const base = path.join(process.cwd(), 'node_modules')
      let modules
      try {
        const fs = require('fs');
        modules = fs.readdirSync(base)
      } catch (e) {}

      if (Array.isArray(modules)) {
        modules.forEach(mod => {
          if (mod === '.bin' || mod[0] === '@') return
          try {
            const pkg = require(`${base}/${mod}/package.json`)
            kvpairs[`Node.Module.${pkg.name}.Version`] = pkg.version
          } catch (e) {}
        })
      }
      startup = false

      log.info('making nodejs:single event')
      const e = new ao.Event('nodejs', 'single', ao.MB.makeRandom(1));

      const status = e.send(kvpairs, 'status-channel');
      if (status < 0) {
        log.error(`init.send(init-status) failed (${status})`)
      } else {
        log.info('init.send(init-status) succeeded')
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
// this is the end of the enabled check
}

// this is the end of the unindented check around whether the
// file has already been loaded.
//
// cache the exports in our own global so they can be reused
// if a package like "stealthy-require" clears node's require
// cache.
global[aoOnce] = ao
}
