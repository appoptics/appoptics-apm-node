'use strict'
const helper = require('./helper')
const ao = require('..')
const Span = ao.Span
const Event = ao.Event
const should = require('should') // eslint-disable-line no-unused-vars

const makeSettings = helper.makeSettings


describe('error', function () {
  const conf = {enabled: true}
  const error = new Error('nope')
  let emitter

  function testSpan (span) {
    return span.descend('test')
  }

  function handleErrorTest (task, done) {
    helper.test(emitter, task, [
      function (msg) {
        msg.should.have.property('Layer', 'test')
        msg.should.have.property('Label', 'entry')
      },
      function (msg) {
        msg.should.have.property('Layer', 'test')
        msg.should.have.property('Label', 'exit')
        msg.should.have.property('ErrorClass', 'Error')
        msg.should.have.property('ErrorMsg', error.message)
        msg.should.have.property('Backtrace', error.stack)
      }
    ], done)
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
  // Prophylactic test exists only to fix a problem with oboe not reporting a UDP
  // send failure.
  //
  it('might lose a message (until the UDP problem is fixed)', function (done) {
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
  // Tests
  //
  it('should add error properties to event', function () {
    const md = ao.MB.makeRandom(1)
    const event = new Event('error-test', 'info', md)
    const err = new Error('test')
    event.error = err

    event.kv.should.have.property('ErrorClass', 'Error')
    event.kv.should.have.property('ErrorMsg', err.message)
    event.kv.should.have.property('Backtrace', err.stack)
  })

  it('should set error multiple times (keeping last)', function () {
    const md = ao.MB.makeRandom(1)
    const event = new Event('error-test', 'info', md)
    const first = new Error('first')
    const second = new Error('second')
    event.error = first
    event.error = second

    event.kv.should.have.property('ErrorClass', 'Error')
    event.kv.should.have.property('ErrorMsg', second.message)
    event.kv.should.have.property('Backtrace', second.stack)
  })

  it('should report errors in sync calls', function (done) {
    handleErrorTest(function (done) {
      try {
        ao.instrument(testSpan, function () {
          throw error
        }, conf)
      } catch (e) {}
      done()
    }, done)
  })

  it('should report errors in async calls', function (complete) {
    handleErrorTest(function (done) {
      try {
        ao.instrument(
          testSpan,
          function (cb) {
            setTimeout(function () {
              cb(error)
            }, 20)
          },
          conf,
          function () {
            done()
          }
        )
      } catch (e) {
        ao.loggers.debug('Got error instrumenting', e)
        complete(e)
      }
    }, complete)
  })

  it('should report custom errors in async calls', function (complete) {
    class CustomError extends Error {}
    const error = new CustomError('test')
    helper.test(emitter, function (done) {
      ao.instrument(
        testSpan,
        function (cb) {
          setTimeout(function () {
            cb(error)
          }, 20)
        },
        conf,
        function () {
          done()
        }
      )
    }, [
      function (msg) {
        msg.should.have.property('Layer', 'test')
        msg.should.have.property('Label', 'entry')
      },
      function (msg) {
        msg.should.have.property('Layer', 'test')
        msg.should.have.property('Label', 'exit')
        msg.should.have.property('ErrorClass', 'CustomError')
        msg.should.have.property('ErrorMsg', error.message)
        msg.should.have.property('Backtrace', error.stack)
      }
    ], complete)
  })

  it('should report errors in error-first callbacks', function (done) {
    handleErrorTest(function (done) {
      ao.instrument(
        testSpan,
        function (callback) {
          callback(error)
        },
        conf,
        function () {
          done()
        }
      )
    }, done)
  })

  it('should report custom errors with the class name', function (done) {
    class CustomError extends Error {}
    const error = new CustomError('test')
    helper.test(emitter, function (done) {
      ao.reportError(error)
      done()
    }, [
      function (msg) {
        msg.should.not.have.property('Layer')
        msg.should.have.property('Label', 'error')
        msg.should.have.property('ErrorClass', 'CustomError')
        msg.should.have.property('ErrorMsg', error.message)
        msg.should.have.property('Backtrace', error.stack)
      }
    ], done)
  })

  it('should report custom errors within a span', function (done) {
    const error = new Error('test')
    let last

    helper.test(emitter, function (done) {
      ao.instrument(testSpan, function (callback) {
        ao.reportError(error)
        callback()
      }, conf, done)
    }, [
      function (msg) {
        msg.should.have.property('Layer', 'test')
        msg.should.have.property('Label', 'entry')
        last = msg['X-Trace'].substr(42, 16)
      },
      function (msg) {
        msg.should.not.have.property('Layer')
        msg.should.have.property('Label', 'error')
        msg.should.have.property('ErrorClass', 'Error')
        msg.should.have.property('ErrorMsg', error.message)
        msg.should.have.property('Backtrace', error.stack)
        msg.Edge.should.equal(last)
        last = msg['X-Trace'].substr(42, 16)
      },
      function (msg) {
        msg.should.have.property('Layer', 'test')
        msg.should.have.property('Label', 'exit')
        msg.Edge.should.equal(last)
      }
    ], done)
  })

  it('should rethrow errors in sync calls', function (done) {
    handleErrorTest(function (done) {
      let rethrow = false
      try {
        ao.instrument(testSpan, function () {
          throw error
        }, conf)
      } catch (e) {
        rethrow = e === error
      }
      if (!rethrow) {
        throw new Error('did not rethrow')
      }
      done()
    }, done)
  })

  it('should support string errors', function (done) {
    const error = 'test'
    helper.httpTest(emitter, function (done) {
      ao.reportError(error)
      done()
    }, [
      function (msg) {
        msg.should.not.have.property('Layer')
        msg.should.have.property('Label', 'error')
        msg.should.have.property('ErrorClass', 'Error')
        msg.should.have.property('ErrorMsg', error)
        msg.should.have.property('Backtrace')
      }
    ], done)
  })

  it('should support empty string errors', function (done) {
    const error = ''
    helper.httpTest(emitter, function (done) {
      ao.reportError(error)
      done()
    }, [
      function (msg) {
        msg.should.not.have.property('Layer')
        msg.should.have.property('Label', 'error')
        msg.should.have.property('ErrorClass', 'Error')
        msg.should.have.property('ErrorMsg', error)
        msg.should.have.property('Backtrace')
      }
    ], done)
  })

  it('should fail silently when given non-error, non-string types', function () {
    const settings = makeSettings()
    const span = Span.makeEntrySpan('test', settings, {})
    span._internal = function () {
      throw new Error('should not have triggered an _internal call')
    }
    span.error({foo: 'bar'})
    span.error(undefined)
    span.error(new Date())
    span.error(/foo/)
    span.error(null)
    span.error([])
    span.error(1)
  })

  it('should allow sending the same error multiple times', function (done) {
    const error = new Error('dupe')

    // TODO: validate edge chaining
    function validate (msg) {
      msg.should.not.have.property('Layer')
      msg.should.have.property('Label', 'error')
      msg.should.have.property('ErrorClass', 'Error')
      msg.should.have.property('ErrorMsg', error.message)
      msg.should.have.property('Backtrace', error.stack)
    }

    helper.httpTest(emitter, function (done) {
      ao.reportError(error)
      ao.reportError(error)
      done()
    }, [ validate, validate ], done)
  })

  it('should not send error events when not in a span', function () {
    const settings = makeSettings()
    const span = Span.makeEntrySpan('test', settings, {})

    const logChecks = [
      {level: 'error', message: 'test span error call could not find last event'},
    ]
    helper.checkLogMessages(logChecks)

    const send = Event.prototype.send
    Event.prototype.send = function () {
      Event.prototype.send = send
      throw new Error('should not send when not in a span')
    }

    span.error(error)
    Event.prototype.send = send
  })

})
