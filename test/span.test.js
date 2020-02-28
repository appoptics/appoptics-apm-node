'use strict'

const helper = require('./helper')
const should = require('should')
const ao = require('..')
const addon = ao.addon
const Span = ao.Span
const Event = ao.Event

const makeSettings = helper.makeSettings

describe('span', function () {
  let emitter
  let clear

  //
  // Intercept appoptics messages for analysis
  //
  before(function (done) {
    emitter = helper.appoptics(done)
    ao.sampleRate = addon.MAX_SAMPLE_RATE
    ao.traceMode = 'always'
  })
  after(function (done) {
    emitter.close(done)
  })
  afterEach(function () {
    if (clear) {
      clear()
      clear = undefined
    }
  })
  //
  // this test exists only to fix a problem with oboe not reporting a UDP
  // send failure.
  //
  it('UDP might lose a message', function (done) {
    helper.test(emitter, function (done) {
      ao.instrument('fake', function () {})
      done()
    }, [
      function (msg) {
        msg.should.have.property('Label').oneOf('entry', 'exit'),
        msg.should.have.property('Layer', 'fake')
      }
    ], done)
  })

  //
  // Verify basic structural integrity
  //
  it('should construct valid span', function () {
    const span = Span.makeEntrySpan('test', makeSettings())

    span.should.have.property('events')
    const events = ['entry', 'exit']
    events.forEach(function (event) {
      span.events.should.have.property(event)
      span.events[event].taskId.should.not.match(/^0*$/)
      span.events[event].opId.should.not.match(/^0*$/)
    })
  })

  //
  // Verify base span reporting
  //
  it('should report sync boundaries', function (done) {
    const name = 'test'
    const data = {Foo: 'bar'}
    const span = Span.makeEntrySpan(name, makeSettings(), data)
    delete span.topSpan

    const e = span.events

    const checks = [
      helper.checkEntry(name, helper.checkData(data, function (msg) {
        msg.should.have.property('X-Trace', e.entry.toString())
      })),
      helper.checkExit(name, function (msg) {
        msg.should.have.property('X-Trace', e.exit.toString())
        msg.should.have.property('Edge', e.entry.opId)
      })
    ]

    helper.doChecks(emitter, checks, done)

    span.runSync(function () {
    })
  })

  it('should report async boundaries', function (done) {
    const name = 'test'
    const data = {Foo: 'bar'}
    const span = Span.makeEntrySpan(name, makeSettings(), data)
    delete span.topSpan

    const e = span.events

    const checks = [
      // Verify structure of entry event
      helper.checkEntry(name, helper.checkData(data, function (msg) {
        msg.should.have.property('X-Trace', e.entry.toString())
      })),
      // Verify structure of exit event
      helper.checkExit(name, function (msg) {
        msg.should.have.property('X-Trace', e.exit.toString())
        msg.should.have.property('Edge', e.entry.opId)
      })
    ]

    helper.doChecks(emitter, checks, done)

    span.runAsync(function (wrap) {
      const cb = wrap(function (err, res) {
        should.not.exist(err)
        res.should.equal('foo')
      })

      process.nextTick(function () {
        cb(null, 'foo')
      })
    })
  })

  //
  // Verify behaviour when reporting nested spans
  //
  it('should report nested sync boundaries', function (done) {
    const outerData = {Foo: 'bar'}
    const innerData = {Baz: 'buz'}
    let inner

    const checks = [
      helper.checkEntry('outer', helper.checkData(outerData, function (msg) {
        msg.should.have.property('X-Trace', outer.events.entry.toString())
      })),
      helper.checkEntry('inner', helper.checkData(innerData, function (msg) {
        msg.should.have.property('X-Trace', inner.events.entry.toString())
        msg.should.have.property('Edge', outer.events.entry.opId.toString())
      })),
      helper.checkExit('inner', function (msg) {
        msg.should.have.property('X-Trace', inner.events.exit.toString())
        msg.should.have.property('Edge', inner.events.entry.opId.toString())
      }),
      helper.checkExit('outer', function (msg) {
        msg.should.have.property('X-Trace', outer.events.exit.toString())
        msg.should.have.property('Edge', inner.events.exit.opId.toString())
      })
    ]

    helper.doChecks(emitter, checks, done)

    const outer = Span.makeEntrySpan('outer', makeSettings(), outerData)
    delete outer.topSpan

    outer.run(function () {
      inner = ao.lastSpan.descend('inner', innerData)
      inner.run(function () {})
    })
  })

  it('should report nested boundaries of async event within sync event', function (done) {
    const outerData = {Foo: 'bar'}
    const innerData = {Baz: 'buz'}
    let inner

    const checks = [
      // Outer entry
      helper.checkEntry('outer', helper.checkData(outerData, function (msg) {
        msg.should.have.property('X-Trace', outer.events.entry.toString())
      })),
      // Inner entry (async)
      helper.checkEntry('inner', helper.checkData(innerData, function (msg) {
        msg.should.have.property('X-Trace', inner.events.entry.toString())
        msg.should.have.property('Edge', outer.events.entry.opId)
      })),
      // Outer exit
      helper.checkExit('outer', function (msg) {
        msg.should.have.property('X-Trace', outer.events.exit.toString())
        msg.should.have.property('Edge', outer.events.entry.opId)
      }),
      // Inner exit (async)
      helper.checkExit('inner', function (msg) {
        msg.should.have.property('X-Trace', inner.events.exit.toString())
        msg.should.have.property('Edge', inner.events.entry.opId)
      })
    ]

    helper.doChecks(emitter, checks, done)

    const outer = Span.makeEntrySpan('outer', makeSettings(), outerData)
    delete outer.topSpan

    outer.run(function () {
      inner = ao.lastSpan.descend('inner', innerData);
      inner.run(function (wrap) {
        const delayed = wrap(function (err, res) {
          should.not.exist(err)
          should.exist(res)
          res.should.equal('foo')
        })

        process.nextTick(function () {
          delayed(null, 'foo')
        })
      })
    })
  })

  it('should report nested boundaries of sync event within async event', function (done) {
    const outerData = {Foo: 'bar'}
    const innerData = {Baz: 'buz'}
    let inner
    const outer = Span.makeEntrySpan('outer', makeSettings(), outerData)
    delete outer.topSpan

    const checks = [
      // Outer entry (async)
      helper.checkEntry('outer', helper.checkData(outerData, function (msg) {
        msg.should.have.property('X-Trace', outer.events.entry.toString())
      })),
      // Outer exit (async)
      helper.checkExit('outer', function (msg) {
        msg.should.have.property('X-Trace', outer.events.exit.toString())
        msg.should.have.property('Edge', outer.events.entry.opId)
      }),
      // Inner entry
      helper.checkEntry('inner', helper.checkData(innerData, function (msg) {
        msg.should.have.property('X-Trace', inner.events.entry.toString())
        msg.should.have.property('Edge', outer.events.exit.opId)
      })),
      // Inner exit
      helper.checkExit('inner', function (msg) {
        msg.should.have.property('X-Trace', inner.events.exit.toString())
        msg.should.have.property('Edge', inner.events.entry.opId)
      })
    ]

    helper.doChecks(emitter, checks, done)

    outer.run(function (wrap) {
      const delayed = wrap(function (err, res) {
        should.not.exist(err)
        should.exist(res)
        res.should.equal('foo')

        inner = ao.lastSpan.descend('inner', innerData);
        inner.run(function () {

        })
      })

      process.nextTick(function () {
        delayed(null, 'foo')
      })
    })
  })

  //
  // Special events
  //
  it('should send info events', function (done) {
    const span = Span.makeEntrySpan('test', makeSettings(), {})
    delete span.topSpan
    const data = {
      Foo: 'bar'
    }

    const checks = [
      helper.checkEntry('test'),
      helper.checkInfo(data),
      helper.checkExit('test'),
    ]

    helper.doChecks(emitter, checks, done)

    span.run(function () {
      span.info(data)
    })
  })

  it('should send error events', function (done) {
    const span = Span.makeEntrySpan('test', makeSettings(), {})
    delete span.topSpan
    const err = new Error('nopeconst')

    const checks = [
      helper.checkEntry('test'),
      helper.checkError(err),
      helper.checkExit('test'),
    ]

    helper.doChecks(emitter, checks, done)

    span.run(function () {
      span.error(err)
    })
  })

  it('should support setting an exit error', function () {
    // Proper errors should work
    const a = Span.makeEntrySpan('test', makeSettings(), {})
    const aExit = a.events.exit
    const err = new Error('Exit error message')
    a.setExitError(err)
    aExit.kv.should.have.property('ErrorClass', 'Error')
    aExit.kv.should.have.property('ErrorMsg', err.message)
    aExit.kv.should.have.property('Backtrace', err.stack)

    // As should error strings
    const b = Span.makeEntrySpan('test', makeSettings(), {})
    const bExit = b.events.exit
    b.setExitError('Exit error string')
    bExit.kv.should.have.property('ErrorClass', 'Error')
    bExit.kv.should.have.property('ErrorMsg', 'Exit error string')
  })

  //
  // Safety and correctness
  //
  it('should only send valid properties', function (done) {
    const span = Span.makeEntrySpan('test', makeSettings(), {})
    delete span.topSpan

    const data = {
      Array: [],
      Object: {bar: 'baz'},
      Function: function () {},
      Date: new Date(),
      String: 'bix'
    }

    const expected = {
      String: 'bix'
    }

    const checks = [
      helper.checkEntry('test'),
      helper.checkInfo(expected, function (msg) {
        msg.should.not.have.property('Object')
        msg.should.not.have.property('Array')
        msg.should.not.have.property('Function')
        msg.should.not.have.property('Date')
      }),
      helper.checkExit('test'),
    ]

    helper.doChecks(emitter, checks, done)

    const logChecks = [
      {level: 'error', message: 'Error: Invalid type for KV'},
      {level: 'error', message: 'Error: Invalid type for KV'},
      {level: 'error', message: 'Error: Invalid type for KV'},
      {level: 'error', message: 'Error: Invalid type for KV'},
    ]

    let getCount  // eslint-disable-line
    [getCount, clear] = helper.checkLogMessages(logChecks)

    span.run(function () {
      span.info(data)
    })
  })

  it('should not send info events when not in a span', function () {
    const span = Span.makeEntrySpan('test', makeSettings({doSample: false}), {})
    delete span.topSpan

    const data = {Foo: 'bar'}

    const send = Event.prototype.send
    Event.prototype.send = function () {
      Event.prototype.send = send
      throw new Error('should not send when not in a span')
    }

    const logChecks = [
      {level: 'error', message: 'test span info call could not find last event'}
    ]
    let getCount  // eslint-disable-line
    [getCount, clear] = helper.checkLogMessages(logChecks)

    span.info(data)
    Event.prototype.send = send
  })

  it('should allow sending the same info data multiple times', function (done) {
    const span = Span.makeEntrySpan('test', makeSettings(), {})
    delete span.topSpan

    const data = {
      Foo: 'bar'
    }

    helper.doChecks(emitter, [
      helper.checkEntry('test'),
      helper.checkInfo(data),
      helper.checkInfo(data),
      helper.checkExit('test'),
    ], done)

    span.run(function () {
      span.info(data)
      span.info(data)
    })
  })

  it('should fail silently when sending non-object-literal info', function () {
    const span = Span.makeEntrySpan('test', makeSettings(), {})
    delete span.topSpan

    span._internal = function () {
      throw new Error('should not have triggered an _internal call')
    }
    span.info(undefined)
    span.info(new Date())
    span.info(/foo/)
    span.info('wat')
    span.info(null)
    span.info([])
    span.info(1)
  })

  //
  // Structural integrity
  //
  it('should chain internal event edges', function (done) {
    const n = 10 + Math.floor(Math.random() * 10)
    const span = Span.makeEntrySpan('test', makeSettings(), {})
    delete span.topSpan

    const tracker = helper.edgeTracker()

    const checks = [ tracker, tracker ]
    for (let i = 0; i < n; i++) {
      checks.push(tracker)
    }

    helper.doChecks(emitter, checks, done)

    function sendAThing (i) {
      if (Math.random() > 0.5) {
        span.error(new Error('error ' + i))
      } else {
        span.info({index: i})
      }
    }

    span.run(function () {
      for (let i = 0; i < n; i++) {
        sendAThing(i)
      }
    })
  })

  it('should chain internal events around sync sub span', function (done) {
    const span = Span.makeEntrySpan('outer', makeSettings(), {})
    delete span.topSpan

    const before = {state: 'before'}
    const after = {state: 'after'}

    const track = helper.edgeTracker()

    const checks = [
      helper.checkEntry('outer', track),
      helper.checkInfo(before, track),
      helper.checkEntry('inner', track),
      helper.checkExit('inner', track),
      helper.checkInfo(after, track),
      helper.checkExit('outer', track)
    ]

    helper.doChecks(emitter, checks, done)

    span.run(function () {
      span.info(before)
      span.descend('inner').run(function () {
        // Do nothing
      })
      span.info(after)
    })
  })

  it('should chain internal events around async sub span', function (done) {
    const span = Span.makeEntrySpan('outer', makeSettings(), {})
    delete span.topSpan

    const before = {state: 'before'}
    const after = {state: 'after'}

    const trackOuter = helper.edgeTracker()
    const trackInner = helper.edgeTracker()

    const checks = [
      helper.checkEntry('outer', trackOuter),
      helper.checkInfo(before, trackOuter),

      // Async call
      helper.checkEntry('inner', trackInner),
      helper.checkInfo(before, trackInner),

      helper.checkInfo(after, trackOuter),
      helper.checkExit('outer', trackOuter),

      // Next tick
      helper.checkInfo(after, trackInner),
      helper.checkExit('inner', trackInner)
    ]

    helper.doChecks(emitter, checks, done)

    span.run(function () {
      span.info(before)
      const sub = span.descend('inner')
      sub.run(function (wrap) {
        const cb = wrap(function () {})
        setImmediate(function () {
          ao.reportInfo(after)
          cb()
        })
        ao.reportInfo(before)
      })
      span.info(after)
    })
  })

  it('should properly attribute dangling info/error events', function (done) {
    const span = new Span.makeEntrySpan('outer', makeSettings(), {})

    const before = {state: 'before'}
    const after = {state: 'after'}
    const error = new Error('wat')

    const trackOuter = helper.edgeTracker()
    const trackInner1 = helper.edgeTracker(trackOuter)
    const trackInner2 = helper.edgeTracker(trackInner1)
    const trackInner3 = helper.edgeTracker(trackInner1)
    const trackInner4 = helper.edgeTracker(trackInner3)

    // evaluate brittleness using different timers
    const timeout = callback => setTimeout(callback, 1);

    // The weird indentation is to match depth of trigerring code,
    // it might make it easier to match a span entry to its exit.
    const checks = [
      // Start async outer
      helper.checkEntry('outer', trackOuter),

      // Start sync inner-1
      helper.checkEntry('inner-1', trackInner1),

      // Start async inner-3, surrounded by info events
      helper.checkInfo(before, trackInner1),
      helper.checkEntry('inner-3', trackInner3),
      helper.checkInfo(after, trackInner1),

      // Finish sync inner-1
      helper.checkExit('inner-1', trackInner1),

      // Start async inner-2
      helper.checkEntry('inner-2', trackInner2),

      // Finish async inner-3
      helper.checkExit('inner-3', trackInner3),

      // Start async inner-4
      helper.checkError(error, trackInner3),
      helper.checkEntry('inner-4', trackInner4),

      // Finish async inner-2
      helper.checkExit('inner-2', trackInner2),

      // Finish async outer
      helper.checkExit('outer', trackInner2),

      // Finish async inner-4
      helper.checkExit('inner-4', trackInner4),
    ]

    helper.doChecks(emitter, checks, done)

    ao.tContext.run(function () {
      span.enter()
      const sub1 = span.descend('inner-1');
      sub1.run(function () {                            // inner 1 entry
        ao.reportInfo(before);                          // info

        const sub2 = span.descend('inner-3')
        sub2.run(function (wrap) {                      // inner 3 entry
          timeout(wrap(function () {
            ao.reportError(error);                      // deferred error

            const sub2 = span.descend('inner-4');
            sub2.run(function (wrap) {                  // inner 4 entry
              timeout(wrap(function () {}))
            })
          }))
        })

        ao.reportInfo(after)
      })

      const sub2 = span.descend('inner-2')
      sub2.run(function (wrap) {
        timeout(wrap(function () {
          span.exit()
        }))
      })
    })
  })

})
