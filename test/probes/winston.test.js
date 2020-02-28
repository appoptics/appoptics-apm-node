'use strict'

const ao = require('../..');
const helper = require('../helper');
const semver = require('semver');
const expect = require('chai').expect;

const winston = require('winston');
const version = require('winston/package.json').version;
const major = semver.major(version);
if (major < 1 || major > 3) {
  throw new Error(`tests for winston version ${version} not implemented`);
}

let testTransport;
let createLogger;

const debugging = false;

//===============================================================
// version 3
//===============================================================
if (major >= 3) {
  const WinstonTransport = require('winston-transport');
  // define a transport class for this
  class TransportV3 extends WinstonTransport {
    constructor (opts) {
      super(opts);
    }
    log (info, cb) {
      this.emit('test-log', info);
      cb();
    }
  }
  testTransport = new TransportV3();
  const transports = [testTransport];

  //
  // add a console logger if debugging
  //
  if (debugging) {
    const consoleTransport = new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    });
    transports.push(consoleTransport);
  }
  // now store the create logger function.
  createLogger = () => winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss'
      }),
      winston.format.splat(),
      winston.format.json()
    ),
    defaultMeta,
    transports,
  });
//===============================================================
// version 2
//===============================================================
} else if (major === 2) {
  const TestEmitter = require('./winston/test-emitter').TestEmitter;
  testTransport = new TestEmitter({version: 2});
  const transports = [testTransport];
  if (debugging) {
    transports.push(new winston.transports.Console());
  }
  createLogger = () => new winston.Logger({transports});

//===============================================================
// version 1
//===============================================================
} else if (major === 1) {
  const TestEmitter = require('./winston/test-emitter').TestEmitter;
  // adding it implicitly instantiate it. it doesn't just make it
  // available as an option.
  //testTransport = winston.add(TestEmitter, {version: 1});

  testTransport = new TestEmitter({version: 1});
  const transports = [testTransport];
  if (debugging) {
    transports.push(new winston.transports.Console());
  }
  // create a new logger otherwise the console log is on by default.
  createLogger = () => new winston.Logger({transports});
}

const defaultMeta = {service: 'ao-test-winston'};

const logger = createLogger();

function stripSymbols (rest) {
  const symbols = Object.getOwnPropertySymbols(rest);
  for (let i = 0; i < symbols.length; i++) {
    delete rest[symbols[i]];
  }
  return rest;
}

function checkEventInfo3 (eventInfo, level, message, traceId) {
  const expected = {level, message}
  // defaultMeta wasn't an option prior to v3.2.0
  if (semver.gte(version, '3.2.0')) {
    expected.service = 'ao-test-winston';
  }
  expect(eventInfo).deep.include(expected);
  if (traceId) {
    expect(eventInfo.ao).deep.equal({traceId})
  }
  expect(eventInfo.timestamp).match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
}

function checkEventInfo2 (eventInfo, level, message, traceId) {
  expect(eventInfo[0]).equal(level, 'levels don\'t match');
  expect(eventInfo[1]).equal(message, 'messages don\'t match');
  if (traceId) {
    expect(eventInfo[2]).deep.equal({ao: {traceId}}, 'ao object doesn\'t match');
  }
}

function checkEventInfo1 (eventInfo, level, message, traceId) {
  expect(eventInfo[0]).equal(level, 'levels don\'t match');
  expect(eventInfo[1]).equal(message, 'messages don\'t match');
  if (traceId) {
    expect(eventInfo[2]).deep.equal({ao: {traceId}}, 'ao object doesn\'t match');
  }
}
//
// different checkers for different versions of winston
//
const checkEventInfo = {
  3: checkEventInfo3,
  2: checkEventInfo2,
  1: checkEventInfo1,
}[major];

//
// argument constructors for different versions of winston. v1 requires
// that the level be the first argument and be a string. v3 requires level
// be in a single object argument.
//
const makeLogArgs = {
  3: function (level, message) {return [{level, message}]},
  2: function (level, message) {return [level, message]},
  1: function (level, message) {return [level, message]},
}[major];
const makeHelperArgs = {
  3: function () {return [...arguments]},
  2: function () {return [...arguments]},
  1: function () {return [...arguments]}
}[major];


function getTraceIdString () {
  const topSpan = ao.tContext.get('topSpan').events.entry;
  // 2 task, 16 sample bit, 32 separators
  return topSpan.toString(2 | 16 | 32);
}

const insertModes = [false, true, 'traced', 'sampledOnly', 'always'];

//=================================
// winston tests
//=================================
describe(`winston v${version}`, function () {
  let emitter;
  let counter = 0;
  let pfx;
  let spanName;

  // used by each test
  let eventInfo;

  before(function () {
    ao.probes.fs.enabled = false;
    if (ao.lastEvent) {
      ao.loggers.debug(`resetting request store due to ${ao.lastEvent}`);
      ao.resetTContext();
    }
  })

  before(function () {
    // the test transport must be an emitter.
    testTransport.addListener('test-log', function (info, ...rest) {
      if (major === 3) {
        eventInfo = stripSymbols(info);
      } else if (major === 2) {
        eventInfo = [info, ...rest];
      } else if (major === 1) {
        eventInfo = [info, ...rest];
      }
    })
  })

  beforeEach(function () {
    // provide unique spans for up to 100 tests
    pfx = ('0' + counter++).slice(-2);
    spanName = `${pfx}-test`;

    // the following are global to all tests so they can use a common
    // check function without having to declare their own transport to
    // capture the object being logged.
    eventInfo = undefined;
  })

  //
  // Intercept appoptics messages for analysis
  //
  beforeEach(function (done) {
    ao.sampleRate = ao.addon.MAX_SAMPLE_RATE
    ao.traceMode = 'always'
    ao.cfg.insertTraceIdsIntoLogs = true;

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

    it(`should ${maybe}insert in sync sampled code when mode=${mode}`, function (done) {
      const level = 'info';
      const message = 'property and synchronous';
      let traceId;

      ao.cfg.insertTraceIdsIntoLogs = mode;

      function localDone () {
        checkEventInfo(eventInfo, level, message, mode === false ? undefined : traceId);
        setImmediate(done);
      }

      helper.test(emitter, function (done) {
        ao.instrument(spanName, function () {
          traceId = getTraceIdString();
          logger.log(...makeLogArgs(level, message));
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
    eventInfo = undefined;

    it(`should ${maybe}insert in sync unsampled code when mode=${mode}`, function () {
      const level = 'error';
      const message = `unsampled mode = ${mode}`;
      let traceId;

      ao.cfg.insertTraceIdsIntoLogs = mode;
      ao.traceMode = 0;
      ao.sampleRate = 0;

      function test () {
        traceId = getTraceIdString();
        expect(traceId[traceId.length - 1] === 0, 'traceId should be unsampled');
        // log
        logger.log(...makeLogArgs(level, message));

        return 'test-done';
      }

      const xtrace = ao.MB.makeRandom(0).toString()
      const result = ao.startOrContinueTrace(xtrace, spanName, test);

      expect(result).equal('test-done');
      checkEventInfo(eventInfo, level, message, maybe ? undefined : traceId);
    })
  })

  it('mode=\'always\' should always insert a trace ID even if not tracing', function () {
    const level = 'info';
    const message = 'always insert';

    ao.cfg.insertTraceIdsIntoLogs = 'always';

    logger.log(...makeLogArgs(level, message));

    checkEventInfo(eventInfo, level, message, `${'0'.repeat(40)}-0`);
  })

  it('should insert trace IDs in asynchronous instrumented code', function (done) {
    const level = 'error';
    const message = 'helper and asynchronous';
    let traceId;

    function localDone () {
      checkEventInfo(eventInfo, level, message, traceId);
      done();
    }

    function asyncFunction (cb) {
      traceId = getTraceIdString();
      logger.error(...makeHelperArgs(message));
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
    const message = 'property and promise';
    let traceId;
    const result = 99;

    function localDone () {
      checkEventInfo(eventInfo, level, message, traceId);
      done();
    }

    function promiseFunction () {
      traceId = getTraceIdString();
      logger.log(...makeLogArgs(level, message));
      return new Promise((resolve, reject) => {
        setTimeout(function () {
          resolve(result);
        }, 25);
      });
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
          logger.log(level, message, getTraceIdString());
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

