'use strict';

const {loggers: log, addon: aob} = require('.');
const v8 = require('v8');

class Metrics {
  constructor (options = {}) {
    this.id = undefined;
    this.interval = options.interval || 60 * 1000;
    this.prefix = options.prefix || 'trace.node';
    this.metrics = [];
    this.state = 'initial';
  }

  start () {
    if (this.state !== 'started') {
      // start the metrics gathered by the C++ code
      aob.metrics.start();

      this.id = setInterval(() => {
        this.reportMetrics();
      }, this.interval);
      // don't let metrics keep the process alive
      this.id.unref();
    }
    return this.state = 'started';
  }

  stop () {
    if (this.state !== 'started') {
      return;
    }
    aob.metrics.stop();
    clearInterval(this.id);
    return this.state = 'stopped';
  }

  getState () {
    return this.state;
  }

  resetInterval (interval) {
    if (!interval) {
      return false;
    }
    this.interval = interval;
    this.stop();
    return this.start();
  }

  addMetricV (metric, value, n = 1) {
    this.metrics.push({
      name: `${this.prefix}.${metric}`,
      count: n,
      value,
      addHostTag: true,
    });
  }

  addMetricI (metric, n = 1) {
    this.metrics.push({
      name: `${this.prefix}.${metric}`,
      count: n,
      addHostTag: true,
    });
  }

  reportMetrics () {
    this.addMetrics();
    this.addMemory();
    const r = aob.Reporter.sendMetrics(this.metrics);
    if (r.errors.length > 0) {
      r.errors.forEach(e => {
        log.error('invalid metric', e);
      });
    }
    // don't keep the previous metrics around
    this.metrics.length = 0;
  }

  addMetrics () {
    const metrics = aob.metrics.getMetrics();
    if (metrics.gc) {
      this.addMetricV('gc.count', metrics.gc.gcCount);
      this.addMetricV('gc.time', metrics.gc.gcTime);
      ['major', 'minor'].forEach(type => {
        this.addMetricV(`gc.${type}.count`, metrics.gc[type].count);
        this.addMetricV(`gc.${type}.p50`, metrics.gc[type].p50);
        this.addMetricV(`gc.${type}.p75`, metrics.gc[type].p75);
        this.addMetricV(`gc.${type}.p90`, metrics.gc[type].p90);
        this.addMetricV(`gc.${type}.p95`, metrics.gc[type].p95);
        this.addMetricV(`gc.${type}.p99`, metrics.gc[type].p99);
        this.addMetricV(`gc.${type}.min`, metrics.gc[type].min);
        this.addMetricV(`gc.${type}.max`, metrics.gc[type].max);
        this.addMetricV(`gc.${type}.mean`, metrics.gc[type].mean);
        this.addMetricV(`gc.${type}.stddev`, metrics.gc[type].stddev);
      })
    }

    if (metrics.eventloop) {
      this.addMetricV('eventloop.p50', metrics.eventloop.p50);
      this.addMetricV('eventloop.p75', metrics.eventloop.p75);
      this.addMetricV('eventloop.p90', metrics.eventloop.p90);
      this.addMetricV('eventloop.p95', metrics.eventloop.p95);
      this.addMetricV('eventloop.p99', metrics.eventloop.p99);
      this.addMetricV('eventloop.min', metrics.eventloop.min);
      this.addMetricV('eventloop.max', metrics.eventloop.max);
      this.addMetricV('eventloop.mean', metrics.eventloop.mean);
      this.addMetricV('eventloop.stddev', metrics.eventloop.stddev);
    }

    let cpu = metrics.process;
    if (!cpu) {
      cpu = process.cpuUsage();
    }
    this.addMetricV('process.cpuUsage.user', cpu.user);
    this.addMetricV('process.cpuUsage.system', cpu.system);
  }

  addMemory () {
    let mem = process.memoryUsage();
    this.addMetricV('process.memoryUsage.rss', mem.rss);
    this.addMetricV('process.memoryUsage.heapTotal', mem.heapTotal);
    this.addMetricV('process.memoryUsage.heapUsed', mem.heapUsed);
    this.addMetricV('process.memoryUsage.external', mem.external);

    mem = v8.getHeapStatistics();
    this.addMetricV('v8.heapStatistics.total_heap_size', mem.total_heap_size);
    this.addMetricV('v8.heapStatistics.total_heap_size_executable', mem.total_heap_size_executable);
    this.addMetricV('v8.heapStatistics.total_physical_size', mem.total_physical_size);
    this.addMetricV('v8.heapStatistics.total_available_size', mem.total_available_size);
    this.addMetricV('v8.heapStatistics.used_heap_size', mem.used_heap_size);
    this.addMetricV('v8.heapStatistics.heap_size_limit', mem.heap_size_limit);
    this.addMetricV('v8.heapStatistics.malloced_memory', mem.malloced_memory);
    this.addMetricV('v8.heapStatistics.peak_malloced_memory', mem.peak_malloced_memory);
  }
}

module.exports = Metrics;
