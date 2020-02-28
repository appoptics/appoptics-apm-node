'use strict'

const helper = require('../helper')
const {ao} = require('../1.test-common')

const log = ao.loggers

let oracledb
let pkg = {version: '0.0.0'}
try {
  oracledb = require('oracledb')
  pkg = require('oracledb/package')
} catch (e) {
  log.debug('cannot load oracledb', e)
}

const host = process.env.AO_TEST_ORACLE || 'oracle'
const database = process.env.AO_TEST_ORACLE_DBNAME || 'xe'
const config = {
  user: process.env.AO_TEST_ORACLE_USERNAME || 'system',
  password: process.env.AO_TEST_ORACLE_PASSWORD || 'oracle',
  connectString: host + '/' + database,
}
let descValid = describe.skip;

if (oracledb && host && database && config.user && config.password) {
  descValid = describe;
}

descValid(`probes.oracledb ${pkg.version}`, function () {
  let emitter
  let lastConnection;

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

  afterEach(function () {
    if (!lastConnection) {
      return Promise.resolve();
    }
    return lastConnection.close();
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

  const checks = {
    'oracle-entry': function (msg) {
      msg.should.have.property('Layer', 'oracle')
      msg.should.have.property('Label', 'entry')
      msg.should.have.property('Database', database)
      msg.should.have.property('Flavor', 'oracle')
      msg.should.have.property('RemoteHost', host)
    },
    'oracle-exit': function (msg) {
      msg.should.have.property('Layer', 'oracle')
      msg.should.have.property('Label', 'exit')
    }
  }

  if (oracledb && host && database && config.user && config.password) {
    it('should trace execute calls', test_basic)
    it('should trace execute calls in pool', test_pool)
    it('should include correct isAutoCommit value', test_commit)
  } else {
    let missing = {
      oracledb, host, database, user: config.user, password: config.password
    }
    for (const k in missing) {
      if (missing[k]) delete missing[k]
    }
    missing = Object.keys(missing)
    describe('skipping probes due to missing: ' + missing.join(', '), function () {
      it.skip('should trace execute calls', test_basic)
      it.skip('should trace execute calls in pool', test_pool)
      it.skip('should include correct isAutoCommit value', test_commit)
    })
  }

  function test_basic (done) {
    log.debug('asking helper to execute test_basic')
    helper.test(emitter, function (done) {
      function query (err, connection) {
        log.debug('test_basic query callback invoked')
        if (err) {
          log.debug('error in query callback', err);
          return done(err);
        }
        lastConnection = connection;
        connection.execute('SELECT 1 FROM DUAL', done)
      }
      log.debug('test_basic being executed')
      oracledb.getConnection(config, query)
      log.debug('done with test_basic oracledb.getConnection')
    }, [
      function (msg) {
        checks['oracle-entry'](msg)
        msg.should.have.property('Query', 'SELECT 1 FROM DUAL')
      },
      function (msg) {
        checks['oracle-exit'](msg)
      }
    ], done)
  }

  function test_pool (done) {
    helper.test(emitter, function (done) {
      function query (err, connection) {
        if (err) return done(err)
        lastConnection = connection;
        connection.execute('SELECT 1 FROM DUAL', done)
      }

      oracledb.createPool(config, function (err, pool) {
        if (err) return done(err)
        pool.getConnection(query)
      })
    }, [
      function (msg) {
        checks['oracle-entry'](msg)
        msg.should.have.property('Query', 'SELECT 1 FROM DUAL')
      },
      function (msg) {
        checks['oracle-exit'](msg)
      }
    ], done)
  }

  function test_commit (done) {
    helper.test(emitter, function (done) {
      oracledb.isAutoCommit = false
      oracledb.getConnection(config, function (err, connection) {
        function query (isAutoCommit, done) {
          const options = {
            isAutoCommit: isAutoCommit
          }

          return function (err) {
            if (err) return done(err)
            lastConnection = connection;
            connection.execute('SELECT 1 FROM DUAL', [], options, done)
          }
        }

        const fn = query(
          undefined,
          query(
            true,
            query(
              false,
              done
            )
          )
        )
        fn()
      })
    }, [
      function (msg) {
        checks['oracle-entry'](msg)
        msg.should.have.property('isAutoCommit', false)
      },
      function (msg) {
        checks['oracle-exit'](msg)
      },
      function (msg) {
        checks['oracle-entry'](msg)
        msg.should.have.property('isAutoCommit', true)
      },
      function (msg) {
        checks['oracle-exit'](msg)
      },
      function (msg) {
        checks['oracle-entry'](msg)
        msg.should.have.property('isAutoCommit', false)
      },
      function (msg) {
        checks['oracle-exit'](msg)
      }
    ], done)
  }

})
