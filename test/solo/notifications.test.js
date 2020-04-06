'use strict';

// oboe's notifier will send all log messages
process.env.APPOPTICS_DEBUG_LEVEL = 7;

const ao = require('../..');
const notifications = ao.notifications;

const sources = {
  oboe: {
    config: 0,
    'keep-alive': 0,
    logging: 0,
  },
  collector: {
    'remote-config': 0,
    'remote-warning': 0,
  },
  notifier: {
    error: 0,
  },
  other: [],
};

const logLevelCounts = {
  fatal: 0,
  error: 0,
  warn: 0,
  info: 0,
  low: 0,
  medium: 0,
  high: 0,
  other: [],
};

const messages = [];

notifications.on('message', function (msg) {
  messages.push(msg);
})

const expect = require('chai').expect;

describe('notifier message check', function () {
  it('should receive a variety of messages over 60 seconds', function (done) {
    this.timeout(70000);
    setTimeout(function () {
      messages.forEach(m => {
        if (m.source in sources && m.type in sources[m.source]) {
          sources[m.source][m.type] += 1;
          if (m.source === 'oboe' && m.type === 'logging') {
            if (m.level in logLevelCounts) {
              logLevelCounts[m.level] += 1;
            } else {
              logLevelCounts.other.push(m);
            }
          }
        } else {
          sources.other.push(m);
        }
      });
      expect(sources.oboe.config, 'oboe-config').equal(1);
      expect(sources.oboe['keep-alive'], 'keep-alive').above(4);
      expect(sources.oboe.logging, 'oboe logging').gt(175);
      expect(sources.collector['remote-config'], 'remote-config').eq(2);
      expect(sources.collector['remote-warning'], 'remote-warning').eq(0);
      expect(sources.notifier.error, 'notifier errors').eq(0);
      expect(sources.other.length, 'other entries').eq(0);
      expect(logLevelCounts.fatal, 'fatal log levels').eq(0);
      expect(logLevelCounts.error, 'error log levels').eq(0);
      expect(logLevelCounts.warn, 'warn log levels').eq(0);
      expect(logLevelCounts.info, 'info log level').eq(1);
      expect(logLevelCounts.low, 'log level low').gt(10);
      expect(logLevelCounts.medium, 'log level medium').gt(40);
      expect(logLevelCounts.high, 'log level high').gt(175);
      expect(logLevelCounts.other.length, 'other log levels').eq(0);
      done();
    }, 60000);
  });
});
