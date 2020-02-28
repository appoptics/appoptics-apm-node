'use strict';

const helper = require('../helper')
const ao = helper.ao

const amqp = require('amqp')
const pkg = require('amqp/package')
const db_host = process.env.AO_TEST_RABBITMQ_3_5 || 'rabbitmq:5672'


if (helper.skipTest(module.filename)) {
  return
}

describe('probes.amqp ' + pkg.version, function () {
  let emitter
  let client

  // increase timeout for travis-ci.
  this.timeout(10000)

  //
  // Define some general message checks
  //
  const checks = {
    entry: function (msg) {
      msg.should.have.property('Layer', 'amqp')
      msg.should.have.property('Label', 'entry')
      msg.should.have.property('Flavor', 'amqp')
      msg.should.have.property('RemoteHost', db_host)
    },
    exit: function (msg) {
      msg.should.have.property('Layer', 'amqp')
      msg.should.have.property('Label', 'exit')
    },
    pushq: function (msg) {
      msg.should.have.property('Spec', 'pushq')
      msg.should.have.property('ExchangeAction', 'publish')
      msg.should.have.property('ExchangeType').and.be.an.instanceOf(String)
    },
    job: function (msg) {
      msg.should.have.property('Spec', 'job')
      msg.should.have.property('Flavor', 'amqp')
      msg.should.have.property('MsgID').and.be.an.instanceOf(String)
      msg.should.have.property('Controller').and.be.an.instanceOf(String)
      msg.should.have.property('Action').and.be.an.instanceOf(String)
      msg.should.have.property('URL').and.be.an.instanceOf(String)
    }
  }

  //
  // Intercept appoptics messages for analysis
  //
  before(function (done) {
    emitter = helper.appoptics(done)
    ao.sampleRate = ao.addon.MAX_SAMPLE_RATE
    ao.traceMode = 'always'
  })
  after(function (done) {
    emitter.close(done)
  })

  //
  // Create a connection for the tests to use
  //
  beforeEach(function (done) {
    const parts = db_host.split(':')
    const host = parts.shift()
    const port = parts.shift()

    client = amqp.createConnection({
      host: host,
      port: port
    }, {
      reconnect: false
    })
    client.on('ready', done)
  })
  afterEach(function (done) {
    // NOTE: 1.x has no disconnect() and socket.end() is not safe.
    if (client.disconnect) {
      client.on('close', function () {
        done()
      })
      client.disconnect()
    } else {
      done()
    }
  })

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

  //
  // Define tests
  //
  it('should support confirm exchanges', function (done) {
    helper.test(emitter, function (done) {
      const ex = client.exchange('test', {
        confirm: true
      }, function () {
        ex.publish('message', {
          foo: 'bar'
        }, {
          mandatory: true
        }, function () {
          done()
        })
      })
    }, [
      function (msg) {
        checks.entry(msg)
        checks.pushq(msg)
        msg.should.have.property('ExchangeName', 'test')
        msg.should.have.property('RoutingKey', 'message')
      },
      function (msg) {
        checks.exit(msg)
      }
    ], done)
  })

  it('should support no-confirm exchanges', function (done) {
    helper.test(emitter, function (done) {
      const ex = client.exchange('test', {}, function () {
        // eslint-disable-next-line no-unused-vars
        const task = ex.publish('message', {
          foo: 'bar'
        })
        done()
      })
    }, [
      function (msg) {
        checks.entry(msg)
        checks.pushq(msg)
        msg.should.have.property('ExchangeName', 'test')
        msg.should.have.property('RoutingKey', 'message')
      },
      function (msg) {
        checks.exit(msg)
      }
    ], done)
  })

  it('should bind event listeners', function (done) {
    helper.test(emitter, function (done) {
      const q = client.queue('node-default-exchange', function () {
        q.bind('#')

        q.on('queueBindOk', function () {
          q.on('basicConsumeOk', function () {
            const ex = client.exchange('test', {}, function () {
              // eslint-disable-next-line no-unused-vars
              const task = ex.publish('message', {
                foo: 'bar'
              })
              done()
            })
          })

          q.subscribe({
            routingKeyInPayload: true
          }, function () {

          })
        })
      })
    }, [
      function (msg) {
        checks.entry(msg)
        checks.pushq(msg)
        msg.should.have.property('ExchangeName', 'test')
        msg.should.have.property('RoutingKey', 'message')
      },
      function (msg) {
        checks.exit(msg)
      }
    ], done)
  })

  it('should report jobs', function (done) {
    let id;
    helper.test(emitter, function (done) {
      const ex = client.exchange('exchange', {type: 'fanout'});
      client.queue('queue', function (q) {
        q.bind(ex, '*')

        q.subscribe({ack: true}, function myJob (a, b, c, msg) {
          setImmediate(function () {
            msg.acknowledge()
            done()
          })
        })

        ex.publish('message', {
          foo: 'bar'
        })
      })
    }, [
      function (msg) {
        checks.entry(msg)
        checks.pushq(msg)
        msg.should.have.property('ExchangeName', 'exchange')
        msg.should.have.property('RoutingKey', 'message')
        id = msg['X-Trace']
      },
      function (msg) {
        checks.exit(msg)
      },
      function (msg) {
        checks.entry(msg)
        checks.job(msg)
        msg.should.have.property('Queue', 'queue')
        msg.should.have.property('JobName', 'myJob')
        msg.should.have.property('RoutingKey', 'message')
        msg.should.have.property('SourceTrace', id)
        msg.should.have.property('Controller', 'amqp')
        msg.should.have.property('Action', 'myJob')
        msg.should.have.property('URL', '/amqp/queue')
      },
      function (msg) {
        checks.exit(msg)
      }
    ], done)
  })

  it('should properly report auto-acked jobs', function (done) {
    let id;
    helper.test(emitter, function (done) {
      const ex = client.exchange('exchange', {type: 'fanout'});
      client.queue('queue', function (q) {
        q.bind(ex, '')

        q.subscribe({ack: false}, function myJob () {
          done()
        })

        ex.publish('message', {
          foo: 'bar'
        })
      })
    }, [
      function (msg) {
        checks.entry(msg)
        checks.pushq(msg)
        msg.should.have.property('ExchangeName', 'exchange')
        msg.should.have.property('RoutingKey', 'message')
        id = msg['X-Trace']
      },
      function (msg) {
        checks.exit(msg)
      },
      function (msg) {
        checks.entry(msg)
        checks.job(msg)
        msg.should.have.property('Queue', 'queue')
        msg.should.have.property('JobName', 'myJob')
        msg.should.have.property('RoutingKey', 'message')
        msg.should.have.property('SourceTrace', id)
        msg.should.have.property('Controller', 'amqp')
        msg.should.have.property('Action', 'myJob')
        msg.should.have.property('URL', '/amqp/queue')
      },
      function (msg) {
        checks.exit(msg)
      }
    ], done)
  })

  it('should create entry spans for jobs', function (done) {
    const ex = client.exchange('exchange', {type: 'fanout'});
    client.queue('queue', function (q) {
      q.bind(ex, '')

      q.subscribe({ack: false}, function myJob () {});

      ex.publish('message', {
        foo: 'bar'
      })
    })

    helper.doChecks(emitter, [
      function (msg) {
        checks.entry(msg)
        checks.job(msg)
        msg.should.have.property('Queue', 'queue')
        msg.should.have.property('JobName', 'myJob')
        msg.should.have.property('RoutingKey', 'message')
        msg.should.have.property('SampleRate')
        msg.should.have.property('SampleSource')
      },
      function (msg) {
        checks.exit(msg)
      }
    ], done)
  })

  it('should include SourceTrace in externally created jobs', function (done) {
    let innerDone;
    let id;

    const ex = client.exchange('exchange', {type: 'fanout'});
    client.queue('queue', function (q) {
      q.bind(ex, '*')

      q.subscribe({ack: true}, function myJob (a, b, c, msg) {
        setImmediate(function () {
          msg.acknowledge()
          innerDone()
        })
      })

      helper.test(emitter, function (done) {
        innerDone = done
        ex.publish('message', {
          foo: 'bar'
        })
      }, [
        function (msg) {
          checks.entry(msg)
          checks.pushq(msg)
          msg.should.have.property('ExchangeName', 'exchange')
          msg.should.have.property('RoutingKey', 'message')
          msg.should.have.property('X-Trace')
          id = msg['X-Trace']
        },
        function (msg) {
          checks.exit(msg)
        },
        function (msg) {
          checks.entry(msg)
          checks.job(msg)
          msg.should.have.property('Queue', 'queue')
          msg.should.have.property('JobName', 'myJob')
          msg.should.have.property('RoutingKey', 'message')
          msg.should.have.property('SourceTrace', id)
          msg.should.have.property('Controller', 'amqp')
          msg.should.have.property('Action', 'myJob')
          msg.should.have.property('URL', '/amqp/queue')
        },
        function (msg) {
          checks.exit(msg)
        }
      ], done)
    })
  })

  it('should bind event listeners even for instances constructed outside the request', function (done) {
    const next = helper.after(2, function () {
      helper.test(emitter, function (done) {
        q.on('basicConsumeOk', function () {
          // eslint-disable-next-line no-unused-vars
          const task = ex.publish('message', {
            foo: 'bar'
          })
          done()
        })

        q.subscribe({
          routingKeyInPayload: true
        }, function () {})
      }, [
        function (msg) {
          checks.entry(msg)
          checks.pushq(msg)
          msg.should.have.property('ExchangeName', 'test')
          msg.should.have.property('RoutingKey', 'message')
        },
        function (msg) {
          checks.exit(msg)
        }
      ], done)
    })

    const ex = client.exchange('test', {}, next);
    const q = client.queue('node-default-exchange', function () {
      q.bind('#');

      q.on('queueBindOk', next)
    })
  })

  it('should not fail to patch wrong structures', function () {
    const patch = require('../../dist/probes/amqp');

    // Create blank constructor
    function Connection () {}
    function Exchange () {}
    function Queue () {}

    // Create detached prototype
    const connProto = {
      connect: function () {},
      exchange: function () {return new Exchange()},
      queue: function () {return new Queue()}
    };
    const exProto = {
      publish: function () {}
    }
    const emProto = {
      addListener: function () {},
      on: function () {}
    }

    // Create empty module
    const mod = {}

    // Validate it doesn't crash on empty objects
    patch(mod)

    // Add Connection constructor to module
    mod.Connection = Connection

    // Apply patch again
    let patched = patch(mod);

    // Should still have the Connection constructor
    patched.Connection.should.equal(Connection)

    // Should not have added functions to a constructor with blank prototype
    const after = patched.Connection.prototype;
    Object.keys(connProto).forEach(function (key) {
      after.should.not.have.property(key)
    })

    function addProto (cons, proto) {
      Object.keys(proto).forEach(function (key) {
        cons.prototype[key] = proto[key]
      })
    }

    // Now copy the proto onto the constructor
    addProto(Connection, connProto)
    addProto(Exchange, exProto)
    addProto(Exchange, emProto)
    addProto(Queue, emProto)

    function validateProto (cons, proto) {
      const after = cons.prototype;
      Object.keys(proto).forEach(function (key) {
        after.should.have.property(key)
        after[key].should.not.equal(proto[key])
      })
    }

    // Patch full structure
    patched = patch(mod)

    // Use the structure to ensure delayed patches are triggered
    const con = new Connection();
    const ex = con.exchange();
    const q = con.queue();

    // Validate full structure has had functions replaced
    validateProto(Connection, connProto)
    validateProto(ex.constructor, exProto)
    validateProto(ex.constructor, emProto)
    validateProto(q.constructor, emProto)
  })
})
