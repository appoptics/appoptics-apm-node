'use strict'

const helper = require('../helper')
const {ao} = require('../1.test-common')


const noop = helper.noop
const conf = ao.probes.pg

const extend = Object.assign

const postgres = require('pg')
const pkg = require('pg/package')

const env = process.env
const addr = helper.Address.from(env.AO_TEST_POSTGRES || 'postgres:5432')[0]
// using a null password is valid.
const password = 'AO_TEST_POSTGRES_PASSWORD' in env ? env.AO_TEST_POSTGRES_PASSWORD : 'xyzzy'

const tName = 'tbl' + (env.AO_IX ? env.AO_IX : '')

const auth = {
  user: env.AO_TEST_POSTGRES_USERNAME || 'postgres',
  password: password,
  host: addr.host,
  port: addr.port,
  database: 'test',
}

const stream = require('stream')
let canNative = typeof stream.Duplex !== 'undefined'

if (canNative) {
  try {
    require('pg/lib/native')
  } catch (e) {
    ao.loggers.test.info('pg/lib/native not available')
    canNative = false
  }
}

describe('probes.pg ' + pkg.version, function () {
  let emitter

  it('should sanitize SQL by default', function () {
    conf.should.have.property('sanitizeSql', true)
    conf.sanitizeSql = false
  })

  //
  // Intercept appoptics messages for analysis
  //
  before(function (done) {
    emitter = helper.appoptics(done)
    ao.sampleRate = ao.addon.MAX_SAMPLE_RATE
    ao.traceMode = 'always'
    ao.probes.fs.enabled = false
    ao.g.testing(__filename)
  })
  after(function (done) {
    ao.probes.fs.enabled = true
    emitter.close(done)
  })

  before(function (done) {
    this.timeout(10000)
    const tmpAuth = extend(extend({}, auth), {database: 'postgres'})
    const client = new postgres.Client(tmpAuth)
    client.connect(function (err) {
      if (err) return done(err)
      client.query('create database test;', function () {
        client.end()
        done()
      })
    })
  })

  //
  // Yes, this is super janky. But necessary because switching to
  // the native driver is destructive to the pooling mechanism.
  //
  // The postgres.native property must NOT be accessed
  // until the before() step of that test collection.
  //
  const drivers = {
    javascript: {
      skip: false,
      get: function () {
        return postgres
      }
    },
    native: {
      // Only test the native driver when Duplex streams are available,
      // otherwise node 0.8 will crash while trying to load pg-native
      skip: !canNative,
      get: function () {
        return postgres.native
      }
    }
  }

  //
  // Test against both native and js postgres drivers
  //
  Object.keys(drivers).forEach(function (type) {
    const ctx = {ao, tName}
    let pg
    let db

    const checks = {
      entry: function (msg) {
        msg.should.have.property('Layer', 'postgres')
        msg.should.have.property('Label', 'entry')
        msg.should.have.property('Database', 'test')
        msg.should.have.property('Flavor', 'postgresql')
        msg.should.have.property('RemoteHost', addr.toString())
      },
      exit: function (msg) {
        msg.should.have.property('Layer', 'postgres')
        msg.should.have.property('Label', 'exit')
      }
    }

    const driver = drivers[type]
    if (driver.skip) {
      describe.skip(type, test)
    } else {
      describe(type, test)
    }

    function test () {
      before(function (done) {
        this.timeout(10000)
        ctx.pg = pg = driver.get()
        pg.address = auth
        const client = new pg.Client(auth)

        client.connect(function (err) {
          if (err) return done(err)
          pg.db = db = client
          ctx.pg = pg
          done()
        })
      })

      before(function (done) {
        pg.db.query(`CREATE TABLE IF NOT EXISTS ${tName} (foo TEXT)`, done)
      })

      after(function () {
        db.end()
      })

      // fake test to work around UDP dropped message issue
      it('UDP might lose a message', function (done) {
        helper.test(emitter, function (done) {
          ao.instrument('fake', noop)
          done()
        }, [
          function (msg) {
            msg.should.have.property('Label').oneOf('entry', 'exit'),
            msg.should.have.property('Layer', 'fake')
          }
        ], done)
      })

      it('should trace a basic query', function (done) {
        helper.test(emitter, helper.run(ctx, 'pg/basic'), [
          function (msg) {
            checks.entry(msg)
            msg.should.have.property('Query', 'SELECT $1::int AS number')
            msg.should.have.property('QueryArgs', '["1"]')
          },
          function (msg) {
            checks.exit(msg)
          }
        ], done)
      })

      it('should trace through a connection pool', function (done) {
        helper.test(emitter, helper.run(ctx, 'pg/pool'), [
          function (msg) {
            checks.entry(msg)
            msg.should.have.property('Query', 'SELECT $1::int AS number')
            msg.should.have.property('QueryArgs', '["1"]')
          },
          function (msg) {
            checks.exit(msg)
          }
        ], done)
      })

      it('should trace prepared statements', function (done) {
        helper.test(emitter, helper.run(ctx, 'pg/prepared'), [
          function (msg) {
            checks.entry(msg)
            msg.should.have.property('Query', 'SELECT $1::int AS number')
            msg.should.have.property('QueryArgs', '["1"]')
          },
          function (msg) {
            checks.exit(msg)
          },
          function (msg) {
            checks.entry(msg)
            msg.should.have.property('Query', 'SELECT $1::int AS number')
            msg.should.have.property('QueryArgs', '["2"]')
          },
          function (msg) {
            checks.exit(msg)
          }
        ], done)
      })

      it('should sanitize query string, when not using value list', function (done) {
        helper.test(emitter, helper.run(ctx, 'pg/sanitize'), [
          function (msg) {
            checks.entry(msg)
            msg.should.have.property('Query', `select * from "${tName}" where "key" = '?'`)
          },
          function (msg) {
            checks.exit(msg)
          }
        ], done)
      })

      it('should trace evented style', function (done) {
        helper.test(emitter, helper.run(ctx, 'pg/evented'), [
          function (msg) {
            checks.entry(msg)
            msg.should.have.property('Query', `select * from "${tName}" where "foo" = 'bar'`)
          },
          function (msg) {
            checks.exit(msg)
          }
        ], done)
      })

      it('should trim long queries', function (done) {
        helper.test(emitter, function (done) {
          const nums = []
          for (let i = 0; i < 1000; i++) {
            nums.push('1::int AS number')
          }
          const query = 'SELECT ' + nums.join(', ')
          db.query(query, function (err) {
            done(err)
          })
        }, [
          function (msg) {
            checks.entry(msg)
            msg.should.have.property('Query')
            msg.Query.length.should.not.be.above(2048)
          },
          function (msg) {
            checks.exit(msg)
          }
        ], done)
      })

      it('should skip when disabled', function (done) {
        ao.probes.pg.enabled = false
        helper.test(emitter, helper.run(ctx, 'pg/basic'), [], function (err) {
          ao.probes.pg.enabled = true
          done(err)
        })
      })
    }
  })

})
