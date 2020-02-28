'use strict'

const helper = require('../helper')
const {ao} = require('../1.test-common.js')

const pkg = require('amqplib/package')

const mq_host = process.env.AO_TEST_RABBITMQ_3_5 || 'rabbitmq:5672'

describe('probes.amqplib ' + pkg.version, function () {
  let emitter

  //
  // Define some general message checks
  //
  const checks = {
    entry: function (msg) {
      msg.should.have.property('Layer', 'amqplib')
      msg.should.have.property('Label', 'entry')
      msg.should.have.property('Flavor', 'amqp')
      msg.should.have.property('RemoteHost', mq_host)
    },
    exit: function (msg) {
      msg.should.have.property('Layer', 'amqplib')
      msg.should.have.property('Label', 'exit')
    },
    pushq: function (msg) {
      msg.should.have.property('Spec', 'pushq')
      msg.should.have.property('ExchangeAction', 'publish')
      msg.should.have.property('RoutingKey').and.be.an.instanceOf(String)
    },
    job: function (msg) {
      msg.should.have.property('Spec', 'job')
      msg.should.have.property('MsgID').and.be.an.instanceOf(String)
      msg.should.have.property('Queue').and.be.an.instanceOf(String)
      msg.should.have.property('JobName').and.be.an.instanceOf(String)
      msg.should.have.property('Controller').and.be.an.instanceOf(String)
      msg.should.have.property('Action').and.be.an.instanceOf(String)
      msg.should.have.property('URL').and.be.an.instanceOf(String)
    }
  }

  const xpat = /2B[A-F0-9]{56}0(0|1)/

  //
  // Intercept appoptics messages for analysis
  //
  before(function (done) {
    ao.sampleRate = ao.addon.MAX_SAMPLE_RATE;
    ao.traceMode = 'always';
    ao.g.testing(__filename);
    emitter = helper.appoptics(done);
  })
  after(function (done) {
    emitter.close(done)
  })

  // this test exists only to fix a problem with oboe not reporting a UDP
  // send failure.
  it('UDP might lose a message', function (done) {
    helper.test(emitter, function (done) {
      ao.instrument('fake', function () { })
      done()
    }, [
      function (msg) {
        msg.should.have.property('Label').oneOf('entry', 'exit'),
        msg.should.have.property('Layer', 'fake')
      }
    ], done)
  })

  function makeTests (context) {
    let queue

    // Ensure queue exists
    beforeEach(function () {
      queue = 'tasks-' + Math.random()
      context.channel.assertQueue(queue)
    })

    it('should report send and consume in existing trace', function (done) {
      helper.test(emitter, function (done) {
        context.channel.sendToQueue(queue, new Buffer('promises'))
        context.channel.consume(queue, function (msg) {
          context.channel.ack(msg)
          setImmediate(done)
        })
      }, [
        function (msg) {
          checks.entry(msg)
          checks.pushq(msg)
          msg.should.have.property('RoutingKey', queue)
        },
        function (msg) {
          checks.exit(msg)
        },
        function (msg) {
          checks.entry(msg)
          checks.job(msg)
          msg.should.have.property('Queue', queue)
          msg.should.have.property('RoutingKey', queue)
          msg.should.have.property('SourceTrace').and.match(xpat)
        },
        function (msg) {
          checks.exit(msg)
        }
      ], done)
    })

    it('should start new trace for consume', function (done) {
      context.channel.sendToQueue(queue, new Buffer('promises'))
      context.channel.consume(queue, function (msg) {
        context.channel.ack(msg)
      })

      helper.doChecks(emitter, [
        function (msg) {
          checks.entry(msg)
          checks.job(msg)
          msg.should.have.property('Queue', queue)
          msg.should.have.property('RoutingKey', queue)
        },
        function (msg) {
          checks.exit(msg)
        }
      ], done)
    })

    it('should include SourceTrace in consume external to traced publish', function (done) {
      let innerDone

      context.channel.consume(queue, function (msg) {
        context.channel.ack(msg)
        setImmediate(innerDone)
      })

      helper.test(emitter, function (done) {
        innerDone = done
        context.channel.sendToQueue(queue, new Buffer('promises'))
      }, [
        function (msg) {
          checks.entry(msg)
          checks.pushq(msg)
          msg.should.have.property('RoutingKey', queue)
        },
        function (msg) {
          checks.exit(msg)
        },
        function (msg) {
          checks.entry(msg)
          checks.job(msg)
          msg.should.have.property('Queue', queue)
          msg.should.have.property('RoutingKey', queue)
          msg.should.have.property('SourceTrace').and.match(xpat)
        },
        function (msg) {
          checks.exit(msg)
        }
      ], done)
    })

  }

  describe('promises', function () {
    const amqp = require('amqplib')
    const context = {}
    let client

    before(function () {
      return amqp.connect('amqp://' + mq_host)
        .then(function (conn) {
          client = conn
          return client.createChannel()
        })
        .then(function (ch) {
          context.channel = ch
        })
    })

    after(function (done) {
      context.channel.close()
      context.channel.on('close', done)
    })

    after(function (done) {
      client.close()
      client.on('close', done)
    })

    makeTests(context)
  })

  describe('callbacks', function () {
    const amqp = require('amqplib/callback_api')
    const context = {}
    let client

    before(function (done) {
      amqp.connect('amqp://' + mq_host, function (err, conn) {
        if (err) return done(err)
        client = conn
        client.createChannel(function (err, ch) {
          if (err) return done(err)
          context.channel = ch
          done()
        })
      })
    })

    after(function (done) {
      context.channel.close()
      context.channel.on('close', done)
    })

    after(function (done) {
      client.close()
      client.on('close', done)
    })

    makeTests(context)
  })

})
