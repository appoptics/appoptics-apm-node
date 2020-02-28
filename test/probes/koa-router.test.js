'use strict'

const helper = require('../helper')
const {ao} = require('../1.test-common.js')

const semver = require('semver')
const pkg = require('koa-router/package')

let canGenerator = false
try {
  eval('(function* () {})()')
  canGenerator = true
} catch (e) {
}

describe('probes/koa-router ' + pkg.version, function () {
  let emitter
  const tests = canGenerator && require('./koa')

  //
  // Intercept appoptics messages for analysis
  //
  before(function (done) {
    ao.probes.fs.enabled = false
    emitter = helper.appoptics(done)
    ao.sampleRate = ao.addon.MAX_SAMPLE_RATE
    ao.traceMode = 'always'

    ao.g.testing(__filename)
  })
  after(function (done) {
    ao.probes.fs.enabled = true
    emitter.close(done)
  })

  // this test exists only to fix a problem with oboe not reporting a UDP
  // send failure.
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

  //
  // Tests
  //
  const ifgen = canGenerator ? it : it.skip
  const if6 = semver.gte(pkg.version, '6.0.0') ? it : it.skip

  ifgen('should support koa-router controllers', function (done) {
    tests.router(emitter, done)
  })
  ifgen('should skip when disabled', function (done) {
    tests.router_disabled(emitter, done)
  })
  if6('should work with promises', function (done) {
    tests.router_promise(emitter, done)
  })

})
