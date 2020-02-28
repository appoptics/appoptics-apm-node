'use strict'

const semver = require('semver')
const expect = require('chai').expect;

const {ao} = require('../1.test-common')

const gpDebug = ao.logger.debug('appoptics:probe:generic-pool')
//ao.logger.addEnabled('probe:generic-pool');

const gp = require('generic-pool')

// execute tests conditionally depending on version
const pkg = require('generic-pool/package')
const v3 = semver.satisfies(pkg.version, '>= 3')
const ifv3 = v3 ? it : it.skip
const ifv2 = v3 ? it.skip : it
const nodeVersion = semver.major(process.version)

const hasAsync = nodeVersion >= 8

let n = 0
const max = 2

// v2 -> v3 migration guide.
// https://gist.github.com/sandfox/5ca20648b60a0cb959638c0cd6fcd02d
let pool
if (!v3) {
  // v2 signature
  pool = new gp.Pool({
    name: 'test',
    create: function (cb) {
      gpDebug(`pool create() called n=${n}`);
      if (n >= max) {
        cb('done')
      } else {
        n += 1
        cb(null, {bar: n})
      }
    },
    destroy: function (resource) {
      return;
    },
    max: 2,
    min: 2
  })
} else {
  // v3 signature
  const factory = {
    create: function () {
      gpDebug(`pool create() called n=${n}`);
      if (n >= max) {
        return Promise.reject()
      }
      n += 1
      return Promise.resolve({bar: n})
    },
    destroy: function (resource) {
      return Promise.resolve(true)
    }
  }
  const options = {
    max: 2,
    min: 2
  }
  pool = gp.createPool(factory, options)
}


describe(`probes.generic-pool ${pkg.version}`, function () {

  before(function () {
    ao.g.testing(__filename)
  })

  after(function () {
    ao.resetTContext();
  })

  ifv2('should trace through generic-pool acquire for versions < 3', function (testDone) {
    //
    // v2 uses callbacks
    //
    let okToRelease = false

    // each spanRunner acquires two resources (the maximum for the pool). the first
    // span runner should take both and releases one when the timer pops allowing the
    // second span runner to acquire it.
    function spanRunner (done) {
      gpDebug('%s spanRunner %e', ao.lastEvent.Layer, ao.lastEvent)

      // use taskId and layer name to verify that the correct context is maintained across calls
      const span = ao.lastEvent.Layer
      const taskId = ao.lastEvent.taskId
      expect(taskId).exist;
      ao.tContext.set('key', span)

      pool.acquire(function (err, resource) {
        if (err) {
          done(err)
          return
        }
        gpDebug('%s acquired(queue) %o for %e', span, resource, ao.lastEvent)

        expect(ao.lastEvent).exist;
        expect(ao.lastEvent).property('Layer', span);
        expect(ao.lastEvent).property('taskId', taskId);

        const t = setInterval(function () {
          if (okToRelease) {
            gpDebug('%s releasing %o by %e', span, resource, ao.lastEvent)

            expect(ao.lastEvent, 'context when releasing').exist;
            expect(ao.lastEvent).property('Layer', span);
            expect(ao.lastEvent).property('taskId', taskId);

            pool.release(resource)
            clearInterval(t)
          }
        }, 10)
      })

      pool.acquire(function (err, resource) {
        if (err) {
          done(err)
          return
        }
        gpDebug('%s acquired %o for %e', span, resource, ao.lastEvent)

        expect(ao.tContext.get('key')).equal(span);
        expect(ao.lastEvent, 'context when acquiring').exist;
        expect(ao.lastEvent).property('Layer', span);
        expect(ao.lastEvent).property('taskId', taskId);

        done()
      })
    }

    let count = 0
    let error;

    function bothDone (e) {
      count += 1
      // save only the first error
      if (!error) error = e;
      gpDebug(`bothDone count: ${count}`);
    }

    ao.startOrContinueTrace('', 'generic-pool-1', spanRunner, function (e) {gpDebug('gp-1'); bothDone(e)})
    ao.startOrContinueTrace('', 'generic-pool-2', spanRunner, function (e) {gpDebug('gp-2'); bothDone(e)})

    // wait until both traces are done.
    const t = setInterval(function () {
      if (count === 2 || error) {
        clearInterval(t);
        testDone(error);
      }
    }, 50);

    // now allow releasing the resources held by the generic-pool-1 span runner.
    okToRelease = true;
  })

  ifv3('should execute generic-pool without error whether patched or not', function (done) {

    function spanRunner (done) {
      pool.acquire().then(function (resource) {
        gpDebug('%s acquired(queue) %o for %e', ao.lastEvent.Layer, resource, ao.lastEvent)

        setTimeout(function () {
          gpDebug('releasing %o by %e', resource, ao.lastEvent)
          pool.release(resource)
          done()
        }, 10)
      }).catch(function (e) {
        done(e)
      })
    }

    ao.startOrContinueTrace('', 'generic-pool-x', spanRunner, function (e) {gpDebug('gp-x'); done(e)})

  })

  ifv3('should trace through generic-pool acquire for versions > 3', function (done) {
    //
    // v3 uses promises
    //
    let okToRelease = false

    function spanRunner (done) {
      gpDebug('%s spanRunner %e', ao.lastEvent.Layer, ao.lastEvent)

      // use taskId and layer name to verify that the correct context is maintained across calls
      const span = ao.lastEvent.Layer
      const taskId = ao.lastEvent.taskId
      expect(taskId).exist;
      ao.tContext.set('key', span)

      // acquire an entry in the pool and release it after an event loop interval.
      // this causes the the 'generic-pool-1' span to acquire both resources from the
      // pool and forces 'generic-pool-2' to wait until a resource is freed before its
      // promise is resolved.
      pool.acquire().then(function (resource) {
        gpDebug('%s acquired(queue) %o for %e', span, resource, ao.lastEvent)

        expect(ao.lastEvent).exist;
        expect(ao.lastEvent).property('Layer', span);
        expect(ao.lastEvent).property('taskId', taskId);

        const t = setInterval(function () {
          if (okToRelease) {
            gpDebug('releasing %o by %e', resource, ao.lastEvent)

            expect(ao.lastEvent).exist;
            expect(ao.lastEvent).property('Layer', span);
            expect(ao.lastEvent).property('taskId', taskId);

            pool.release(resource)
            clearInterval(t)
          }
        }, 10)
      }).catch(function (e) {
        done(e)
      })

      let acquire
      if (hasAsync) {
        // kind of ugly, but how else to get around JavaScript  < 8 issuing a
        // syntax error?
        eval('acquire = (async function () {return await pool.acquire()}).bind(pool)')
      } else {
        acquire = pool.acquire.bind(pool)
      }

      //
      // now get the second resource when it's available. it should be available
      // immediately for the first trace but the second trace will have to wait until
      // the interval timer pops.
      //
      acquire().then(function (resource) {
        gpDebug('%s acquired %o for %e', span, resource, ao.lastEvent)

        expect(ao.tContext.get('key')).equal(span);
        expect(ao.lastEvent).exist;
        expect(ao.lastEvent).property('Layer', span);
        expect(ao.lastEvent).property('taskId', taskId);

        done()
      }).catch(function (e) {
        done(e)
      })
    }

    let count = 0
    function bothDone (e) {
      count += 1
      if (count === 2 || e) {
        done(e)
      }
    }

    ao.startOrContinueTrace('', 'generic-pool-1', spanRunner, function (e) {gpDebug('gp-1'); bothDone(e)})
    ao.startOrContinueTrace('', 'generic-pool-2', spanRunner, function (e) {gpDebug('gp-2'); bothDone(e)})

    okToRelease = true
  })
})
