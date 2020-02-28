'use strict'

const helper = require('../helper')
const {ao} = require('../1.test-common')
const expect = require('chai').expect
const addon = ao.addon
const testdebug = ao.logger.make('testdebug');

const http = require('http');
const axios = require('axios');
const hmacSha1 = require('crypto-js/hmac-sha1');
const hashToHex = require('crypto-js/enc-hex').stringify;


const mockToken = '8mZ98ZnZhhggcsUmdMbS';       // built-in secret key for udp/file reporters
const badMockToken = 'xyzzyadventuredragon';    // any secret key that isn't the same as above
const pdKeysValue = 'lo:se,check-id:123';       // some "standard" values. well, before adding tests.
const signedCustomKey = 'custom-1';             // ditto
const signedCustomValue = 'One';                // ditto
const ttKey = {TriggeredTrace: true};
const oa = Object.assign;                       // shorthand
const erStack = [];                             // a stack to enable and restore config state.

/* eslint-disable max-len */

// test definitions.
//
// desc [string] - description of test for `it('should ${test.desc}, ...)`.
// options [string] - the x-trace-options header
// xtrace [optional boolean] - if present add an xtrace header with sample bit as specified
// ts [optional string] - at test execution, replaces '${ts}' in the options header with a unix timestamp
// sample [boolean] - the request should be sampled, so check for correct UDP messages
// sig [optional string] - 'bad' => bad key, 'good' => good key, else no signature
// setup, teardown [optional function] - if present execute at start and end of test
// expected [string] - response expected in x-trace-options-response
// expectedKeys [optional object] - keys that must be present in entry event message.
// invalidKeys [optional object] - keys that must *not* be present in the entry event message.
// debug [optional boolean] - if true invoke debugger for test
//
const tests = [
  //
  // variations from acceptance criteria, phase I: permutations on x-trace-options contents.
  //
  {desc: 'handle a valid x-trace-options header',
    options: 'trigger-trace;custom-something=value;custom-OtherThing=other val;pd-keys=029734wr70:9wqj21,0d9j1',
    sample: true,
    expected: 'trigger-trace=ok',
    expectedKeys: oa({'PDKeys': '029734wr70:9wqj21,0d9j1', 'custom-something': 'value', 'custom-OtherThing': 'other val'}, ttKey)},
  {desc: 'remove leading/trailing spaces',
    options: 'custom-something=value; custom-OtherThing = other val ;pd-keys=029734wr70:9wqj21,0d9j1',
    sample: true,
    expected: 'trigger-trace=not-requested',
    expectedKeys: {PDKeys: '029734wr70:9wqj21,0d9j1', 'custom-something': 'value', 'custom-OtherThing': 'other val'}},
  {desc: 'report and log ignored keys',
    options: 'what_is_this=value_thing;and_that=otherval;whoot',
    sample: true,       // maybe needs to be determined by getTracingDecisions() in the future
    expected: 'trigger-trace=not-requested;ignored=what_is_this,and_that,whoot'},
  {desc: 'ignore and report trigger-trace with a value',
    options: 'trigger-trace=1;custom-something=value_thing',
    sample: true,       // ditto
    expected: 'trigger-trace=not-requested;ignored=trigger-trace',
    expectedKeys: {'custom-something': 'value_thing'},
    invalidKeys: ttKey},
  {desc: 'keep the value of the first repeated key',
    options: 'custom-something=keep_this_0;pd-keys=keep_this;pd-keys=029734wrqj21,0d9;custom-something=otherval',
    sample: true,
    expected: 'trigger-trace=not-requested',
    expectedKeys: {'custom-something': 'keep_this_0', PDKeys: 'keep_this'},
    invalidKeys: ttKey},
  {desc: 'keep a value that includes ‘=’',
    options: 'trigger-trace;custom-something=value_thing=4;custom-OtherThing=other val',
    sample: true,
    expected: 'trigger-trace=ok',
    expectedKeys: oa({'custom-something': 'value_thing=4', 'custom-OtherThing': 'other val'}, ttKey)},
  {desc: 'ignore quotes',
    options: 'trigger-trace;custom-foo="bar;bar";custom-bar=foo',
    sample: true,
    expected: 'trigger-trace=ok;ignored=bar"',
    expectedKeys: oa({'custom-foo': '"bar', 'custom-bar': 'foo'}, ttKey)},
  {desc: 'handle missing keys',
    options: ';trigger-trace;custom-something=value_thing;pd-keys=02973r70:9wqj21,0d9j1;1;2;3;4;5;=custom-key=val?;=',
    sample: true,
    expected: 'trigger-trace=ok;ignored=1,2,3,4,5,',
    expectedKeys: oa({'custom-something': 'value_thing', PDKeys: '02973r70:9wqj21,0d9j1'}, ttKey)},
  {desc: 'handle multiple sequential ;;;',
    options: 'custom-something=value_thing;pd-keys=02973r70;;;;custom-key=val',
    sample: true,
    expected: 'trigger-trace=not-requested',
    expectedKeys: {'custom-something': 'value_thing', PDKeys: '02973r70', 'custom-key': 'val'}},
  //
  // from results-matrix, variations on responses for different scenarios
  //
  {desc: 'handle a valid signature',
    options: `trigger-trace;pd-keys=${pdKeysValue};${signedCustomKey}=${signedCustomValue};ts=\${ts}`,
    ts: 'ts', sig: 'good', sample: true,
    expected: 'auth=ok;trigger-trace=ok',
    expectedKeys: oa({PDKeys: pdKeysValue}, ttKey)},
  {desc: 'respond that a signature is not valid',
    options: `trigger-trace;pd-keys=${pdKeysValue};ts=\${ts}`,
    ts: 'ts', sig: 'bad', sample: false,
    expected: 'auth=bad-signature'},
  {desc: 'respond that an expired timestamp is not valid',
    options: `trigger-trace;pd-keys=${pdKeysValue};ts=\${ts}`,
    ts: 'expired', sig: 'good', sample: false,
    expected: 'auth=bad-timestamp'},
  {desc: 'respond that a missing timestamp is not valid',
    options: `trigger-trace;pd-keys=${pdKeysValue}`,
    sig: 'good', sample: false,
    expected: 'auth=bad-timestamp'},
  {desc: 'respond that trigger trace is disabled when it is',
    options: `trigger-trace;pd-keys=${pdKeysValue};${signedCustomKey}=${signedCustomValue};ts=\${ts}`,
    ts: 'ts', sig: 'good', sample: false,
    setup: disableTT, teardown: restoreTT,
    expected: 'auth=ok;trigger-trace=trigger-tracing-disabled'},
  {desc: 'respond that tracing is disabled when it is',
    options: `trigger-trace;pd-keys=${pdKeysValue};${signedCustomKey}=${signedCustomValue};ts=\${ts}`,
    ts: 'ts', sig: 'good', sample: false,
    setup: disableTracing, teardown: restoreTracing,
    expected: 'auth=not-checked;trigger-trace=tracing-disabled'},
  {desc: 'verify mocked rate-limiting returns the right message',
    options: `trigger-trace;pd-keys=${pdKeysValue}`,
    sample: false,
    setup: wrapGTS, teardown: unwrapGTS,
    expected: 'trigger-trace=rate-exceeded'},
  {desc: 'verify that signed-mocked rate-limiting returns the right message',
    options: `trigger-trace;pd-keys=${pdKeysValue};ts=\${ts}`,
    ts: 'ts', sig: 'good', sample: false,
    setup: wrapGTS, teardown: unwrapGTS,
    expected: 'auth=ok;trigger-trace=rate-exceeded'},

  //
  // unexpected usage
  //

  // if x-trace and unsigned x-trace-options trigger-trace request are valid, obey x-trace
  {desc: 'prioritize an x-trace header over unsigned trigger-trace request',
    options: `trigger-trace;pd-keys=${pdKeysValue};custom-xyzzy=plover`,
    xtrace: 1, sample: true,
    expected: 'trigger-trace=ignored',
    expectedKeys: {PDKeys: pdKeysValue, 'custom-xyzzy': 'plover'},
    invalidKeys: ttKey},
  // if x-trace and unsigned x-trace-options without trigger-trace request are valid, obey x-trace
  {desc: 'add x-trace-options KV pairs to an existing x-trace',
    options: `pd-keys=${pdKeysValue};custom-xyzzy=plover`,
    xtrace: 1, sample: true,
    expected: 'trigger-trace=not-requested',
    expectedKeys: {PDKeys: pdKeysValue, 'custom-xyzzy': 'plover'},
    invalidKeys: ttKey},
  // if x-trace and signed x-trace-options with trigger-trace, obey x-trace
  {desc: 'add x-trace-options KV pairs to an existing x-trace',
    options: `trigger-trace;pd-keys=${pdKeysValue};custom-xyzzy=plover;ts=\${ts}`,
    ts: 'ts', sig: 'good',
    xtrace: 1, sample: true,
    expected: 'auth=ok;trigger-trace=ignored',
    expectedKeys: {PDKeys: pdKeysValue, 'custom-xyzzy': 'plover'},
    invalidKeys: ttKey},
  {desc: 'add x-trace-options KV pairs to an existing x-trace',
    options: `trigger-trace;pd-keys=${pdKeysValue};custom-xyzzy=plover;ts=\${ts}`,
    ts: 'ts', sig: 'good',
    xtrace: 0, sample: false,
    expected: 'auth=ok;trigger-trace=ignored',
    expectedKeys: {PDKeys: pdKeysValue, 'custom-xyzzy': 'plover'},
    invalidKeys: ttKey},
  // if x-trace and bad sig x-trace-options without trigger-trace request, do neither
  {desc: 'invalidate both x-trace and x-trace-options on bad signature',
    options: `pd-keys=${pdKeysValue};custom-xyzzy=plover;ts=\${ts}`,
    ts: 'ts', sig: 'bad',
    xtrace: 1, sample: false,
    expected: 'auth=bad-signature'},
  // if x-trace and bad sig on x-trace-options with trigger-trace request, do neither
  {desc: 'invalidate both x-trace and x-trace-options with trigger-trace on bad signature',
    options: `trigger-trace;pd-keys=${pdKeysValue};custom-xyzzy=plover;ts=\${ts}`,
    ts: 'ts', sig: 'bad',
    xtrace: 1, sample: false,
    expected: 'auth=bad-signature'}
];
/* eslint-enable max-len */


//
// helper to make headers using a test definition as the spec.
//
function makeSignedHeaders (test) {
  let options = test.options;
  if (test.ts) {
    // make unix timestamp - seconds since epoch.
    let ts = Math.floor(Date.now() / 1000);
    if (test.ts === 'expired') {
      // force it 5 minutes and 1 second ago.
      ts -= 60 * 5 + 1;
    }
    options = options.replace('${ts}', ts);
  }
  const headers = {'x-trace-options': options};

  if (test.sig) {
    const token = test.sig === 'bad' ? badMockToken : mockToken;
    const hmac = hmacSha1(options, token);
    const hexString = hashToHex(hmac);
    headers['x-trace-options-signature'] = hexString;
  }

  // add an xtrace with appropriate sample bit if requezted
  if ('xtrace' in test) {
    headers['x-trace'] = ao.MB.makeRandom(test.xtrace).toString();
  }

  return headers;
}

//
// helpers to disable/restore trigger-tracing and tracing
//
function disableTT () {
  erStack.push(ao.cfg.triggerTraceEnabled);
  ao.cfg.triggerTraceEnabled = false;
}
function restoreTT () {
  ao.cfg.triggerTraceEnabled = erStack.pop();
}

function disableTracing () {
  erStack.push(ao.traceMode);
  ao.traceMode = 'disabled';
}
function restoreTracing () {
  ao.traceMode = erStack.pop();
}

// helper to force rate-exceeded return
// oops, look like rate limiting doesn't work with UDP.
// check with daniel - maybe oboe reporter can be a
// base class that handles rate limiting, etc. that
// each class (ssl, udp, file) inherits from?
//function consumeAllowed (test) {
//  let counter = 0;
//  const options = {
//    typeRequested: 1,
//    xtraceOpts: test.options
//  }
//  const results = [];
//
//  while (counter++ < 100) {
//    const settings = ao.addon.Settings.getTraceSettings('', options);
//    results.push(settings.status);
//    if (settings.status !== 0) {
//      console.log(settings.status, settings.message);
//    }
//  }
//  return results;
//}

// helper to wrap getTraceSettings()
function wrapGTS () {
  const realGetTraceSettings = ao.getTraceSettings;
  erStack.push(realGetTraceSettings);
  ao.getTraceSettings = function wrappedGetTraceSettings (...args) {
    const settings = realGetTraceSettings(...args);
    if (settings.status > 0) {
      return settings;
    }
    // mock that the good return is rate-exceeded.
    settings.message = 'rate-exceeded';
    settings.doSample = false;
    settings.doMetrics = false;
    settings.metadata.assignFlags(0);
    return settings;
  }
}
function unwrapGTS () {
  ao.getTraceSettings = erStack.pop();
}

//
// here's the runtime test environment setup.
//
describe('probes.http trigger-trace', function () {
  let emitter

  before(function (done) {
    // setup to handle messages
    emitter = helper.appoptics(done)
    ao.sampleRate = addon.MAX_SAMPLE_RATE
    ao.traceMode = 'always'

    // set the testing context for debugging tests.
    ao.g.testing(__filename)
  })

  let options;
  let server;
  let p;
  const afterServerIsReady = new Promise(resolve => {
    p = resolve;
  });

  // create a server once
  before(function (done) {
    server = http.createServer(function (req, res) {
      res.end('done')
    });
    server.listen(function () {
      options = {url: `http://localhost:${server.address().port}`};
      p();
      done()
    });
  });

  // and close it when done
  after(function () {
    server.close();
  })
  after(function (done) {
    emitter.close(done)
  })
  after(function () {
    const {spansTopSpanEnters, spansTopSpanExits} = ao.Span.getMetrics();
    ao.loggers.debug(`enters ${spansTopSpanEnters} exits ${spansTopSpanExits}`);
  })

  // from test/http.test.js
  const check = {
    server: {
      entry: function (msg) {
        expect(msg).property('Layer', 'nodejs')
        expect(msg).property('Label', 'entry')
      },
      exit: function (msg) {
        expect(msg).property('Layer', 'nodejs')
        expect(msg).property('Label', 'exit')
      }
    },
  }

  // would be nice if oboe had a udp-counter.
  it('should do it\'s UDP thing', function (done) {
    helper.test(emitter, function (done) {
      ao.instrument('fake', function () {})
      done()
    }, [
      function (msg) {
        expect(msg).property('Label').oneOf(['entry', 'exit']);
        expect(msg).property('Layer', 'fake')
      }
    ], done)
  })

  //
  // here's where the tests finally get executed
  //
  tests.forEach(test => {
    it(`should ${test.desc}`, function (done) {
      afterServerIsReady.then(() => {
        executeTest(test, done);
      });
    });
  });

  //
  // and this does the real work to execute the tests.
  //
  function executeTest (t, done) {
    let messageCount = 0;
    let response;

    if (t.debug) {
      debugger // eslint-disable-line no-debugger
    }

    // if the test should be sampled set up the expected messages
    // to be received. if not sampled make sure it isn't by counting
    // the messages received.
    if (t.sample) {
      // which KV pairs should be expected?
      const expectedKeys = t.expectedKeys || {};
      helper.doChecks(emitter, [
        function (msg) {
          testdebug('checking entry');

          messageCount += 1;
          check.server.entry(msg);

          for (const key in expectedKeys) {
            expect(msg).property(key, expectedKeys[key]);
          }

          if (t.invalidKeys) {
            for (const key in t.invalidKeys) {
              expect(msg).not.property(key);
            }
          }
          //expect(msg).property('Method', 'GET')
          //expect(msg).property('Proto', 'http')
          //expect(msg).property('HTTP-Host', 'localhost')
          //expect(msg).property('Port', port)
          //expect(msg).property('URL', '/foo?bar=baz')
          //expect(msg).property('ClientIP')
        },
        function (msg) {
          testdebug('checking exit');

          messageCount += 1;
          check.server.exit(msg)
          //expect(msg).property('Status', 200)
        }
      ], function () {
        //done();  // removed in favor of using timeouts
      });
    } else {
      function counterListener (msg) {
        messageCount += 1;
      }
      emitter.removeAllListeners('message');
      emitter.on('message', counterListener);
    }

    // the test might have specific setup required. this was put into place to
    // disable tracing/trigger-tracing so those conditions could be tested.
    if (t.setup) {
      t.setup(t);
    }

    // make the request. using a catch on the promise chain is required when an
    // expect assertion fails it will error out otherwise, so catch the error,
    // print it for clarity, and make sure a teardown is executed if present.
    const opts = Object.assign({}, options, {headers: makeSignedHeaders(t)});
    axios.request(opts)
      .then(r => {
        const xtrace = r.headers['x-trace'];
        expect(typeof xtrace).equal('string');
        expect(xtrace.length).equal(60);
        // if expecting
        if ('xtrace' in t) {
          const mdSampleBit = ao.MB.stringToMetabuf(xtrace).getFlags();
          // if the signature is bad then the expected bit should be 0.
          const expectedBit = (t.sig === 'bad' || (t.ts && t.ts !== 'ts')) ? 0 : t.xtrace;
          expect(mdSampleBit).equal(expectedBit, 'returned x-trace header must have correct sample bit');
        }
        response = r.headers['x-trace-options-response'];
        expect(response).equal(t.expected);
        // wait to make sure no messages come in if not expecting any.
        return wait(200);
      })
      .then(() => {
        if (!t.sample) {
          expect(messageCount).equal(0, 'messageCount must equal 0');
        } else {
          expect(messageCount).equal(2, 'expected entry and exit messages');
        }
        if (t.teardown) {
          t.teardown(t);
        }
        done();
      })
      .catch(e => {
        console.log(e.message); // eslint-disable-line
        if (t.teardown) {
          t.teardown(t);
        }
        done(e);
      });
  }

})

//
// helper to wait using promises
//
function wait (ms) {
  if (ms === 0) {
    return Promise.resolve()
  }
  return new Promise(resolve => setTimeout(resolve, ms))
}
