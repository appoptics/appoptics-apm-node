'use strict';

/* eslint-disable no-console */

const ao = require('..');
// wait 2 seconds to make sure it's ready.
ao.readyToSample(2000);

const Benchmark = require('benchmark');

const suite = new Benchmark.Suite({name: 'initial'});

suite
  .add('detect if tracing', function () {
    ao.tracing;
  })
  .add('set trace mode as a number', function () {
    ao.traceMode = 1;
  })
  .add('set trace mode as a string', function () {
    ao.traceMode = 'always';
  })
  .add('set sample rate', function () {
    ao.sampleRate = 100;
  })
  .add('get settings for a trace', function () {
    ao.getTraceSettings('');
  })

  .on('complete', function () {
    console.log(this.name);
    for (let i = 0; i < this.length; i++) {
      const t = this[i];
      console.log(t.name, t.stats.mean, t.count, t.times.elapsed);
    }
  })

  .run();
