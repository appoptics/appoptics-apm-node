'use strict'

const {VersionSpec} = require('testeachversion')

const packages = module.exports = []

// node builtin modules
test('crypto')
test('fs')
test('http')
test('https')
test('zlib')


//
// using a minimum version can avoid testing versions
// known to fail or deprecated, speeding the test.
//
//test('amqp', '>= 0.2.0')
test('amqplib', '>= 0.2.0 < 0.5.0 || > 0.5.0')

test('bcrypt', '>= 0.8.6')
test('bluebird', '>= 2.0.0')

test('cassandra-driver', '>= 3.3.0')
test('co-render')
test('director', '>= 1.2.0')
test('express', '>= 3.0.0')

test('generic-pool', '>= 2.4.0')

test('hapi', {
  ranges: [
    {
      range: '>= 13.0.0 < 17.0.0',
      dependencies: ['vision@4'],
    }, {
      range: '>= 17.0.0',
      dependencies: ['vision@5'],
    }
  ]
})

// koa has so many parts and pieces this can get complicated
test('koa', {
  ranges: [
    {
      range: '>= 1.0.0 < 2.0.0',
      dependencies: ['koa-router@5']
    }, {
      range: '>= 2.0.0',
      dependencies: ['koa-router@7']
    }
  ]
})

test('koa-resource-router')
test('koa-route', '>= 1.0.1')

test('koa-router', {
  ranges: [
    {
      range: '>= 3.0.0 < 6.0.0',
      dependencies: ['koa@1']
    }, {
      range: '>= 6.0.0',
      dependencies: ['koa@2']
    }
  ]
})

test('level', '>= 1.3.0')
test('memcached', '>= 2.2.0')

test('mongodb-core', '>= 2.0.0')

test('mongoose', '>= 4.6.4')

test('mysql', '>= 2.1.0')
test('oracledb', '>= 2.0.14')

test('pg', '>= 4.5.5')
/*
test('pg', {
  ranges: [
    {
      range: '>= 4.5.5 < 7.0.0',
      dependencies: ['pg-native@1.7']
    }, {
      range: '>= 7.0.0',
      dependencies: ['pg-native@2']
    }
  ]
})
// */

test('q', '>= 0.9.0')
test('raw-body')
test('redis', '>= 0.8.0')
test('restify', '>= 2.0.0 < 2.0.2 || >= 2.0.3')
test('tedious', '>= 0.1.5')

test('vision', {
  ranges: [
    {
      range: '>= 4.0.0 < 5.0.0',
      dependencies: ['hapi@16']
    }, {
      range: '>= 5.0.0',
      dependencies: ['hapi@17']
    }
  ]
})


//
// Helper
//

function test (name, ranges) {
  const options = {}
  if (typeof ranges === 'string') {
    options.ranges = ranges
  } else if (typeof ranges === 'object') {
    options.ranges = ranges.ranges
  }
  options.task = `mocha test/probes/${name}.test.js`
  packages.push(new VersionSpec(name, options))
}
