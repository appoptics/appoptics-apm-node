'use strict'

//
// this module only needs to supply functions that enable the core high-level
// instrumentation modules to run the supplied functions.
//

//
// the skeleton addon module
//
const addon = {
  MAX_SAMPLE_RATE: 1000000,
  MAX_METADATA_PACK_LEN: 512,
  MAX_TASK_ID_LEN: 20,
  MAX_OP_ID_LEN: 8,
  TRACE_NEVER: 0,
  TRACE_ALWAYS: 1,
  oboeInit () {},

  Event: {
    send (event, channel) {
      channel = channel ? 1 : 0;
      return {status: true, errors: [], channel}
    },
    xtraceIdVersion: 2,
    taskIdLength: 20,
    opIdLength: 8,
  },

  Reporter: {
    // -1 is success
    sendMetric () {return -1},
    sendMetrics () {
      return {errors: []}
    },
    // it returns the transaction name, so...
    sendHttpSpan (obj) {return obj.txname ? obj.txname : ''},
    // we're as ready to sample as we'll ever be
    isReadyToSample () {return true}
  },

  Settings: {
    setTracingMode () {},
    setDefaultSampleRate (r) {return r},
    getTraceSettings (xtrace, localMode) {
      return {
        doSample: false,
        doMetrics: false,
        edge: false,
        source: 0,
        rate: 0
      }
    }
  },

  Sanitizer: {
    sanitize (s) {return s}
  },

  Config: {
    getVersionString () {return 'not loaded'},
    getSettings () {return {}}
  },
  path: '',
  version: 'not loaded'
}

module.exports = addon
