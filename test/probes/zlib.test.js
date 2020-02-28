'use strict'

const helper = require('../helper')
const {ao} = require('../1.test-common.js')
const noop = helper.noop
const once = require('../../lib/utility').once;

const concat = require('concat-stream')
const zlib = require('zlib')

const expect = require('chai').expect;

const semver = require('semver');

const classes = [
  'Deflate',
  'Inflate',
  'Gzip',
  'Gunzip',
  'DeflateRaw',
  'InflateRaw',
  'Unzip'
]

const methods = [
  'deflate',
  'deflateRaw',
  'gzip',
  'gunzip',
  'inflate',
  'inflateRaw',
  'unzip'
]

if (semver.gte(process.version, '11.7.0')) {
  classes.push('BrotliCompress');
  classes.push('BrotliDecompress');
  methods.push('brotliCompress');
  methods.push('brotliDecompress');
}

describe('probes.zlib once', function () {
  let emitter

  //
  // Intercept appoptics messages for analysis
  //
  before(function (done) {
    emitter = helper.appoptics(done)
    ao.sampleRate = ao.addon.MAX_SAMPLE_RATE
    ao.traceMode = 'always'
  })
  after(function (done) {
    emitter.close(done)
  })

  // fake test to work around UDP dropped message issue
  it('UDP might lose a message', function (done) {
    helper.test(emitter, function (done) {
      ao.instrument('fake', noop)
      done ()
    }, [
      function (msg) {
        msg.should.have.property('Label').oneOf('entry', 'exit'),
        msg.should.have.property('Layer', 'fake')
      }
    ], done)
  })
})

describe('probes.zlib', function () {
  const options = {chunkSize: 1024}
  let emitter

  //
  // Intercept appoptics messages for analysis
  //
  before(function (done) {
    emitter = helper.appoptics(done)
    ao.sampleRate = ao.addon.MAX_SAMPLE_RATE
    ao.traceMode = 'always'
  })
  after(function (done) {
    emitter.close(done)
  })

  const checks = {
    entry: function (msg) {
      msg.should.have.property('Layer', 'zlib')
      msg.should.have.property('Label', 'entry')
    },
    exit: function (msg) {
      msg.should.have.property('Layer', 'zlib')
      msg.should.have.property('Label', 'exit')
    }
  }

  function upperFirst (str) {
    return str[0].toUpperCase() + str.slice(1)
  }

  //
  // Prepare input and output values
  //
  const test = new Buffer('test')
  const inputs = {}
  const outputs = {}

  // Deflate/Inflate
  before(function (done) {
    inputs.Deflate = test
    outputs.Inflate = test
    zlib.deflate(test, function (err, res) {
      if (err) return done(err)
      inputs.Inflate = res
      outputs.Deflate = res
      done()
    })
  })

  // DeflateRaw/InflateRaw
  before(function (done) {
    inputs.DeflateRaw = test
    outputs.InflateRaw = test
    zlib.deflateRaw(test, function (err, res) {
      if (err) return done(err)
      inputs.InflateRaw = res
      outputs.DeflateRaw = res
      done()
    })
  })

  // Gzip/Gunzip
  before(function (done) {
    inputs.Gzip = test
    outputs.Gunzip = test
    outputs.Unzip = test
    zlib.gzip(test, function (err, res) {
      if (err) return done(err)
      inputs.Gunzip = res
      inputs.Unzip = res
      outputs.Gzip = res
      done()
    })
  })

  // Brotli
  before(function (done) {
    if (semver.lt(process.version, '11.7.0')) {
      done();
      return;
    }
    inputs.BrotliCompress = test;
    outputs.BrotliDecompress = test;
    zlib.brotliCompress(test, function (err, res) {
      if (err) return done(err);
      inputs.BrotliDecompress = res;
      outputs.BrotliCompress = res;
      done();
    })
  })

  //
  // Tests
  //
  describe('async', function () {
    methods.forEach(function (method) {
      const className = upperFirst(method)

      it(`should support ${method}`, function (done) {
        // make sure the function exists
        expect(zlib).property(method);
        expect(typeof zlib[method]).equal('function');
        // run the test
        helper.test(emitter, function (done) {
          zlib[method](inputs[className], function (err, buf) {
            if (err) return done(err)
            buf.toString().should.equal(outputs[className].toString())
            done()
          })
        }, [
          function (msg) {
            checks.entry(msg)
            msg.should.have.property('Operation', method)
            msg.should.have.property('Async', true)
          },
          function (msg) {
            checks.exit(msg)
          }
        ], done)
      })
    })
  })

  describe('sync', function () {
    methods.forEach(function (method) {
      const className = upperFirst(method)
      const syncMethod = method + 'Sync'
      it(`should support ${syncMethod}`, function (done) {
        // make sure the function exists
        expect(zlib).property(syncMethod);
        expect(typeof zlib[syncMethod]).equal('function');
        // test
        helper.test(emitter, function (done) {
          try {
            const buf = zlib[syncMethod](inputs[className])
            buf.toString().should.equal(outputs[className].toString())
          } catch (e) {}
          process.nextTick(done)
        }, [
          function (msg) {
            checks.entry(msg)
            msg.should.have.property('Operation', syncMethod)
            msg.should.not.have.property('Async')
          },
          function (msg) {
            checks.exit(msg)
          }
        ], done)
      })
    })
  })

  describe('classes', function () {
    classes.forEach(function (name) {
      it(`should support ${name}`, function (done) {
        // make sure the function exists
        expect(zlib).property(name);
        expect(typeof zlib[name]).equal('function');
        // test
        helper.test(emitter, function (done) {
          const inst = new (zlib[name])(options)
          inst.should.be.an.instanceOf(zlib[name])

          const oneDone = once(function () {
            process.nextTick(done);
          })

          inst.on('error', done)
          inst.on('close', oneDone);
          inst.on('end', oneDone);

          inst.pipe(concat(function (buf) {
            buf.toString().should.equal(outputs[name].toString())
          }))

          inst.write(inputs[name])
          inst.end()
        }, [
          function (msg) {
            checks.entry(msg)
            msg.should.have.property('Options', JSON.stringify(options))
            msg.should.have.property('Operation', name)
            msg.should.have.property('Async', true)
          },
          function (msg) {
            checks.exit(msg)
          }
        ], done)
      })
    })
  })

  describe('creators', function () {
    classes.forEach(function (name) {
      const creator = 'create' + name;
      it(`should support ${creator}`, function (done) {
        // make sure the function exists
        expect(zlib).property(name);
        expect(typeof zlib[name]).equal('function');
        // test
        helper.test(emitter, function (done) {
          const inst = new zlib[creator](options)
          inst.should.be.an.instanceOf(zlib[name])

          const oneDone = once(function () {
            process.nextTick(done);
          })

          inst.on('error', done)
          inst.on('close', oneDone);
          inst.on('end', oneDone);

          inst.pipe(concat(function (buf) {
            buf.toString().should.equal(outputs[name].toString())
          }))

          inst.write(inputs[name])
          inst.end()
        }, [
          function (msg) {
            checks.entry(msg)
            msg.should.have.property('Options', JSON.stringify(options))
            msg.should.have.property('Operation', name)
            msg.should.have.property('Async', true)
          },
          function (msg) {
            checks.exit(msg)
          }
        ], done)
      })
    })
  })

  it('should support report errors', function (done) {
    helper.test(emitter, function (done) {
      function after () {
        done()
      }

      const inst = new zlib.Gunzip(options)
      inst.on('error', after)
      inst.on('close', after)
      inst.on('end', after)
      inst.write('nope')
      inst.end()
    }, [
      function (msg) {
        checks.entry(msg)
        msg.should.have.property('Operation', 'Gunzip')
      },
      function (msg) {
        checks.exit(msg)
        msg.should.have.property('ErrorMsg')
        msg.should.have.property('ErrorMsg', 'incorrect header check')
      }
    ], done)
  })

})
