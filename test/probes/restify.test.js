'use strict'

const helper = require('../helper')
const {ao} = require('../1.test-common')

const expect = require('chai').expect
const semver = require('semver')

const request = require('request')

const pkg = require('restify/package.json')
const opts = {
  name: 'restify-test'
}

if (!semver.satisfies(process.version, '>=4')) {
  describe('probes.restify', function () {
    it.skip('not supported for node version < 4', function () {})
  })
  describe = function () {}
}

const restify = require('restify')

// restify does fs IO starting in node 8
if (semver.satisfies(process.version, '>=8.0.0')) {
  ao.loggers.debug('turning off fs instrumentation')
  ao.probes.fs.enabled = false
}

describe(`probes.restify ${pkg.version}`, function () {
  let emitter
  let fsState
  let previousTraces;

  //
  // Intercept appoptics messages for analysis
  //
  before(function (done) {
    emitter = helper.appoptics(done)
    ao.sampleRate = ao.addon.MAX_SAMPLE_RATE
    ao.traceMode = 'always'
    // restify newer versions of restify use negotiator which does file io
    fsState = ao.probes.fs.enabled
    ao.probes.fs.enabled = false
    previousTraces = ao.probes.restify.collectBacktraces;
    ao.probes.restify.collectBacktraces = false;
    ao.g.testing(__filename)
  })
  after(function (done) {
    emitter.close(done)
    // turn on if desired for testing context
    if (false && ao.tContext.getMetrics) {
      process.on('exit', function () {
        ao.tContext._hook.disable();
        interpretMetrics(ao.tContext.getMetrics());
      })
    }
    ao.probes.fs.enabled = fsState
    ao.probes.restify.collectBacktraces = previousTraces;
  })

  const check = {
    'http-entry': function (msg) {
      expect(msg).property('Layer', 'nodejs')
      expect(msg).property('Label', 'entry')
    },
    'http-exit': function (msg) {
      expect(msg).property('Layer', 'nodejs')
      expect(msg).property('Label', 'exit')
    },
    'restify-entry': function (msg) {
      expect(msg).include({Layer: 'restify', Label: 'entry'})
    },
    'restify-exit': function (msg) {
      expect(msg).include({Layer: 'restify', Label: 'exit'})
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
        expect(msg).property('Label').oneOf(['entry', 'exit']),
        expect(msg).property('Layer', 'fake')
      }
    ], done)
  })

  //
  // Tests
  //
  function testControllerAction (done) {
    const app = restify.createServer(opts)

    app.get('/hello/:name', function hello (req, res) {
      res.send('done')
    })

    const validations = [
      function (msg) {
        check['http-entry'](msg)
      },
      function (msg) {
        check['restify-entry'](msg)
      },
      function (msg) {
        expect(msg).property('Layer', 'restify-route')
        expect(msg).property('Label', 'entry')
      },
      function (msg) {
        expect(msg).property('Layer', 'restify-route')
        expect(msg).property('Label', 'exit')
      },
      function (msg) {
        check['restify-exit'](msg)
      },
      function (msg) {
        check['http-exit'](msg)
        expect(msg).property('Controller', 'GET /hello/:name')
        expect(msg).property('Action', 'hello')
      }
    ]
    helper.doChecks(emitter, validations, function () {
      server.close(done);
      server.removeAllListeners('request');
    })

    const server = app.listen(function () {
      const port = server.address().port
      request('http://localhost:' + port + '/hello/world')
    })
  }

  function testMiddleware (done) {
    const app = restify.createServer(opts);

    app.get('/hello/:name', function renamer (req, res, next) {
      req.name = req.params.name
      next()
    }, function responder (req, res) {
      res.send(req.name)
    })

    const validations = [
      function (msg) {
        check['http-entry'](msg)
      },
      function (msg) {
        check['restify-entry'](msg)
      },
      function (msg) {
        expect(msg).include({Layer: 'restify-route', Label: 'entry'})
        expect(msg).property('Controller', 'GET /hello/:name')
        expect(msg).property('Action', 'renamer')
      },
      function (msg) {
        expect(msg).include({Layer: 'restify-route', Label: 'exit'})
      },
      function (msg) {
        expect(msg).include({Layer: 'restify-route', Label: 'entry'})
        expect(msg).property('Controller', 'GET /hello/:name')
        expect(msg).property('Action', 'responder')
      },
      function (msg) {
        expect(msg).include({Layer: 'restify-route', Label: 'exit'})
      },
      function (msg) {
        check['restify-exit'](msg)
      },
      function (msg) {
        check['http-exit'](msg)
      }
    ]
    helper.doChecks(emitter, validations, function () {
      server.close(done);
      server.removeAllListeners('request');
    })

    const server = app.listen(function () {
      const port = server.address().port
      request('http://localhost:' + port + '/hello/world')
    })
  }

  if (semver.gte(process.version, '6.0.0')) {
    it('should forward controller/action', testControllerAction)
    it('should create a span for each middleware', testMiddleware)
  } else {
    it.skip('should forward controller/action', testControllerAction)
    it.skip('should create a span for each middleware', testMiddleware)
  }
})

function interpretMetrics (metrics) {
  const hooks = metrics.hooks;
  const asyncIds = Reflect.ownKeys(metrics.hooks);
  let firstNonBootstrapId = asyncIds[asyncIds.length - 1];

  function log (...args) {
    /* eslint-disable-next-line no-console */
    console.log(...args);
  }

  // find the first non-bootstrap ID
  for (let i = 0; i < asyncIds.length; i++) {
    if (!hooks[asyncIds[i]].bootstrap) {
      firstNonBootstrapId = asyncIds[i];
      break;
    }
  }
  const s = metrics.stats;
  log('metrics.stats');
  log(`  fast ${s.fastExits} slow ${s.slowExits}`);
  log(`  maxSetLength: ${s.maxSetLength}`);
  log('  first non-bootstrap ID', firstNonBootstrapId);
  log(`  total contexts created ${s.totalContextsCreated} active: ${s.activeContexts}`);
  const ee = `enters ${s.rootContextSwitchEnters} exits ${s.rootContextSwitchExits}`;
  log(`  root context switches ${s.rootContextSwitches} ${ee}`);
  log('  active counts', s.activeCounts);
  log(`  i ${s.inits} b ${s.befores} a ${s.afters} d ${s.destroys}`);

  // are any missing inits from non-bootstrap asyncIds?
  ['beforeNoInit', 'afterNoInit', 'destroyNoInit'].forEach(error => {
    const bad = metrics.errors[error].filter(asyncId => asyncId >= firstNonBootstrapId);
    if (bad.length) {
      log(`non-bootstrap ${error} ${bad}`);
    }
  });

  const odd = asyncIds.filter(id => {
    const info = hooks[id];
    return !info.bootstrap && (info.befores !== info.afters || info.inits !== info.destroys);
  });

  if (odd.length) {
    log('asymmetric pairings');
    odd.forEach(id => {
      const short = {
        t: hooks[id].type,
        i: hooks[id].inits,
        b: hooks[id].befores,
        a: hooks[id].afters,
        d: hooks[id].destroys,
        tid: hooks[id].triggerId,
        eaID: hooks[id].eaID,
      }
      log(id, short);
    })
  }

  log(JSON.stringify(metrics.hooks));
}
