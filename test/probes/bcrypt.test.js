'use strict'

const {ao, startTest, endTest} = require('../1.test-common.js')

const bcrypt = require('bcrypt')
const pkg = require('bcrypt/package')

describe('probes.bcrypt ' + pkg.version, function () {
  let prevll
  before(function () {
    startTest(__filename, {enable: false, customFormatter: 'terse'})
    prevll = ao.logLevel
    //ao.logLevelAdd('span')
  })
  after(function () {
    //ao.tContext.dumpCtx()

    endTest()
    ao.logLevel = prevll
  })

  it('should trace through async bcrypt', function (done) {
    const test = 'foo'
    const password = 'this is a test'

    process.env.DEBUG_CLS_HOOKED = 1

    ao.startOrContinueTrace(
      '',
      'test-bcrypt',
      function (cb) {
        ao.tContext.set(test, 'bar')
        bcrypt.genSalt(10, function (err, salt) {
          bcrypt.hash(password, salt, function (err, hash) {
            bcrypt.compare(password, hash, function (err, res) {
              // the passwords should match
              res.should.equal(true)
              const result = ao.tContext.get(test)
              // checking 'bar' against result prevents problems if
              // result is undefined.
              'bar'.should.equal(result, 'foo should equal bar')
              return cb()
            })
          })
        })
      },
      {enabled: true},
      function () {done()}
    )
  })
})
