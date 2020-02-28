'use strict'

const helper = require('../helper')
const Address = helper.Address
const {ao} = require('../1.test-common')

const noop = helper.noop
const addon = ao.addon

const redis = require('redis')
const pkg = require('redis/package')

const parts = (process.env.AO_TEST_REDIS_3_0 || 'redis:6379').split(':')
const host = parts.shift()
const port = parts.shift()
const addr = new Address(host, port)
const client = redis.createClient(addr.port, addr.host, {})

describe('probes.redis ' + pkg.version, function () {
  const ctx = {redis: client}
  let emitter

  //
  // Intercept appoptics messages for analysis
  //
  before(function (done) {
    emitter = helper.appoptics(done)
    ao.sampleRate = addon.MAX_SAMPLE_RATE
    ao.traceMode = 'always'
    ao.g.testing(__filename)
  })
  after(function (done) {
    emitter.close(done)
  })

  const check = {
    'redis-entry': function (msg) {
      msg.should.have.property('Layer', 'redis')
      msg.should.have.property('Label', 'entry')
      msg.should.have.property('RemoteHost', addr.toString())
    },
    'redis-exit': function (msg) {
      msg.should.have.property('Layer', 'redis')
      msg.should.have.property('Label', 'exit')
    }
  }

  it('UDP might lose a message', function (done) {
    helper.test(emitter, function (done) {
      ao.instrument('fake', noop)
      done()
    }, [
      function (msg) {
        msg.should.have.property('Label').oneOf('entry', 'exit'),
        msg.should.have.property('Layer', 'fake')
      }
    ], done)
  })

  //
  // Test a simple res.end() call in an http server
  //
  it('should support single commands', function (done) {
    helper.test(emitter, helper.run(ctx, 'redis/set'), [
      function (msg) {
        check['redis-entry'](msg)
        msg.should.have.property('KVOp', 'set')
        msg.should.have.property('KVKey', 'foo')
      },
      function (msg) {
        msg.should.have.property('KVHit')
        check['redis-exit'](msg)
      }
    ], done)
  })

  //
  // Test a simple res.end() call in an http server
  //
  it('should support multi', function (done) {
    const steps = [
      function (msg) {
        check['redis-entry'](msg)
        msg.should.have.property('KVOp', 'multi')
      },
      function (msg) {
        check['redis-entry'](msg)
        msg.should.have.property('KVOp', 'set')
        msg.should.have.property('KVKey', 'foo')
      },
      function (msg) {
        check['redis-entry'](msg)
        msg.should.have.property('KVOp', 'get')
        msg.should.have.property('KVKey', 'foo')
      },
      function (msg) {
        check['redis-entry'](msg)
        msg.should.have.property('KVOp', 'exec')
      },
      function (msg) {
        check['redis-exit'](msg)
      },
      function (msg) {
        check['redis-exit'](msg)
      },
      function (msg) {
        check['redis-exit'](msg)
      },
      function (msg) {
        check['redis-exit'](msg)
      }
    ]

    helper.test(emitter, helper.run(ctx, 'redis/multi'), steps, done)
  })

  //
  // Test a simple res.end() call in an http server
  //
  it('should not interfere with pub/sub', function (done) {
    helper.test(emitter, helper.run(ctx, 'redis/pubsub'), [], done)
  })

})
