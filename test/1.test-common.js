'use strict'

const ao = require('../lib')
const util = require('util')

// require should so that individual tests can be debugged using
// "mocha --inspect-brk test/test-file.js". if should is not included
// here then it's not included by the gulpfile (because it's not run)
// so it will be undefined.
const should = require('should') // eslint-disable-line

const env = process.env

if (env.APPOPTICS_REPORTER !== 'udp') {
  ao.loggers.warn('It looks like you need to "source env.sh bash" for tests to work correctly')
}

ao.loggers.addGroup({
  groupName: 'test',
  subNames: ['info', 'mock-port', 'messages', 'span', 'cls', 'debug']
})

if (!ao.g.taskDict) {
  ao.g.taskDict = {}
}

function startTest (file, options = {}) {
  ao.g.current = file.slice(file.lastIndexOf('/') + 1)
  ao.loggers.test.info('starting test: ', file)
  ao.loggers.test.cls(`entering ${ao.g.current}: %c`, ao.tContext)

  applyOptions(options)
}

function endTest (options = {}) {
  ao.loggers.test.cls(`exiting ${ao.g.current}: %c`, ao.tContext)

  applyOptions(options)
}

const debugOptions = {
  enable: false,
}


function applyOptions (options) {
  // work when using standard cls-hooked.
  if (!ao.tContext.setDebugOptions) {
    return
  }
  // don't modify the caller's options object
  let opts = Object.assign({}, options)

  // handle different name
  if (opts.customFormatter) {
    opts.ctxFmtter = formatters[opts.customFormatter]
    delete opts.customFormatter

    opts = Object.assign({}, debugOptions, opts)
  }
  ao.tContext.setDebugOptions(opts)
}

const formatters = {
  terse: clsFormatTerse,
  abbrev: clsFormatAbbrev
}

function clsFormatTerse (active) {
  if (!active) {
    return active
  }
  const ls = active.lastSpan
  const le = active.lastEvent

  const terse = {
    id: active.id,
    name: active.lastSpan ? ls.name : '<none>',
    label: active.lastEvent ? le.Label : '<none>',
    iuc: active._iuc,
    xuc: active._xuc,
  }
  return util.inspect(terse)
}

function clsFormatAbbrev (active) {
  if (!active) {
    return active
  }

  const utilOptions = {
    depth: 2,
    colors: true
  }

  const otherKeys = Object.keys(active).filter(k => ['id', 'lastSpan', 'lastEvent'].indexOf(k) === -1)
  const ls = active.lastSpan
  const le = active.lastEvent
  const abbrev = {
    id: active.id,
    lastSpan: active.lastSpan ? `${ls.name}:${ls._async ? 'async' : ''}` : 'none',
    lastEvent: active.lastEvent ? `${le.label}` : 'none'
  }
  otherKeys.forEach(k => {
    abbrev[k] = active[k]
  })
  return util.inspect(abbrev, utilOptions)
}

// make function available without explicit imports
ao.g.testing = startTest     // replace no-op
ao.g.startTest = startTest
ao.g.endTest = endTest

exports.ao = ao
exports.startTest = startTest
exports.endTest = endTest
