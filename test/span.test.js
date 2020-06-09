'use strict'

const helper = require('./helper')
const should = require('should')
const expect = require('chai').expect;
const util = require('util');

const ao = require('..')
const addon = ao.addon
const Span = ao.Span
const Event = ao.Event

const makeSettings = helper.makeSettings

describe('span', function () {
  let emitter
  let clear
  const logLevel = ao.logLevel;

  //
  // Intercept appoptics messages for analysis
  //
  before(function (done) {
    emitter = helper.appoptics(done)
    ao.sampleRate = addon.MAX_SAMPLE_RATE
    ao.traceMode = 'always';
    // clear these because other tests may have been run
    // before this suite.
    Object.keys(ao._stats.span).forEach(k => {
      ao._stats.span[k] = 0;
    });
  })
  after(function (done) {
    emitter.close(done)
  })
  afterEach(function () {
    if (clear) {
      clear()
      clear = undefined
    }
    ao.logLevel = logLevel;
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

    expect(span.events.entry).property('event');
    const taskId = span.events.entry.taskId;
    expect(taskId).not.equal('0'.repeat(40));
    expect(span.events.entry.opId).not.equal('0'.repeat(16));
    expect(span.events.entry.event.toString()).match(/2B[0-9A-F]{56}01/);

    expect(span.events.exit).property('event');
    expect(span.events.exit.taskId).equal(taskId);
    expect(span.events.exit.opId).not.equal('0'.repeat(16));
    expect(span.events.exit.opId).not.equal(span.events.entry.opId);
  })

  //===========================
  // Verify base span reporting
  //===========================
  it('should report sync boundaries', function (done) {
    const name = 'test'
    const data = {Foo: 'bar'}
    const span = Span.makeEntrySpan(name, makeSettings(), data)

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

    span.runSync(function () {});
  })

  it('should report async boundaries', function (done) {
    const name = 'test'
    const data = {Foo: 'bar'}
    const span = Span.makeEntrySpan(name, makeSettings(), data)

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

  //=============================================
  // Verify behaviour when reporting nested spans
  //=============================================
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

    const outer = Span.makeEntrySpan('outer', makeSettings(), outerData);

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

    const outer = Span.makeEntrySpan('outer', makeSettings(), outerData);

    outer.run(function () {
      inner = ao.lastSpan.descend('inner', innerData);
      inner.run(function (wrap) {
        const delayed = wrap(function (err, res) {
          expect(err).not.exist;
          expect(res).exist;
          expect(res).equal('foo');
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
    const outer = Span.makeEntrySpan('outer', makeSettings(), outerData);

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
        expect(err).not.exist;
        expect(res).exist;
        expect(res).equal('foo');

        inner = ao.lastSpan.descend('inner', innerData)
        inner.run(function () {});
      })

      process.nextTick(function () {
        delayed(null, 'foo')
      })
    })
  })

  //========================================================================
  //========================================================================
  // skeletonized span handling. these are unsampled traces that create an
  // entry span and a single skeleton span that is used for all other spans.
  //========================================================================
  //========================================================================

  // unsampled messages should not be sent but the skeleton span should
  // allow everything to work through to calling sendReport(). if there is
  // an error before sendReport() is called then the skeleton span is not
  // working correctly. sendReport() should not call send() because all
  // skeleton spans are unsampled. this helper replaces the sending
  // functions to verify that the skeleton span is working correctly and
  // that it's not actually being sent.
  //
  // set options.verbose to print what's going to be tested.
  function setupMockEventSending (sequencing, options = {}) {
    let sendReportCalls = 0;
    let sendCalls = 0;
    let counter = 0;
    const errors = [];

    const originalSendReport = Event.prototype.sendReport;
    Event.prototype.sendReport = function testSendReport (...args) {
      if (!this.ignore) {
        ao.lastEvent = this;
      }
      if (counter >= sequencing.length) {
        errors.push(util.format({found: this, expected: 'nothing'}));
        return;
      }
      const event = {};
      for (const key in sequencing[counter]) {
        event[key] = this[key];
      }
      if (options.verbose) {
        // eslint-disable-next-line no-console
        console.log(event, 'should equal', sequencing[counter]);
      }

      try {
        expect(event).deep.equal(sequencing[counter]);
      } catch (e) {
        errors.push(util.format({counter, event, expected: sequencing[counter]}));
      }
      counter += 1;
      sendReportCalls += 1;
    };
    const originalSend = Event.prototype.send;
    Event.prototype.send = function testSend (...args) {
      sendCalls += 1;
    };

    return function getResults () {
      Event.prototype.sendReport = originalSendReport;
      Event.prototype.send = originalSend;
      return {
        sendReportCalls,
        sendCalls,
        errors,
      };
    }
  }

  //
  // base span reporting
  //
  it('should skeletonize unsampled sync boundaries', function () {
    let inner;
    const settings = makeSettings({doSample: false});
    const outer = Span.makeEntrySpan('outer', settings);

    const sequencing = [
      {Layer: 'outer', Label: 'entry'},
      {Layer: '__skeleton__', Label: 'entry'},
      {Layer: '__skeleton__', Label: 'exit'},
      {Layer: 'outer', Label: 'exit'},
    ];

    const getResults = setupMockEventSending(sequencing, {verbose: false});

    outer.run(function () {
      inner = ao.lastSpan.descend('inner');
      inner.run(function () {});
    });

    const {sendReportCalls, sendCalls} = getResults();
    expect(sendReportCalls).equal(4);
    expect(sendCalls).equal(0);
  });

  it('should skeletonize unsampled async boundaries', function (done) {
    ao.logLevel = logLevel + ',event:*,span';
    const name = 'test-async-boundaries';
    const settings = makeSettings({doSample: false});
    const span = Span.makeEntrySpan(name, settings);

    const sequencing = [
      {Layer: name, Label: 'entry'},
      {Layer: '__skeleton__', Label: 'entry'},
      {Layer: '__skeleton__', Label: 'exit'},
      {Layer: name, Label: 'exit'},
    ];

    const getResults = setupMockEventSending(sequencing, {verbose: true});

    span.debugIt = true;
    span.runAsync(function (wrap) {
      const cb = wrap(function (err, res) {
        expect(err).not.exist;
        res.should.equal('foo');
        const {sendReportCalls, sendCalls, errors} = getResults();
        expect(sendReportCalls).equal(4);
        expect(sendCalls).equal(0);
        expect(errors.length).equal(0, `found\n${errors}`);
        done();
      });

      // our async span invokes a synchronous span
      process.nextTick(function () {
        const inner = ao.lastSpan.descend('inner');
        inner.run(() => {});
        cb(null, 'foo');
      });
    });
  })

  //
  // Verify behaviour when reporting nested spans
  //
  it('should skeletonize unsampled nested sync boundaries', function () {
    const name = 'nested-sync-boundaries';
    let inner;

    const sequencing = [
      {Layer: name, Label: 'entry'},
      {Layer: '__skeleton__', Label: 'entry'},
      {Layer: '__skeleton__', Label: 'exit'},
      {Layer: name, Label: 'exit'},
    ];

    const getResults = setupMockEventSending(sequencing, {verbose: false});

    const settings = makeSettings({doSample: false});
    const outer = Span.makeEntrySpan(name, settings);

    outer.run(function () {
      inner = ao.lastSpan.descend('inner');
      inner.run(function () {});
    });

    const {sendReportCalls, sendCalls, errors} = getResults();
    expect(sendReportCalls).equal(4);
    expect(sendCalls).equal(0);
    expect(errors.length).equal(0, `found\n${errors}`);
  });

  it('should skeletonize unsampled async span within sync spans', function (done) {
    const name = 'nested-async-in-sync';
    let inner;

    // the delay to complete the async span results in the sync event
    // completing first.
    const sequencing = [
      {Layer: name, Label: 'entry'},
      {Layer: '__skeleton__', Label: 'entry'},
      {Layer: name, Label: 'exit'},
      {Layer: '__skeleton__', Label: 'exit'},
    ];

    const getResults = setupMockEventSending(sequencing, {verbose: false});

    const settings = makeSettings({doSample: false});
    const outer = Span.makeEntrySpan(name, settings);

    outer.run(function () {
      inner = ao.lastSpan.descend('inner');
      inner.run(function (wrap) {
        const delayed = wrap(function (err, res) {
          expect(err).not.exist;
          expect(res).equal('foo');
          const {sendReportCalls, sendCalls, errors} = getResults();
          expect(sendReportCalls).equal(4);
          expect(sendCalls).equal(0);
          expect(errors.length).equal(0, `found\n${errors}`);
          done();
        })

        process.nextTick(function () {
          delayed(null, 'foo')
        })
      })
    })
  })

  it('should skeletonize a sync span within async span', function (done) {
    const name = 'nested-sync-in-async';
    let inner;

    // the async span was the last span executed when the sync span is
    // run even though the async span completed.
    const sequencing = [
      {Layer: name, Label: 'entry'},
      {Layer: name, Label: 'exit'},
      {Layer: '__skeleton__', Label: 'entry'},
      {Layer: '__skeleton__', Label: 'exit'},
    ];

    const getResults = setupMockEventSending(sequencing, {verbose: false});

    const settings = makeSettings({doSample: false});
    const outer = Span.makeEntrySpan(name, settings);

    outer.run(function (wrapper) {
      const wrappedAsyncCompletion = wrapper(function (err, res) {
        expect(err).not.exist;
        expect(res).equal('foo');

        inner = ao.lastSpan.descend('inner')
        inner.run(function () {});

        const {sendReportCalls, sendCalls, errors} = getResults();
        expect(sendReportCalls).equal(4);
        expect(sendCalls).equal(0);
        expect(errors.length).equal(0, `found\n${errors}`);
        done();
      });

      process.nextTick(function () {
        wrappedAsyncCompletion(null, 'foo')
      });
    });
  });

  it('should skeletonize multiple levels of sync events', function () {
    const name = 'multiple-sync-levels';
    const outerData = {Foo: 'bar'};
    const maxDepth = 3;
    let depth = 0;

    const sequencing = [
      {Layer: name, Label: 'entry'},
      {Layer: '__skeleton__', Label: 'entry'},
      {Layer: '__skeleton__', Label: 'entry'},
      {Layer: '__skeleton__', Label: 'entry'},
      {Layer: '__skeleton__', Label: 'exit'},
      {Layer: '__skeleton__', Label: 'exit'},
      {Layer: '__skeleton__', Label: 'exit'},
      {Layer: name, Label: 'exit'},
    ];

    const getResults = setupMockEventSending(sequencing, {verbose: false});

    const settings = makeSettings({doSample: false});
    const outer = Span.makeEntrySpan(name, settings, outerData);

    function digDeeper () {
      depth += 1;
      if (depth > maxDepth) {
        return;
      }
      const span = ao.lastSpan.descend(`inner-${depth}`);
      span.run(digDeeper);
    }

    outer.run(digDeeper);

    const {sendReportCalls, sendCalls, errors} = getResults();
    expect(errors.length).equal(0, `found\n${errors}`);
    expect(sendReportCalls).equal(8);
    expect(sendCalls).equal(0);

  });

  it('should skeletonize multiple levels of async events', function () {
    const name = 'multiple-async';
    const maxDepth = 3;
    let depth = 0;

    const sequencing = [
      {Layer: name, Label: 'entry'},
      {Layer: name, Label: 'exit'},
      {Layer: '__skeleton__', Label: 'entry'},
      {Layer: '__skeleton__', Label: 'exit'},
      {Layer: '__skeleton__', Label: 'entry'},
      {Layer: '__skeleton__', Label: 'exit'},
      {Layer: '__skeleton__', Label: 'entry'},
      {Layer: '__skeleton__', Label: 'exit'},
    ];

    let resolver;

    const p = new Promise(resolve => {
      resolver = resolve;
    });

    const getResults = setupMockEventSending(sequencing, {verbose: false});

    const settings = makeSettings({doSample: false});
    const outer = Span.makeEntrySpan(name, settings);

    // invoke async spans
    function asyncDigDeeper (wrapper) {
      depth += 1;

      const wrappedAsyncFunction = wrapper(function (err, res) {
        expect(err).not.exist;
        expect(res).equal(`arg-${depth}`);

        // if maxDepth's been reached don't dig deeper.
        if (depth > maxDepth) {
          resolver();
          return;
        }

        const span = ao.lastSpan.descend(`inner-${depth}`);
        span.run(asyncDigDeeper);
      });

      process.nextTick(() => wrappedAsyncFunction(null, `arg-${depth}`));
    }

    outer.run(asyncDigDeeper);

    return p.then(() => {
      const {sendReportCalls, sendCalls, errors} = getResults();
      expect(errors.length).equal(0, `found\n${errors}`);
      expect(sendReportCalls).equal(8, 'sendReportCalls');
      expect(sendCalls).equal(0, 'send should never be called');
    });

  });

  it('should skeletonize multiple levels of sync and async events', function () {
    const name = 'multiple-sync-async';
    const maxDepth = 3;
    let depth = 0;

    const sequencing = [
      {Layer: name, Label: 'entry'},          // enter outer
      {Layer: '__skeleton__', Label: 'entry'},    // unconditional asyncDigDeeper
      {Layer: '__skeleton__', Label: 'exit'},     // exit unconditional asyncDigDeeper
      {Layer: '__skeleton__', Label: 'entry'},    // enter depth 1 sync
      {Layer: '__skeleton__', Label: 'entry'},    // enter depth 2 async
      {Layer: '__skeleton__', Label: 'exit'},     // exit depth 1 sync
      {Layer: '__skeleton__', Label: 'exit'},     // exit depth 2 async
      {Layer: '__skeleton__', Label: 'entry'},    // enter depth 3 sync
      {Layer: '__skeleton__', Label: 'exit'},     // exit depth 3 sync
      {Layer: name, Label: 'exit'},           // exit outer
    ];

    let resolver;

    const p = new Promise(resolve => {
      resolver = resolve;
    });
    const verbose = false;

    const getResults = setupMockEventSending(sequencing, {verbose});

    function alternatingRunner (span) {
      const sync = depth & 1;
      const fn = sync ? syncDigDeeper : asyncDigDeeper;
      span.run(fn);
    }

    // invoke sync spans
    function syncDigDeeper () {
      const thisDepth = depth;
      depth += 1;

      if (verbose) {
        // eslint-disable-next-line no-console
        console.log(`entering ${thisDepth} sync`);
      }

      // if more depth allowed descend another level.
      if (depth <= maxDepth) {
        const span = ao.lastSpan.descend(`inner-${depth}`);
        alternatingRunner(span);
      }

      if (verbose) {
        // eslint-disable-next-line no-console
        console.log(`exiting ${thisDepth} sync`);
      }
    }

    // invoke async spans
    function asyncDigDeeper (wrapper) {
      const thisDepth = depth;
      depth += 1;

      if (verbose) {
        // eslint-disable-next-line no-console
        console.log(`entering ${thisDepth} async`)
      }

      const wrappedAsyncFunction = wrapper(function (err, res) {
        if (verbose) {
          // eslint-disable-next-line no-console
          console.log(`exiting ${thisDepth} async`)
        }
        expect(err).not.exist;
        expect(res).equal(`arg-${depth}`);

        // if maxDepth's been reached don't dig deeper.
        if (depth > maxDepth) {
          return;
        }

        const span = ao.lastSpan.descend(`inner-${depth}`);
        alternatingRunner(span);
      });

      process.nextTick(() => {
        wrappedAsyncFunction(null, `arg-${depth}`)
      });
    }

    const settings = makeSettings({doSample: false});
    const outer = Span.makeEntrySpan(name, settings);

    outer.run(function (wrapper) {
      const span = ao.lastSpan.descend(`inner-${depth}`);
      span.run(asyncDigDeeper);
      const outerAsyncWrapped = wrapper(function (err, res) {
        expect(err).not.exist;
        expect(res).equal('outer-done');
        resolver();
      });

      // do this so it doesn't take a full second and half. basically
      // make the outer span take longer than all the inner spans.
      const iid = setInterval(function () {
        if (depth > maxDepth) {
          outerAsyncWrapped(null, 'outer-done');
          clearInterval(iid);
        }
      }, 50);
    });

    return p.then(() => {
      const {sendReportCalls, sendCalls, errors} = getResults();
      expect(errors.length).equal(0, `found\n${errors}`);
      expect(sendReportCalls).equal(10, 'sendReportCalls');
      expect(sendCalls).equal(0, 'send should never be called');
    });

  });

  //===========================================================
  // Special events
  //===========================================================
  it('should send info events', function (done) {
    const span = Span.makeEntrySpan('test', makeSettings(), {})
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

  //===================================================
  // Safety and correctness
  //===================================================
  it('should only send valid properties', function (done) {
    const span = Span.makeEntrySpan('test', makeSettings(), {})

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

  //=====================================================
  // Structural integrity
  //=====================================================
  it('should chain internal event edges', function (done) {
    const n = 10 + Math.floor(Math.random() * 10)
    const span = Span.makeEntrySpan('test', makeSettings(), {})

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

  it('should properly attribute dangling info/error events', function (tdone) {
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

    function done () {
      tdone();
    }

    helper.doChecks(emitter, checks, done)

    ao.requestStore.run(function () {
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

  it('should generate the expected stats', function () {
    const stats = ao._stats.span;
    expect(stats.topSpansActive).equal(0, 'no topSpans should be active');
    expect(stats.otherSpansActive).equal(0, 'no spans should be active');
    expect(stats.totalCreated).equal(64, 'total spans created should be correct');
    expect(stats.topSpansCreated).equal(27, 'total traces created should be correct');
  })

})
