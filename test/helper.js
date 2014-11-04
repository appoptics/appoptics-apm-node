var debug = require('debug')('traceview:test:helper')
var log = require('debug')('traceview:test:helper:tracelyzer-message')
var Emitter = require('events').EventEmitter
var BSON = require('bson').BSONPure.BSON
var extend = require('util')._extend
var request = require('request')
var dgram = require('dgram')
var https = require('https')
var http = require('http')
var tv = require('..')
var addon = tv.addon

var lastPort = 10000

exports.tracelyzer = function (done) {
  var port = lastPort++

  // Create UDP server to mock tracelyzer
  var server = dgram.createSocket('udp4')

  // Create emitter to forward messages
  var emitter = new Emitter

  // Forward events
  server.on('error', emitter.emit.bind(emitter, 'error'))
  server.on('message', function (msg) {
    var parsed = BSON.deserialize(msg)
    log('mock tracelyzer (port ' + port + ') received', parsed)
    emitter.emit('message', parsed)
  })

  // Wait for the server to become available
  server.on('listening', function () {
    debug('mock tracelyzer (port ' + port + ') listening')
    process.nextTick(done)
  })

  // Start mock tracelyzer
  server.bind(port)

  // Create and use reporter pointing to mock tracelyzer
  tv.reporter = new addon.UdpReporter('127.0.0.1', port)

  // Expose some things through the emitter
  emitter.reporter = tv.reporter
  emitter.server = server
  emitter.port = port

  // Attach close function to use in after()
  emitter.close = function (done) {
    server.on('close', function () {
      debug('mock tracelyzer (port ' + port + ') closed')
      process.nextTick(done)
    })
    server.close()
  }

  return emitter
}

exports.doChecks = function (emitter, checks, done) {
  var first = true
  var edge

  var add = emitter.server.address()

  emitter.removeAllListeners('message')

  function onMessage (msg) {
    debug('mock tracelyzer (port ' + add.port + ') received message', msg)
    var check = checks.shift()
    if (check) {
      check(msg)
    }

    // Always verify that a valid X-Trace ID is present
    msg.should.have.property('X-Trace').and.match(/^1B[0-9A-F]{56}$/)

    // After the first event, verify valid edges are present
    if (first) {
      first = false
    } else {
      msg.should.have.property('Edge').and.match(/^[0-9A-F]{16}$/)
    }

    debug(checks.length + ' checks left')
    if ( ! checks.length) {
      // NOTE: This is only needed because some
      // tests have less checks than messages
      // emitter.removeListener('message', onMessage)
      done()
    }
  }

  emitter.on('message', onMessage)
}

var check = {
  'http-entry': function (msg) {
    msg.should.have.property('Layer', 'nodejs')
    msg.should.have.property('Label', 'entry')
    debug('entry is valid')
  },
  'http-exit': function (msg) {
    msg.should.have.property('Layer', 'nodejs')
    msg.should.have.property('Label', 'exit')
    debug('exit is valid')
  }
}

exports.httpTest = function (emitter, test, validations, done) {
  var server = http.createServer(function (req, res) {
    debug('request started')
    test(function (err, data) {
      if (err) return done(err)
      res.end('done')
    })
  })

  validations.unshift(check['http-entry'])
  validations.push(check['http-exit'])
  exports.doChecks(emitter, validations, function () {
    server.close(done)
  })

  server.listen(function () {
    var port = server.address().port
    debug('test server listening on port ' + port)
    http.get('http://localhost:' + port)
  })
}

exports.httpsTest = function (emitter, options, test, validations, done) {
  var server = https.createServer(options, function (req, res) {
    debug('request started')
    test(function (err, data) {
      if (err) return done(err)
      res.end('done')
    })
  })

  validations.unshift(check['http-entry'])
  validations.push(check['http-exit'])
  exports.doChecks(emitter, validations, function () {
    server.close(done)
  })

  server.listen(function () {
    var port = server.address().port
    debug('test server listening on port ' + port)
    https.get('https://localhost:' + port)
  })
}

exports.run = function (context, path) {
  context.data = context.data || {}
  var mod = require('./' + path)

  if (mod.data) {
    var data = mod.data
    if (typeof data === 'function') {
      data = data(context)
    }
    extend(context.data, data)
  }

  context.tv = tv

  return function (done) {
    return mod.run(context, done)
  }
}
