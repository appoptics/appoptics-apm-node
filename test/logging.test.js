'use strict'

const helper = require('./helper')
const ao = require('..')
const debug = ao.logger.debug

const util = require('util')
const expect = require('chai').expect

const makeSettings = helper.makeSettings

//
// for some reason it's  not possible to set debug.inspectOpts.colors
// here and have it take effect. At this point mocha has already loaded
// multiple packages that use debug. rather than continue figuring out
// debug it's easier just to use regex to skip over the color manipulation.
//
const getLevelAndText = helper.getLevelAndText

describe('logging', function () {
  const levels = ao.logLevel
  const logger = debug.log

  before(function () {
    ao.sampleRate = 1000000;
    ao.logLevel = 'error,warn'
  })

  after(function () {
    ao.logLevel = levels
  })

  afterEach(function () {
    debug.log = logger
  })

  it('should set logging', function () {
    let correct = false
    const real = debug.enable
    debug.enable = function (level) {
      correct = level === 'appoptics:span'
      debug.enable = real
    }
    const before = ao.logLevel
    ao.logLevel = 'span'
    expect(ao.logLevel).equal('span')
    expect(correct).equal(true)
    ao.logLevel = before
  })

  it('should add and remove logging', function () {
    const add = 'info,span'
    const previous = ao.logLevel
    const expected = previous ? previous + ',' + add : add
    ao.logLevelAdd(add)
    expect(ao.logLevel).equal(expected)
    ao.logLevelRemove(add)
    expect(ao.logLevel).equal(previous)
  })

  it('should interact with existing debug logging correctly', function () {
    process.env.DEBUG = 'xyzzy:plover,xyzzy:dragon'
    ao.logLevel = 'error'
    expect(process.env.DEBUG.split(',')).include.members(['xyzzy:plover', 'xyzzy:dragon', 'appoptics:error'])
    ao.logLevel = ''
    expect(process.env.DEBUG.split(',')).include.members(['xyzzy:plover', 'xyzzy:dragon'])
    ao.logLevel = 'error,warn'
  })

  it('should log correctly', function () {
    const msg = 'test logging'
    let called = false
    debug.log = function (output) {
      const [level, text] = getLevelAndText(output)
      expect(level).equal('appoptics:error')
      expect(text).equal(msg)
      called = true
    }
    ao.loggers.error(msg)
    expect(called).equal(true, 'logger must be called')
  });

  it('should throw when constructing a debounced logger that does not exist', function () {
    function badLogger () {
      return new ao.loggers.Debounce('xyzzy');
    }
    expect(badLogger).throws('Debounce: level \'xyzzy\' doesn\'t exist');
  });

  it('should handle standard formats correctly', function () {
    let [logger, getter] = makeLogHandler()
    debug.log = logger
    ao.loggers.error('embed a string "%s" with a number %d', 'adventure', 98.6);
    let [called, level, text, formatted] = getter() // eslint-disable-line no-unused-vars
    expect(called).equal(true, 'logger must be called')
    expect(level).equal('appoptics:error')
    expect(formatted).equal('embed a string "adventure" with a number 98.6');

    [logger, getter] = makeLogHandler()
    debug.log = logger
    ao.loggers.warn('embed integer %i floating %f object %o Object %O', 17.5, 17.5, [1, 2], [1, 2]);
    [called, level, text, formatted] = getter()
    expect(called).equal(true, 'logger must be called')
    expect(level).equal('appoptics:warn')
    expect(formatted).equal('embed integer 17 floating 17.5 object [ 1, 2, [length]: 2 ] Object [ 1, 2 ]')
  })

  it('should handle the appoptics extended xtrace (%x) format', function () {
    let [logger, getter] = makeLogHandler()
    debug.log = logger
    const md = new ao.MB.makeRandom();
    ao.loggers.error('xtrace %x', md)
    let [called, level, text, formatted] = getter() // eslint-disable-line no-unused-vars
    expect(called).equal(true)
    expect(level).equal('appoptics:error')
    expect(formatted, 'metadata').equal(`xtrace ${md.toString(1)}`);

    [logger, getter] = makeLogHandler()
    debug.log = logger
    ao.loggers.error('xtrace %x', '');
    [called, level, text, formatted] = getter()
    expect(called).equal(true)
    expect(level).equal('appoptics:error')
    expect(formatted, 'null').equal('xtrace <no xtrace>');

    [logger, getter] = makeLogHandler()
    debug.log = logger
    ao.loggers.error('xtrace %x', 'bad:beef:cafe');
    [called, level, text, formatted] = getter()
    expect(called).equal(true)
    expect(level).equal('appoptics:error')
    expect(formatted, 'bad:beef:cafe').equal('xtrace ?-?-?-?(bad:beef:cafe)');

    [logger, getter] = makeLogHandler()
    debug.log = logger
    const mb = new ao.MB(md);
    ao.loggers.error('native event xtrace %x', mb);
    [called, level, text, formatted] = getter()
    expect(called).equal(true)
    expect(level).equal('appoptics:error')
    expect(formatted, 'event').equal(`native event xtrace ${mb.toString(1)}`);

    [logger, getter] = makeLogHandler()
    debug.log = logger
    const event = new ao.Event('span', 'label', md);
    ao.loggers.error('event xtrace %x', event);
    [called, level, text, formatted] = getter()
    expect(called).equal(true)
    expect(level).equal('appoptics:error')
    expect(formatted, 'span').equal(`event xtrace ${event.toString(1)}`);

    [logger, getter] = makeLogHandler()
    debug.log = logger
    // get uppercase, non-delimited string
    const s = md.toString()
    ao.loggers.error('string xtrace %x', s);
    [called, level, text, formatted] = getter()
    expect(called).equal(true)
    expect(level).equal('appoptics:error')
    expect(formatted, 'string').equal(`string xtrace ${md.toString(1)}`);

  })

  it('should handle the appoptics extended metadata (%m) format', function () {
    // this only needs to verify that %m works; the previous test verified
    // that all forms of this function work.
    const [logger, getter] = makeLogHandler()
    debug.log = logger
    const md = new ao.MB.makeRandom();
    ao.loggers.error('metadata %m', md)
    const [called, level, text, formatted] = getter() // eslint-disable-line no-unused-vars
    expect(called).equal(true)
    expect(level).equal('appoptics:error')
    expect(formatted).equal(`metadata ${md.toString(1)}`);
  })

  // check span formatting (%l). it was done when they were called layers and %s already
  // means string.
  it('should handle the appoptics extended span (%l) format', function () {
    const span = ao.Span.makeEntrySpan('log-span', makeSettings())
    const name = span.name
    const entry = `${name}:entry`
    const exit = `${name}:exit`
    const entryEvent = span.events.entry.toString(1);
    const exitEvent = span.events.exit.toString(1);

    const [logger, getter] = makeLogHandler()
    debug.log = logger
    ao.loggers.error('%l', span)
    const [called, level, text, formatted] = getter() // eslint-disable-line no-unused-vars
    expect(called).equal(true)
    expect(level).equal('appoptics:error')
    expect(formatted).equal(`${name} ${entry} ${entryEvent} ${exit} ${exitEvent}`);
  })

  it('should handle the appoptics extended event (%e) format', function () {
    const md = new ao.MB.makeRandom();
    const edge = false
    const event = new ao.Event('log-event', 'entry', md, edge)
    const name = 'log-event:entry'

    const [logger, getter] = makeLogHandler()
    debug.log = logger
    ao.loggers.error('%e', event)
    const [called, level, text, formatted] = getter() // eslint-disable-line no-unused-vars
    expect(called).equal(true)
    expect(level).equal('appoptics:error')
    expect(formatted).equal(`${name} ${event.toString(1)}`);
  })

  it('should debounce repetitive logging by count', function () {
    const msg = 'test logging'
    const aolevel = 'error'
    let debounced = new ao.loggers.Debounce(aolevel);
    let count = 0
    let i
    debug.log = function (output) {
      const [level, text] = getLevelAndText(output)
      expect(level).equal('appoptics:' + aolevel)
      expect(text).equal(`[${i + 1}]${msg}`);
      count += 1;
    }
    for (i = 0; i < 1000; i++) {
      debounced.log(msg)
    }
    expect(count).equal(10);

    debounced = new ao.loggers.Debounce(aolevel, {deltaCount: 500});
    count = 0
    for (i = 0; i < 1000; i++) {
      debounced.log(msg)
    }
    expect(count).equal(2);
  })


  it('should debounce repetitive logging by time', function (done) {
    this.timeout(5000)
    const msg = 'test logging'
    const aolevel = 'error'
    const options = {
      deltaCount: Infinity,        // don't ever log due to count
      deltaTime: 1000              // log at most one time per second
    }
    const debounced = new ao.loggers.Debounce('error', options)
    let count = 0
    let calls = 0

    debug.log = function (output) {
      const [level, text] = getLevelAndText(output)
      expect(level).equal('appoptics:' + aolevel)
      expect(text).equal('[' + calls + ']' + msg)
      count += 1
    }

    let i = 0

    const id = setInterval(function () {
      i += 1
      if (i >= 4) {
        clearInterval(id)
        clearInterval(lid)
        expect(count).equal(4)
        done()
      }
    }, 1000)

    // log every 10 ms
    const lid = setInterval(function () {
      calls += 1
      debounced.log(msg)
    }, 10)

  });

  it.skip('should handle the appoptics extended cls (%c) format', function () {})

  //
  // helpers
  //

  // return an array of two functions. the first is a replacement for the debug.log
  // function so that logging output can be captured. the second returns the captured
  // output.
  function makeLogHandler () {
    let called = false
    let level
    let text
    let formatted

    return [
      function logger (...args) {
        [level, text] = getLevelAndText(...args)
        const formatArgs = [...args].slice(1).slice(0, -1)
        formatArgs.unshift(text)
        formatted = util.format(...formatArgs)
        called = true
      },
      function getter () {
        return [called, level, text, formatted]
      }
    ];
  }
})
