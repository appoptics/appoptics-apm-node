'use strict'

const helper = require('../../helper')
const ao = helper.ao
const fs = require('fs')
const should = require('should')

const domain = require('domain')

// To prevent the done call from continuing the context,
// the done callbacks must be triggered indirectly.
function indirectDone (done) {
  let stopped = false

  const t = setInterval(function () {
    if (stopped) {
      clearInterval(t)
      done()
    }
  }, 0)

  return {
    done: function () {
      stopped = true
    }
  }
}


module.exports = function (Promise) {
  function delay (n) {
    return new Promise(function (resolve) {
      setTimeout(resolve, n)
    })
  }

  it('should support promises via delay', function (done) {
    const t = indirectDone(done)
    ao.tContext.run(function () {

      ao.tContext.set('foo', 'bar')
      delay(100).then(function () {
        return delay(100)
      }).then(function () {
        ao.tContext.get('foo').should.equal('bar')
        t.done()
      }).catch(e => {
        // this shouldn't happen so check that it doesn't.
        should.notExist(e)
        t.done()
      })
    })
  })

  it('should support promises via fs.readFile', function (done) {
    const t = indirectDone(done)
    ao.tContext.run(function () {

      ao.tContext.set('foo', 'bar')
      const p = new Promise(function (resolve, reject) {
        fs.readFile('./package.json', 'utf8', function (err, data) {
          if (err) {
            reject(err)
          } else {
            resolve(data)
          }
        })
      })
      p.then(function () {
        ao.tContext.get('foo').should.equal('bar')
        t.done()
      }).catch(e => {
        should.notExist(e)
      })
    })
  })

  it('should support promises in domains', function (done) {
    const t = indirectDone(done)
    const d = domain.create()
    d.on('error', done)
    d.run(function () {
      ao.tContext.run(function () {

        ao.tContext.set('foo', 'bar')
        delay(100).then(function () {
          const foo = ao.tContext.get('foo')
          should.exist(foo)
          foo.should.equal('bar')
          t.done()
        }, done)
      })
    })
  })

  it('should not interfere with untraced promises', function (done) {
    const t = indirectDone(done)
    delay(100).then(function () {
      t.done()
    }, done)
  })

  it('should support progress callbacks', function (done) {
    const t = indirectDone(done)
    ao.tContext.run(function () {

      ao.tContext.set('foo', 'bar')
      delay(100).then(function () {
        t.done()
      }, done, function () {})
    })
  })
}
