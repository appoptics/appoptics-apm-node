'use strict'

const {ao} = require('./1.test-common')
exports.ao = ao
const debug = ao.logger.debug
const realPort = ao.port
ao.skipSample = true

const Emitter = require('events').EventEmitter
const extend = require('util')._extend
const BSON = require('bson')
const dgram = require('dgram')
const https = require('https')
const http = require('http')
const path = require('path')
const assert = require('assert')
const util = require('util')
const expect = require('chai').expect

Error.stackTraceLimit = 25

const log = ao.loggers

exports.clsCheck = function () {
  const c = ao.tContext
  if (!c || !c.active) {
    throw new Error('CLS: NO ACTIVE ao-request-store NAMESPACE')
  }
}
function ids (x) {return [x.substr(2, 40), x.substr(42, 16)]}
exports.ids = ids

exports.noop = function () {}

// each module must implement. this only provides a
// common framework to check the environment variable.
exports.skipTest = function (filename) {
  if (!process.env.AO_SKIP_TEST) {
    return false
  }

  const skips = process.env.AO_SKIP_TEST.split(',')
  const test = path.basename(filename, '.test.js')

  if (!~skips.indexOf(test)) {
    return false
  }

  ao.loggers.warn('skipping test', test)
  return true
}

const env = process.env

// turn off logging if requested. pretty much any falsey string except '' does
// it. don't accept '' because that used to turn on showing logs, but the
// default has inverted.
if (['false', 'f', '0', 'n', 'no'].indexOf(env.AO_TEST_SHOW_LOGS) >= 0) {
  log.debug('AO_TEST_SHOW_LOGS set falsey, turning off logging')
  let logs = (process.env.DEBUG || '').split(',')
  logs = logs.filter(function (item) {
    return !item.startsWith('appoptics:')
  }).join(',')
  // set to whatever it was with appoptics items removed
  process.env.DEBUG = logs
  // pseudo-log-level that has no logger.
  ao.logLevel = 'none'
}

let udpPort = 7832

if (process.env.APPOPTICS_REPORTER_UDP) {
  const parts = process.env.APPOPTICS_REPORTER_UDP.split(':')
  if (parts.length == 2) udpPort = parts[1]
}

log.test.info('helper found real port = ' + realPort)

function udpSend (msg, port, host) {
  const client = dgram.createSocket('udp4')
  client.send(msg, 0, msg.length, Number(port), host, function () {
    client.close()
  })
}

exports.appoptics = function (done) {
  // Create UDP server to mock appoptics
  const server = dgram.createSocket('udp4')

  // Create emitter to forward messages
  const emitter = new Emitter()

  // note emitter is being handled by appoptics. some tests don't invoke
  // appoptics, only doChecks() which will need to log messages if this is
  // not active.
  emitter.__aoActive = true

  // Forward events
  server.on('error', emitter.emit.bind(emitter, 'error'))
  server.on('message', function (msg) {
    const port = server.address().port
    const parsed = BSON.deserialize(msg, {promoteBuffers: true});
    for (const key in parsed) {
      if (parsed[key] instanceof Buffer) {
        parsed[key] = parsed[key].toString('utf8');
      }
    }
    log.test.messages('mock appoptics (port ' + port + ') received', parsed)
    if (emitter.log) {
      console.log(parsed)     // eslint-disable-line no-console
    }
    emitter.emit('message', parsed)

    if (emitter.forward) {
      udpSend(msg, realPort, '127.0.0.1')
    }
  })

  // Wait for the server to become available
  server.on('listening', function () {
    const port = server.address().port
    ao.port = port.toString()
    emitter.port = port
    log.test.info('mock appoptics (port ' + port + ') listening')
    process.nextTick(done)
  })

  // Start mock tracelyzer
  server.bind(udpPort, 'localhost')

  // Expose some things through the emitter
  emitter.server = server

  // Attach close function to use in after()
  emitter.close = function (done) {
    const port = server.address().port
    server.on('close', function () {
      log.test.info('mock appoptics (port ' + port + ') closed')
      process.nextTick(done)
    })
    server.close()
  }

  return emitter
}

exports.doChecks = function (emitter, checks, done) {
  const addr = emitter.server.address()
  emitter.removeAllListeners('message')

  log.test.info(`doChecks(${checks.length}) server address ${addr.address}:${addr.port}`)

  function onMessage (msg) {
    if (!emitter.__aoActive) {
      log.test.messages('mock (' + addr.port + ') received message', msg)
    }
    const check = checks.shift()
    if (check) {
      if (emitter.skipOnMatchFail) {
        try {
          check(msg)
        }
        catch (e) {
          checks.unshift(check)
        }
      } else {
        check(msg)
      }
    }

    // Always verify that X-Trace and Edge values are valid
    msg.should.have.property('X-Trace').and.match(/^2B[0-9A-F]{58}$/)
    if (msg.Edge) msg.Edge.should.match(/^[0-9A-F]{16}$/)

    log.test.info(checks.length + ' checks left')
    if (!checks.length) {
      // NOTE: This is only needed because some
      // tests have fewer checks than messages
      emitter.removeListener('message', onMessage)
      done()
    }
  }

  emitter.on('message', onMessage)
}

const check = {
  'http-entry': function (msg) {
    msg.should.have.property('Layer', 'nodejs')
    msg.should.have.property('Label', 'entry')
    log.test.info('entry is valid')
  },
  'http-exit': function (msg) {
    msg.should.have.property('Layer', 'nodejs')
    msg.should.have.property('Label', 'exit')
    log.test.info('exit is valid')
  }
}

const aoAggregate = Symbol('ao.test.aggregate')

exports.setAggregate = function (emitter, agConfig) {
  // set the property on the emitter. add messages and opIdMap if not
  // present.
  emitter[aoAggregate] = Object.assign({messages: [], opIdMap: {}}, agConfig)
  return emitter
}

exports.clearAggregate = function (emitter) {
  delete emitter[aoAggregate]
  return emitter
}

//
// the config object has the following properties
// n - the number of non-ignored messages to expect
// ignore - function that returns true if message should be ignored
// messages - array in which the non-ignored messages are stored
// opIdMap - object in which opId => message pairs are stored for non-ignored messages
//
exports.aggregate = function (emitter, config, done) {
  const addr = emitter.server.address()
  emitter.removeAllListeners('message')

  log.test.info(`helper.aggregate() invoked - server address ${addr.address}:${addr.port}`)

  let i = 0
  let ignoreCount = 0
  function onMessage (msg) {
    // call ignore with config as this.
    if (!config.ignore(msg)) {
      config.messages.push(msg)
      const [, oid] = ids(msg['X-Trace'])
      config.opIdMap[oid] = msg
      ao.loggers.test.debug(`=========> count ${i + 1}`)
      // expected messages (+ 2 for the outer span)
      if (++i >= config.n + 2) {
        done(null, config)
      }
    } else {
      ignoreCount += 1
      ao.loggers.test.debug(`=========>${ignoreCount} ignoring ${util.inspect(msg)}`)
    }
  }

  emitter.on('message', onMessage)
}


exports.test = function (emitter, test, validations, done) {
  function noop () {}
  // noops skip testing the 'outer' span.
  /*
  function outerEntry (msg) {
    msg.should.have.property('Layer', 'outer')
    msg.should.have.property('Label', 'entry')
  }
  function outerExit (msg) {
    msg.should.have.property('Layer', 'outer')
    msg.should.have.property('Label', 'exit')
  }
  // */
  // copy the caller's array so we can modify it without surprising
  // the caller.
  validations = validations.map(e => e)
  validations.unshift(noop)
  validations.push(noop)

  if (emitter[aoAggregate]) {
    // if an aggregate object has been set the aggregate messages using
    // the aggregate configuration in emitter[aoAggregate]. this is only
    // partially implemented but is intended to enable checking all responses
    // once they have completed. that will make checking edges much more
    // straightforward and will also eliminate timeout errors when.
    exports.aggregate(emitter, emitter[aoAggregate], done)
    delete emitter[aoAggregate]
  } else {
    // check messages as the occur using the validations array.
    exports.doChecks(emitter, validations, done)
  }

  ao.tContext.run(function () {
    const template = {
      doSample: ao.traceMode === 'enabled',
      doMetrics: ao.traceMode === 'enabled',
      metadata: ao.MB.makeRandom(ao.traceMode === 'enabled'),
    };
    const span = ao.Span.makeEntrySpan('outer', exports.makeSettings(template))
    // span.async = true
    log.test.span('helper.test outer: %l', span)
    log.test.info('test starting')

    span.enter()
    test(function (err, data) {
      log.test.info('test ended: ' + (err ? 'failed' : 'passed'))
      if (err) {
        return done(err)
      }
      span.exit()
      //done
    })
  })
}

exports.httpTest = function (emitter, test, validations, done) {
  const server = http.createServer(function (req, res) {
    log.test.info('test started')
    test(function (err, data) {
      log.test.info('test ended')
      if (err) return done(err)
      res.end(data)
    })
  })

  validations.unshift(check['http-entry'])
  validations.push(check['http-exit'])
  exports.doChecks(emitter, validations, function () {
    server.close(done)
  })

  server.listen(function () {
    const port = server.address().port
    log.test.info('test server listening on port ' + port)
    http.get('http://localhost:' + port, function (res) {
      res.resume()
    }).on('error', done)
  })
}

exports.httpsTest = function (emitter, options, test, validations, done) {
  const server = https.createServer(options, function (req, res) {
    log.test.info('test started')
    test(function (err, data) {
      log.test.info('test ended')
      if (err) return done(err)
      res.end(data)
    })
  })

  validations.unshift(check['http-entry'])
  validations.push(check['http-exit'])
  exports.doChecks(emitter, validations, function () {
    server.close(done)
  })

  server.listen(function () {
    const port = server.address().port
    log.test.info('test server listening on port ' + port)
    https.get('https://localhost:' + port, function (res) {
      res.resume()
    }).on('error', done)
  })
}

exports.run = function (context, path) {
  context.data = context.data || {}
  const previous = ao.probes.fs.enabled
  ao.probes.fs.enabled = false
  const mod = require('./probes/' + path)
  ao.probes.fs.enabled = previous

  if (mod.data) {
    let data = mod.data
    if (typeof data === 'function') {
      data = data(context)
    }
    extend(context.data, data)
  }

  context.ao = ao

  return function (done) {
    return mod.run(context, done)
  }
}

exports.after = function (n, done) {
  return function () {
    --n || done()
  }
}

function Address (host, port) {
  this.host = host
  this.port = port
}
exports.Address = Address
Address.prototype.toString = function () {
  return this.host + ':' + this.port
}

Address.from = function (input) {
  return input.split(',').map(function (name) {
    const parts = name.split(':')
    const host = parts.shift()
    const port = parts.shift() || ''
    return new Address(host, port)
  })
}

exports.setUntil = function (obj, prop, value, done) {
  const old = obj[prop]
  obj[prop] = value
  return function () {
    obj[prop] = old
    done.apply(this, arguments)
  }
}

exports.linksTo = linksTo
function linksTo (a, b) {
  a.Edge.should.eql(b['X-Trace'].substr(42, 16))
}

exports.edgeTracker = edgeTracker
function edgeTracker (parent, fn) {
  let started = false
  function tracker (msg) {
    // Verify link to last message in parent
    if (!started) {
      if (parent) {
        linksTo(msg, parent.last)
      }
      started = true
    }

    // Verify link to last message in this branch
    if (tracker.last) {
      linksTo(msg, tracker.last)
    }

    tracker.last = msg
    if (fn) fn(msg)
  }

  return tracker
}

exports.checkEntry = checkEntry
function checkEntry (name, fn) {
  return function (msg) {
    msg.should.have.property('X-Trace')
    msg.should.have.property('Label', 'entry')
    msg.should.have.property('Layer', name)
    if (fn) fn(msg)
  }
}

exports.checkExit = checkExit
function checkExit (name, fn) {
  return function (msg) {
    msg.should.have.property('X-Trace')
    msg.should.have.property('Label', 'exit')
    msg.should.have.property('Layer', name)
    if (fn) fn(msg)
  }
}

exports.checkInfo = checkInfo
function checkInfo (data, fn) {
  const withData = checkData(data)
  return function (msg) {
    msg.should.not.have.property('Layer')
    msg.should.have.property('Label', 'info')
    withData(msg)
    if (fn) fn(msg)
  }
}

exports.checkError = checkError
function checkError (error, fn) {
  return function (msg) {
    msg.should.not.have.property('Layer')
    msg.should.have.property('Label', 'error')
    msg.should.have.property('ErrorClass', 'Error')
    msg.should.have.property('ErrorMsg', error.message)
    msg.should.have.property('Backtrace', error.stack)
    if (fn) fn(msg)
  }
}

exports.checkData = checkData
function checkData (data, fn) {
  return function (msg) {
    Object.keys(data).forEach(function (key) {
      msg.should.have.property(key, data[key])
    })
    if (fn) fn(msg)
  }
}

exports.checkLogMessages = checkLogMessages
function checkLogMessages (checks) {
  const defaultLogger = debug.log
  let counter = 0

  // if the level is not one of these ignore it.
  const levelsToCheck = {
    'appoptics:error': true,
    'appoptics:warn': true,
    'appoptics:patching': true
  }

  // log is called before substitutions are done, so don't check for the final
  // message as output.
  debug.log = function (output) {
    const [level, text] = getLevelAndText(output)
    if (!(level in levelsToCheck && counter < checks.length)) {
      return
    }
    const check = checks[counter++]
    // catch errors so this logger isn't left in place after an error is found
    try {
      expect(level).equal(`appoptics:${check.level}`, `level is wrong for message "${text}"`)
      expect(text.indexOf(check.message) === 0).equal(
        true, `found: "${text}" expected "${check.message}"`
      )
      if (check.values) {
        for (let i = 0; i < check.values.length; i++) {
          if (Number.isNaN(check.values[i])) {
            assert(Number.isNaN(arguments[i + 1]), 'argument ' + i + ' should be NaN')
          } else {
            assert(check.values[i] === arguments[i + 1], 'argument ' + i + ' should be ', check.values[i])
          }
        }
      }
    } catch (e) {
      debug.log = defaultLogger
      throw e
    }
    // restore the default logger when out of messages to check too.
    if (counter >= checks.length) {
      debug.log = defaultLogger
    }
  }
  function clearLogMessageChecks () {
    debug.log = defaultLogger
    counter = 0
  }
  function getLogMessagesChecked () {
    return counter
  }
  return [getLogMessagesChecked, clearLogMessageChecks]
}

exports.getLevelAndText = getLevelAndText
function getLevelAndText (text) {
  // if output is not a tty then 1) there is a timestamp and 2) colors aren't used.
  // 2018-10-06T13:58:59.989Z
  // eslint-disable-next-line max-len
  let match = text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z ([^ ]+) (.+)/)
  if (match) {
    return [match[1], match[2]]
  }
  // eslint-disable-next-line no-control-regex
  match = text.match(/\s*\u001b\[[0-9;]+m(.+) \u001b\[0m(.+)/)
  if (match) {
    return [match[1], match[2]]
  }
  return ['', '']
}

exports.makeSettings = function (settings) {
  const s = {
    doSample: true,
    doMetrics: true,
    source: 1,              // local agent config
    rate: ao.sampleRate,
  }
  return Object.assign(s, settings)
}
