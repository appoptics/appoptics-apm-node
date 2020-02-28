'use strict'
const helper = require('./helper')
const ao = helper.ao
const Event = ao.Event

const expect = require('chai').expect

describe('event', function () {
  let emitter
  let event
  let md;
  let mdTaskId

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

  beforeEach(function () {
    md = ao.MB.makeRandom(1);
    const mds = md.toString(ao.MB.fmtHuman).split('-')
    mdTaskId = mds[1].toUpperCase()
  })

  it('UDP might lose a message', function (done) {
    helper.test(emitter, function (done) {
      ao.instrument('fake', function () {})
      done()
    }, [
      function (msg) {
        expect(msg).property('Label').oneOf(['entry', 'exit']),
        expect(msg).property('Layer', 'fake')
      }
    ], done)
  })

  it('should construct valid event', function () {
    event = new Event('test', 'entry', md)
    expect(event).property('Layer', 'test')
    expect(event).property('Label', 'entry')
    expect(event).property('taskId').and.match(/^[0-9A-F]{40}$/)
    expect(event).property('opId').and.match(/^[0-9A-F]{16}$/)
    expect(event).property('taskId', mdTaskId)
  })

  it('should convert an event to a string', function () {
    event.toString().should.match(/^2B[0-9A-F]{58}$/)
  })

  it('should fetch an event\'s sample flag', function () {
    ao.sampleRate = 0
    ao.traceMode = 'never'
    md = ao.MB.makeRandom(0);
    event = new Event('test', 'entry', md);
    expect(event.mb.getFlags() & 1).equal(0);
    expect(event.sampling).equal(false);
    expect(ao.sampling(event)).equal(false);
    expect(ao.sampling(event.toString())).equal(false);

    ao.sampleRate = ao.addon.MAX_SAMPLE_RATE
    ao.traceMode = 'always'
    md = ao.MB.makeRandom(1);
    event = new Event('test', 'entry', md);
    expect(event.mb.getFlags() & 1).equal(1);
    expect(event.sampling).equal(true);
    expect(ao.sampling(event)).equal(true);
    expect(ao.sampling(event.toString())).equal(true);
  })

  it('should send the event', function (done) {
    const edge = true
    const event2 = new Event('test', 'exit', event.mb, edge)

    emitter.once('message', function (msg) {
      expect(msg).property('X-Trace', event2.toString())
      expect(msg).property('Edge', event.opId)
      expect(msg).property('Layer', 'test')
      expect(msg).property('Label', 'exit')
      done()
    })

    // NOTE: events must be sent within a request store context
    ao.tContext.run(function () {
      event2.send()
    })
  })

  it('should not allow setting a NaN value', function () {
    const event2 = new Event('test', 'exit', event.mb)

    const logChecks = [
      {level: 'error', message: 'Error: Invalid type for KV Nan: NaN'},
      // there is a stack trace here but issuing the error is enough.
    ]

    const [getCount, clear] = helper.checkLogMessages(logChecks) // eslint-disable-line

    event2.addKVs({Nan: NaN})

    expect(getCount()).equal(1, 'incorrect log message count')
  })

  it('should support .addKVs()', function () {
    const event = new Event('test', 'entry', md)
    event.addKVs({Foo: 'bar'})
    expect(event.kv).property('Foo', 'bar')
  })

  it('should support data in send function', function (done) {
    const event = new Event('test', 'entry', md)

    emitter.once('message', function (msg) {
      expect(msg).property('Foo', 'fubar')
      done()
    })
    ao.tContext.run(function () {
      event.send({Foo: 'fubar'})
    })
  })
})
