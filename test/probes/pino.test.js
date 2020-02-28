'use strict'

const ao = require('../..');

const helper = require('../helper');
const expect = require('chai').expect;
const os = require('os');
const semver = require('semver');

const pino = require('pino');
const {version} = require('pino/package.json');

// NOTE - context pino 5.12.2 with flatstr 1.0.9
// this test sometimes fails with "SyntaxError: Unexpected token '%'" which is
// the result of flatstr failing intermittently. Running the most recent
// version of pino which updates the flatstr dependency has prevented this
// error so far. It's not obvious from looking at the code why the error was
// not handled by the try-catch clauses in flatstr.
// https://github.com/davidmarkclements/flatstr/issues/5

const major = semver.major(version);
let streamSym;
if (major >= 5) {
  streamSym = pino.symbols.streamSym;
}
const {EventEmitter} = require('events');

//> child.info('message to love')
//{"level": 30, "time": 1554384912925, "pid": 31188, "hostname": "uxpanapa", "a": 100, "msg": "message to love", "v": 1}
//undefined
//  > logger.info({a: 88})
//{"level": 30, "time": 1554385436410, "pid": 31188, "hostname": "uxpanapa", "a": 88, "v": 1}
//undefined
//  > logger.info({message: 'what i wanna say'})
//{"level": 30, "time": 1554385458227, "pid": 31188, "hostname": "uxpanapa", "message": "what i wanna say", "v": 1}
//undefined
//  > logger.info('my message to you', {a: 1001})
//{"level": 30, "time": 1554385477498, "pid": 31188, "hostname": "uxpanapa", "msg": "my message to you {\"a\":1001}", "v": 1}
//undefined
//  > logger.info({a: 1001}, 'my message to you')
//{"level": 30, "time": 1554385692908, "pid": 31188, "hostname": "uxpanapa", "a": 1001, "msg": "my message to you", "v": 1}
//

const template1 = {
  level: 30,
  time: 0,
  pid: process.pid,
  hostname: os.hostname(),
}

const template2 = {
  v: 1,
}

/**
 * predefined - objects set in a logger that are inherited by a child. they come
 * before the message and objects specified in a specific log call.
 *
 * msg - the string specified in the call to the logger.
 *
 * obj - the object specified in the call to the logger.
 */
function makeExpected (pre, msg, post) {
  pre = makePre(pre);
  post = makePost(post);
  return Object.assign({}, pre, {msg}, post);
}

function makePre (obj) {
  return Object.assign({}, template1, obj);
}

function makePost (obj) {
  return Object.assign({}, obj, template2);
}

function checkEventInfo (eventInfo, level, message, traceId) {
  // check the time first. just make sure it's kind of close
  eventInfo = JSON.parse(eventInfo);
  expect(eventInfo.time).within(Date.now() - 150, Date.now() + 100);
  // if the time is good reset it to be exact so expect().eql will work
  const post = traceId ? {ao: {traceId}} : {};
  const expected = makeExpected(
    {level: pino.levels.values[level], time: eventInfo.time},
    message,
    post
  );
  expect(eventInfo).deep.equal(expected);
}

//
// get a trace string via a different function than the logging insertion uses.
//
function getTraceIdString () {
  const firstEvent = ao.tContext.get('topSpan').events.entry;
  // 2 task, 16 sample bit, 32 separators
  return firstEvent.toString(2 | 16 | 32);
}

const insertModes = [false, true, 'traced', 'sampledOnly', 'always'];


//=================================
// pino tests
//=================================
describe(`pino v${version}`, function () {
  let logger;
  let emitter;
  let counter = 0;
  let pfx;
  let spanName;
  let stream;
  const logEmitter = new EventEmitter();
  const debugging = false;

  // used by each test
  let eventInfo;

  before (function () {
    // listen to our fake stream.
    logEmitter.addListener('test-log', function (s) {
      eventInfo = s;
    })
  })

  before(function () {
    //
    // make decisions based on pino version
    //
    if (major >= 5) {
      // make the logger
      logger = pino();

      //
      // modify the logger so that it emits logging so it can be checked. implement
      // only the functions that are called.
      //
      stream = logger[streamSym] = {
        write (s) {
          logEmitter.emit('test-log', s);
          if (debugging) {
            console.log(s);  // eslint-disable-line
          }
        },
        flush () {},
        flushSync () {},
      }
      Object.setPrototypeOf(stream, EventEmitter.prototype);
    } else if (major >= 2) {
      logger = pino();

      //
      // modify the logger so that it emits logging so it can be checked. implement
      // only the functions that are called.
      //
      stream = logger.stream = {
        write (s) {
          logEmitter.emit('test-log', s);
          if (debugging) {
            console.log(s);   // eslint-disable-line
          }
        },
        flush () {},
        flushSync () {},
      }
      Object.setPrototypeOf(stream, EventEmitter.prototype);

      // listen to our fake stream.
      logEmitter.addListener('test-log', function (s) {
        eventInfo = s;
      })
    } else {
      throw new RangeError(`pino test - unsupported version: ${version}`);
    }
  })


  beforeEach(function () {
    // provide unique spans for up to 100 tests
    pfx = ('0' + counter++).slice(-2);
    spanName = `${pfx}-test`;

    // the following are global to all tests so they can use a common
    // check function.
    eventInfo = undefined;
  })

  //
  // Intercept appoptics messages for analysis
  //
  beforeEach(function (done) {
    ao.sampleRate = ao.addon.MAX_SAMPLE_RATE
    ao.traceMode = 'always'
    ao.cfg.insertTraceIdsIntoLogs = true;
    ao.probes.fs.enabled = false;

    emitter = helper.appoptics(done)
  })
  afterEach(function (done) {
    emitter.close(done)
  })

  // this test exists only to fix a problem with oboe not reporting a UDP
  // send failure.
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

  insertModes.forEach(mode => {
    const maybe = mode === false ? 'not ' : '';
    eventInfo = undefined;

    it(`should ${maybe}insert in sync sampled code when mode=${mode}`, function (done) {
      const level = 'info';
      const message = `synchronous traced setting = ${mode}`;
      let traceId;

      ao.cfg.insertTraceIdsIntoLogs = mode;

      function localDone () {
        checkEventInfo(eventInfo, level, message, mode === false ? undefined : traceId);
        done();
      }

      helper.test(emitter, function (done) {
        ao.instrument(spanName, function () {
          traceId = getTraceIdString();
          // log
          logger.info(message);
        })
        done()
      }, [
        function (msg) {
          msg.should.have.property('Layer', spanName)
          msg.should.have.property('Label', 'entry')
        },
        function (msg) {
          msg.should.have.property('Layer', spanName)
          msg.should.have.property('Label', 'exit')
        }
      ], localDone)
    })
  })

  insertModes.forEach(mode => {
    const maybe = (mode === 'sampledOnly' || mode === false) ? 'not ' : '';

    it(`should ${maybe}insert in sync unsampled code when mode=${mode}`, function () {
      const level = 'info';
      const message = `synchronous unsampled setting = ${mode}`;
      let traceId;

      // these are reset in beforeEach() so set in each test.
      ao.cfg.insertTraceIdsIntoLogs = mode;
      ao.traceMode = 0;
      ao.sampleRate = 0;

      function test () {
        traceId = getTraceIdString();
        expect(traceId[traceId.length - 1] === '0', 'traceId shoud be unsampled');
        logger.info(message);
        return 'test-done';
      }

      const xtrace = ao.MB.makeRandom(0).toString();
      const result = ao.startOrContinueTrace(xtrace, spanName, test);

      expect(result).equal('test-done');
      checkEventInfo(eventInfo, level, message, maybe ? undefined : traceId);
    })
  })

  it('mode=\'always\' should always insert a trace ID even if not tracing', function () {
    const level = 'info';
    const message = 'always insert';

    ao.cfg.insertTraceIdsIntoLogs = 'always';

    logger.info(message);

    checkEventInfo(eventInfo, level, message, `${'0'.repeat(40)}-0`);
  })

  it('should insert trace IDs in asynchronous instrumented code', function (done) {
    const level = 'error';
    const message = 'asynchronous instrumentation';
    let traceId;

    function localDone () {
      checkEventInfo(eventInfo, level, message, traceId);
      done();
    }

    function asyncFunction (cb) {
      traceId = getTraceIdString();
      logger.error(message);
      setTimeout(function () {
        cb();
      }, 100);
    }

    helper.test(emitter, function (done) {
      ao.instrument(spanName, asyncFunction, done)
    }, [
      function (msg) {
        msg.should.have.property('Layer', spanName)
        msg.should.have.property('Label', 'entry')
      },
      function (msg) {
        msg.should.have.property('Layer', spanName)
        msg.should.have.property('Label', 'exit')
      }
    ], localDone)
  })

  it('should insert trace IDs in promise-based instrumented code', function (done) {
    const level = 'info';
    const message = 'promise instrumentation';
    let traceId;
    const result = 99;

    function localDone () {
      checkEventInfo(eventInfo, level, message, traceId);
      done();
    }

    function promiseFunction () {
      traceId = getTraceIdString();
      logger[level](message)
      return new Promise((resolve, reject) => {
        setTimeout(function () {
          resolve(result);
        }, 25);
      })
    }

    helper.test(
      emitter,
      function (done) {
        ao.pInstrument(spanName, promiseFunction).then(r => {
          expect(r).equal(result);
          done()
        })
      }, [
        function (msg) {
          msg.should.have.property('Layer', spanName)
          msg.should.have.property('Label', 'entry')
        },
        function (msg) {
          msg.should.have.property('Layer', spanName)
          msg.should.have.property('Label', 'exit')
        }
      ], localDone)
  })

  it('should insert trace IDs using the function directly', function (done) {
    const level = 'info';
    ao.cfg.insertTraceIdsIntoLogs = false;
    const message = 'helper and synchronous %s';
    let traceId;

    function localDone () {
      const m = message.replace('%s', traceId);
      checkEventInfo(eventInfo, level, m);
      done();
    }

    helper.test(
      emitter,
      function (done) {
        ao.instrument(spanName, function () {
          traceId = getTraceIdString();
          logger[level](message, getTraceIdString());
        })
        done();
      },
      [
        function (msg) {
          msg.should.have.property('Layer', spanName)
          msg.should.have.property('Label', 'entry')
        },
        function (msg) {
          msg.should.have.property('Layer', spanName)
          msg.should.have.property('Label', 'exit')
        }
      ],
      localDone
    );
  })

})

