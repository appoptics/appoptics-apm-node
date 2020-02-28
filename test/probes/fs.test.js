'use strict'

const helper = require('../helper')
const {ao} = require('../1.test-common')
const expect = require('chai').expect;

const noop = helper.noop

const semver = require('semver')
const path = require('path')
const fs = require('fs')
ao.probes.fs.collectBacktraces = false

describe('probes.fs once', function () {
  let emitter

  //
  // Intercept appoptics messages for analysis
  //
  before(function (done) {
    ao.sampleRate = ao.addon.MAX_SAMPLE_RATE
    ao.traceMode = 'always'
    emitter = helper.appoptics(done)
    ao.g.testing(__filename)
  })
  after(function (done) {
    emitter.close(done)
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
})

describe('probes.fs', function () {
  let emitter
  let mode

  beforeEach(function (done) {
    // wait a tenth of a second between tests.
    //setTimeout(function () {
    //  done()
    //}, 100)
    done()
  })

  //
  // Define some general message checks
  //
  const checks = {
    entry: function (msg) {
      const explicit = `${msg.Layer}:${msg.Label}`;
      expect(explicit).equal('fs:entry', 'Layer and Label must match');
    },
    exit: function (msg) {
      const explicit = `${msg.Layer}:${msg.Label}`;
      expect(explicit).equal('fs:exit', 'Layer and Label must match');
    }
  }

  function entry (name) {
    name = mode === 'sync' ? name + 'Sync' : name
    // If a requested op does not exist yet, create it
    if (!checks[name + '-entry']) {
      checks[name + '-entry'] = function (msg) {
        checks.entry(msg)
        msg.should.have.property('Operation', name)
      }
      checks[name + '-entry'].realName = name
      checks[name + '-exit'] = function (msg) {
        checks.exit(msg)
      }
      checks[name + '-exit'].realName = name
    }
    return checks[name + '-entry']
  }
  function exit (name) {
    name = mode === 'sync' ? name + 'Sync' : name
    return checks[name + '-exit']
  }
  function span (name) {
    return [entry(name), exit(name)]
  }

  function result (v) {
    return typeof v === 'function' ? v() : v
  }

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

  const resolved = path.resolve('fs-output/foo.bar.link')
  let fd

  //
  // This describes the inputs and behaviour of each function
  //
  const calls = [
    // fs.mkdir
    {
      type: 'path',
      name: 'mkdir',
      args: ['fs-output']
    },
    // fs.readdir
    {
      type: 'path',
      name: 'readdir',
      args: ['fs-output']
    },
    // fs.exists
    {
      type: 'path',
      name: 'exists',
      args: ['fs-output/foo.bar'],
      subs: function () {
        // node changed exists so it calls fs.access. It might have changed
        // before 10 but we're only supporting LTS versions.
        if (semver.lt(process.version, '10.0.0')) {
          return undefined
        }
        // and now it doesn't call fs.access again.
        if (semver.gt(process.version, '10.15.0') && mode === 'sync') {
          return undefined
        }

        return [span('access')]
      }
    },
    // fs.access
    {
      type: 'path',
      name: 'access',
      args: ['fs-output/foo.bar'],
      exclude: function () {
        return typeof fs['access' + (mode === 'sync' ? 'Sync' : '')] !== 'function'
      }
    },
    // fs.writeFile
    {
      type: 'path',
      name: 'writeFile',
      args: ['fs-output/foo.bar', 'some data'],
      subs: function () {
        return [span('open'), span('write'), span('close')]
      }
    },
    // fs.readFile
    {
      type: 'path',
      name: 'readFile',
      args: ['fs-output/foo.bar'],
      subs: function () {
        // 6.0.0-rc.* does not satisfy >1.0.0? WAT?
        const v = process.versions.node.split('-').shift()
        if (semver.satisfies(v, '>1.0.0', true) && mode !== 'sync') {
          return []
        }
        // node changed readFile so there is no call to fstat
        // between versions 6 and 8.
        const expected = [span('open')]
        if (semver.satisfies(v, '<8.0.0')) {
          expected.push(span('fstat'))
        }
        return expected.concat([span('read'), span('close')])
      }
    },
    // fs.truncate
    {
      type: 'path',
      name: 'truncate',
      args: ['fs-output/foo.bar', 0],
      subs: function () {
        if (mode === 'sync') {
          return [span('open'), span('ftruncate'), span('close')]
        } else {
          const expected = [span('open')]
          // when using continuation-local-storage the 'close' span
          // doesn't appear.
          if (ao.contextProvider !== 'continuation-local-storage') {
            expected.push(span('close'))
          }
          return expected
        }
      }
    },
    // fs.appendFile
    {
      type: 'path',
      name: 'appendFile',
      args: ['fs-output/foo.bar', 'some data'],
      subs: function () {
        return [entry('writeFile'), span('open'), span('write'), span('close'), exit('writeFile')]
      }
    },
    // fs.stat
    {
      type: 'path',
      name: 'stat',
      args: ['fs-output/foo.bar']
    },
    // fs.chown
    {
      type: 'path',
      name: 'chown',
      args: ['fs-output/foo.bar', process.getuid(), process.getgid()]
    },
    // fs.chmod
    {
      type: 'path',
      name: 'chmod',
      args: ['fs-output/foo.bar', 0o777]
    },
    // fs.utimes
    {
      type: 'path',
      name: 'utimes',
      args: ['fs-output/foo.bar', Date.now(), Date.now()]
    },
    // fs.symlink
    {
      type: 'link',
      name: 'symlink',
      args: function () {
        // reversed arguments for sync vs. async
        if (mode === 'sync') {
          return ['fs-output/foo.bar', 'fs-output/foo.bar.symlink']
        }
        return ['fs-output/foo.bar.symlink', 'fs-output/foo.bar']
      }
    },
    // fs.link
    {
      type: 'link',
      name: 'link',
      args: function () {
        // reversed arguments for sync vs. async
        if (mode === 'sync') {
          return ['fs-output/foo.bar', 'fs-output/foo.bar.link']
        }
        return ['fs-output/foo.bar.link', 'fs-output/foo.bar']
      }
    },
    // fs.readlink
    {
      type: 'path',
      name: 'readlink',
      args: ['fs-output/foo.bar.symlink']
    },
    // fs.realpath
    {
      type: 'path',
      name: 'realpath',
      args: ['fs-output/foo.bar.link'],
      log: false,
      // realpath does an lstat at each for every element of the path prior to
      // version 6 and after 6.3, except between 6.3.x and 8 the sync version does
      // not call lstat at all (https://github.com/nodejs/node/commit/71097744b2)
      subs: function () {
        const v = process.versions.node.split('-').shift()
        if (semver.satisfies(v, '>=8') && mode === 'sync') {
          return []
        }
        if (semver.satisfies(v, '<6') || semver.satisfies(v, '>6.3')) {
          return resolved.split('/').slice(1).map(function () {return span('lstat')})
        }
        return []
      }
    },
    // fs.lstat
    {
      type: 'path',
      name: 'lstat',
      args: ['fs-output/foo.bar.link']
    },
    // fs.rename
    {
      type: 'link',
      name: 'rename',
      args: ['fs-output/foo.bar.link', 'fs-output/foo.bar.link.renamed']
    },
    // fs.open
    {
      type: 'path',
      name: 'open',
      args: ['fs-output/foo.bar', 'w+'],
      after: function (err, _fd) {
        fd = _fd
      }
    },
    // fs.ftruncate
    {
      type: 'fd',
      name: 'ftruncate',
      args: function () { return [fd] }
    },
    // fs.fchown
    {
      type: 'fd',
      name: 'fchown',
      args: function () { return [fd, process.getuid(), process.getgid()] }
    },
    // fs.fchmod
    {
      type: 'fd',
      name: 'fchmod',
      args: function () { return [fd, 0o777] }
    },
    // fs.fstat
    {
      type: 'fd',
      name: 'fstat',
      args: function () { return [fd] }
    },
    // fs.futimes
    {
      type: 'fd',
      name: 'futimes',
      args: function () { return [fd, Date.now(), Date.now()] }
    },
    // fs.fsync
    {
      type: 'fd',
      name: 'fsync',
      args: function () { return [fd] }
    },
    // fs.write
    {
      type: 'fd',
      name: 'write',
      args: function () {
        const buf = Buffer.from('some data')
        return [fd, buf, 0, 'some data'.length, 0]
      }
      // args: function () { return [fd, 'some data'] }
    },
    // fs.read
    {
      type: 'fd',
      name: 'read',
      args: function () {
        const buf = Buffer.alloc('some data'.length)
        return [fd, buf, 0, 'some data'.length, 0]
      }
    },
    // fs.close
    {
      type: 'fd',
      name: 'close',
      args: function () { return [fd] }
    },
    // fs.unlink
    {
      type: 'path',
      name: 'unlink',
      args: ['fs-output/foo.bar']
    },
    // fs.access
    {
      type: 'path',
      name: 'rmdir',
      args: ['fs-output'],
      before: function () {
        // Need to clean up our linking mess before removing the directory
        try {
          fs.unlinkSync('fs-output/foo.bar.symlink')
          fs.unlinkSync('fs-output/foo.bar.link.renamed')
        } catch (e) {}
      }
    }
  ]

  describe('async', function () {

    calls.forEach(function (call) {
      if (result(call.exclude)) {
        return
      }

      it('should support ' + call.name, function (done) {
        const args = result(call.args)
        emitter.log = call.log

        // First step is to expect the message for the operation we are making
        const steps = [
          function (msg) {
            checks.entry(msg)
            msg.should.have.property('Operation', call.name);
            if (call.type === 'path') {
              msg.should.have.property('FilePath', args[0]);
            } else if (call.type === 'fd') {
              msg.should.have.property('FileDescriptor', args[0]);
            }
          }
        ]

        // Include checks for all expected sub-spans
        function add (step) {
          steps.push(step)
        }

        const subs = result(call.subs)
        if (Array.isArray(subs)) {
          subs.forEach(function (sub) {
            if (Array.isArray(sub)) {
              sub.forEach(add)
            } else {
              add(sub)
            }
          })
        }

        // Push the exit check
        steps.push(function (msg) {
          checks.exit(msg);
          if (call.name === 'open') {
            msg.should.have.property('FileDescriptor');
          }
        })

        // Before starting test, run any required tasks
        if (call.before) call.before()

        helper.test(emitter, function (done) {
          // Make call and pass callback args to after handler, if present
          fs[call.name].apply(fs, args.concat(function () {
            if (call.after) call.after.apply(this, arguments)
            done()
          }))
        }, steps, function (e) {
          emitter.log = false
          done(e)
        })
      })
    })

  })

  describe('sync', function () {

    // Turn on sync mode to adjust the call list values
    before(function () {
      mode = 'sync'
    })

    calls.forEach(function (call) {
      if (result(call.exclude)) return

      const name = call.name + 'Sync'

      it('should support ' + name, function (done) {
        const args = result(call.args)
        emitter.log = call.log

        // First step is to expect the message for the operation we are making
        const steps = [
          function (msg) {
            checks.entry(msg)
            msg.should.have.property('Operation', name)
            switch (call.type) {
              case 'path':
                msg.should.have.property('FilePath', args[0])
                break
            }
          }
        ]

        // Include checks for all expected sub-spans
        function add (step) {
          steps.push(step)
        }

        const subs = result(call.subs)
        if (Array.isArray(subs)) {
          subs.forEach(function (sub) {
            if (Array.isArray(sub)) {
              sub.forEach(add)
            } else {
              add(sub)
            }
          })
        }

        // Push the exit check
        steps.push(function (msg) {
          checks.exit(msg)
        })

        // Before starting test, run any required tasks
        if (call.before) call.before()

        helper.test(emitter, function (done) {
          /*
          if (name === 'realpathSync') {
            emitter.log = true
          }
          // */
          // Make call and pass result or error to after handler, if present
          try {
            const res = fs[name].apply(fs, args)
            if (call.after) call.after(null, res)
          } catch (e) {
            if (call.after) call.after(e)
          }
          process.nextTick(done)
        }, steps, function (e) {
          emitter.log = false
          done(e)
        })
      })
    })
  })

  it('should fail openSync calls gracefully', function (done) {
    const previousIgnoreErrors = ao.probes.fs.ignoreErrors;
    delete ao.probes.fs.ignoreErrors;
    function reset (err) {
      ao.probes.fs.ignoreErrors = previousIgnoreErrors;
      done(err);
    }
    helper.test(emitter, function (done) {
      try {
        fs.openSync('does-not-exist', 'r')
      }
      catch (e) {}
      process.nextTick(done)
    }, [
      function (msg) {
        checks.entry(msg)
        msg.should.have.property('Operation', 'openSync')
        msg.should.have.property('FilePath', 'does-not-exist')
      },
      function (msg) {
        checks.exit(msg)
        msg.should.have.property('ErrorClass', 'Error')
        msg.should.have.property('Backtrace')
        msg.should.have.property('ErrorMsg').and.startWith('ENOENT')
      }
    ], reset)
  });

  it('should suppress openSync errors when requested', function (done) {
    const previousIgnoreErrors = ao.probes.fs.ignoreErrors;
    ao.probes.fs.ignoreErrors = {open: {ENOENT: true}};
    function reset (err) {
      ao.probes.fs.ignoreErrors = previousIgnoreErrors;
      done(err);
    }
    helper.test(emitter, function (done) {
      try {
        fs.openSync('does-not-exist', 'r')
      }
      catch (e) {}
      process.nextTick(done)
    }, [
      function (msg) {
        checks.entry(msg)
        msg.should.have.property('Operation', 'openSync')
        msg.should.have.property('FilePath', 'does-not-exist')
      },
      function (msg) {
        checks.exit(msg)
        msg.should.not.have.property('ErrorClass');
        msg.should.not.have.property('Backtrace');
        msg.should.not.have.property('ErrorMsg');
      }
    ], reset)
  });

  it('should report open errors', function (done) {
    const previousIgnoreErrors = ao.probes.fs.ignoreErrors;
    delete ao.probes.fs.ignoreErrors;
    function reset (err) {
      ao.probes.fs.ignoreErrors = previousIgnoreErrors;
      done(err);
    }
    helper.test(emitter, function (done) {
      fs.open('does-not-exist', 'r', function (err) {
        done();
      })
    }, [
      function (msg) {
        checks.entry(msg)
        msg.should.have.property('Operation', 'open')
        msg.should.have.property('FilePath', 'does-not-exist')
      },
      function (msg) {
        checks.exit(msg)
        msg.should.have.property('ErrorClass', 'Error')
        msg.should.have.property('Backtrace')
        msg.should.have.property('ErrorMsg').and.startWith('ENOENT')
      }
    ], reset)
  })

  it('should suppress open errors when requested', function (done) {
    const previousIgnoreErrors = ao.probes.fs.ignoreErrors;
    ao.probes.fs.ignoreErrors = {open: {ENOENT: true}};
    function reset (err) {
      ao.probes.fs.ignoreErrors = previousIgnoreErrors;
      done(err);
    }
    helper.test(emitter, function (done) {
      fs.open('does-not-exist', 'r', function (err) {
        done();
      })
    }, [
      function (msg) {
        checks.entry(msg)
        msg.should.have.property('Operation', 'open')
        msg.should.have.property('FilePath', 'does-not-exist')
      },
      function (msg) {
        checks.exit(msg)
        msg.should.not.have.property('ErrorClass');
        msg.should.not.have.property('Backtrace');
        msg.should.not.have.property('ErrorMsg');
      }
    ], reset)
  })
})
