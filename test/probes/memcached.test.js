'use strict'

const helper = require('../helper')
const {ao} = require('../1.test-common')

const semver = require('semver')

const Memcached = require('memcached')
const pkg = require('memcached/package.json')
const db_host = process.env.AO_TEST_MEMCACHED_1_4 || 'memcached:11211'

describe('probes.memcached ' + pkg.version, function () {
  this.timeout(10000)
  let emitter
  let mem

  //
  // Intercept appoptics messages for analysis
  //
  before(function (done) {
    emitter = helper.appoptics(done)
    ao.sampleRate = ao.addon.MAX_SAMPLE_RATE
    ao.traceMode = 'always'
    ao.g.testing(__filename)
  })
  after(function (done) {
    emitter.close(done)
  })

  //
  // Create client instance
  //
  before(function () {
    mem = new Memcached(db_host)
  })

  //
  // Define generic checks
  //
  const checks = {
    entry: function (msg) {
      msg.should.have.property('Layer', 'memcached')
      msg.should.have.property('Label', 'entry')
      msg.should.have.property('RemoteHost', db_host)
    },
    exit: function (msg) {
      msg.should.have.property('Layer', 'memcached')
      msg.should.have.property('Label', 'exit')
    }
  }

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

  //
  // Define tests
  //
  it('should add', function (done) {
    helper.test(emitter, function (done) {
      mem.add('foo', 'bar', 10, done)
    }, [
      function (msg) {
        checks.entry(msg)
        msg.should.have.property('KVOp', 'add')
        msg.should.have.property('KVKey', 'foo')
      },
      function (msg) {
        checks.exit(msg)
      }
    ], done)
  })

  function test_touch (done) {
    helper.test(emitter, function (done) {
      mem.touch('foo', 10, done)
    }, [
      function (msg) {
        checks.entry(msg)
        msg.should.have.property('KVOp', 'touch')
        msg.should.have.property('KVKey', 'foo')
      },
      function (msg) {
        checks.exit(msg)
      }
    ], done)
  }

  if (semver.satisfies(pkg.version, '>= 0.2.2')) {
    it('should touch', test_touch)
  } else {
    it.skip('should touch', test_touch)
  }

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

  it('should get', function (done) {
    helper.test(emitter, function (done) {
      mem.get('foo', done)
    }, [
      function (msg) {
        checks.entry(msg)
        msg.should.have.property('KVOp', 'get')
        msg.should.have.property('KVKey', 'foo')
      },
      function (msg) {
        checks.exit(msg)
        msg.should.have.property('KVHit', true)
      }
    ], done)
  })

  it('should getMulti', function (done) {
    helper.test(emitter, function (done) {
      mem.getMulti(['foo', 'bar'], done)
    }, [
      function (msg) {
        checks.entry(msg)
        msg.should.have.property('KVOp', 'get')
        msg.should.have.property('KVKey', '["foo","bar"]')
      },
      function (msg) {
        checks.exit(msg)
        msg.should.have.property('KVKeyCount', 2)
        msg.should.have.property('KVHitCount', 1)
      }
    ], done)
  })

  it('should gets', function (done) {
    helper.test(emitter, function (done) {
      mem.gets('bar', done)
    }, [
      function (msg) {
        checks.entry(msg)
        msg.should.have.property('KVOp', 'gets')
        msg.should.have.property('KVKey', 'bar')
      },
      function (msg) {
        checks.exit(msg)
        msg.should.have.property('KVHit', false)
      }
    ], done)
  })

  it('should append', function (done) {
    helper.test(emitter, function (done) {
      mem.append('foo', 'baz', done)
    }, [
      function (msg) {
        checks.entry(msg)
        msg.should.have.property('KVOp', 'append')
        msg.should.have.property('KVKey', 'foo')
      },
      function (msg) {
        checks.exit(msg)
      }
    ], done)
  })

  it('should prepend', function (done) {
    helper.test(emitter, function (done) {
      mem.append('foo', 'baz', done)
    }, [
      function (msg) {
        checks.entry(msg)
        msg.should.have.property('KVOp', 'append')
        msg.should.have.property('KVKey', 'foo')
      },
      function (msg) {
        checks.exit(msg)
      }
    ], done)
  })

  it('should set', function (done) {
    helper.test(emitter, function (done) {
      mem.set('foo', 'baz', 10, done)
    }, [
      function (msg) {
        checks.entry(msg)
        msg.should.have.property('KVOp', 'set')
        msg.should.have.property('KVKey', 'foo')
      },
      function (msg) {
        checks.exit(msg)
      }
    ], done)
  })

  it('should replace', function (done) {
    helper.test(emitter, function (done) {
      mem.replace('foo', 1, 10, done)
    }, [
      function (msg) {
        checks.entry(msg)
        msg.should.have.property('KVOp', 'replace')
        msg.should.have.property('KVKey', 'foo')
      },
      function (msg) {
        checks.exit(msg)
      }
    ], done)
  })

  it('should incr', function (done) {
    helper.test(emitter, function (done) {
      mem.incr('foo', 1, done)
    }, [
      function (msg) {
        checks.entry(msg)
        msg.should.have.property('KVOp', 'incr')
        msg.should.have.property('KVKey', 'foo')
      },
      function (msg) {
        checks.exit(msg)
      }
    ], done)
  })

  it('should decr', function (done) {
    helper.test(emitter, function (done) {
      mem.decr('foo', 1, done)
    }, [
      function (msg) {
        checks.entry(msg)
        msg.should.have.property('KVOp', 'decr')
        msg.should.have.property('KVKey', 'foo')
      },
      function (msg) {
        checks.exit(msg)
      }
    ], done)
  })

  it('should del', function (done) {
    helper.test(emitter, function (done) {
      mem.del('foo', done)
    }, [
      function (msg) {
        checks.entry(msg)
        msg.should.have.property('KVOp', 'delete')
        msg.should.have.property('KVKey', 'foo')
      },
      function (msg) {
        checks.exit(msg)
      }
    ], done)
  })

  it('should skip when disabled', function (done) {
    ao.probes.memcached.enabled = false
    helper.test(emitter, function (done) {
      mem.get('foo', done)
    }, [], function (err) {
      ao.probes.memcached.enabled = true
      done(err)
    })
  })

  it('should work normally when not tracing', function (done) {
    // execute a code path with no state set up.
    mem.get('foo', done)
  })

  it('should report errors', function (done) {
    helper.test(emitter, function (done) {
      mem.get(new Date(), function () {
        done()
      })
    }, [
      function (msg) {
        checks.entry(msg)
        msg.should.have.property('KVOp', 'get')
        msg.should.have.property('KVKey')
      },
      function (msg) {
        checks.exit(msg)
        msg.should.have.property('ErrorClass')
        msg.should.have.property('ErrorMsg')
      }
    ], function (err) {
      done(err)
    })
  })

})
