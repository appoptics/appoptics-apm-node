'use strict'

const util = require('util');
const Event = require('./event')
let ao;
let log;
let dbSendError;

const stats = {
  totalCreated: 0,              // total spans created
  topSpansCreated: 0,           // total entry spans (traces) created - basis for request rate
  topSpansActive: 0,            // topSpans: span.enter() called but not span.exit()
  topSpansMax: 0,               // topSpans: maximum active
  topSpansExited: 0,            // topSpans: span.exit() called - basis for response rate
  otherSpansActive: 0,          // not-topSpan: span.enter() called but not span.exit()
}

/**
 * Create an execution span.
 *
 * @class Span
 * @param {string} name Span name
 * @param {object} settings Settings returned from getTraceSettings()
 * @param {Event} [settings.traceTaskId] an addon.Event instance to create the events from.
 *     Events will have the same task ID and sample bit but unique op IDs. This value is set
 *     by getTraceSettings() and must be present.
 * @param {boolean} [settings.edge=true] the entry event of this span should edge back to the
 *     op id associated with settings.traceTaskId. The only time this is not true is when the
 *     span being created is a new top level span not being continued from an inbound X-Trace
 *     ID. This must be set explicitly to a falsey value; it's absence is true.
 * @param {object} [data] Key/Value pairs of info to add to event
 *
 * @example
 * var span = new Span('fs', ao.lastEvent, {
 *   File: file
 * })
 */
function Span (name, settings, data) {
  // most spans are not top/entry spans, so default them false.
  this.topSpan = false;
  this.doMetrics = false;

  this._async = false
  this.name = name
  this.events = {
    internal: [],
    entry: null,
    exit: null
  }

  if (!name) {
    throw new TypeError(`invalid span name ${name}`)
  }

  stats.totalCreated += 1;

  // the sampling state needs to be in each span because it is used
  // to avoid expensive operations, e.g., collecting backtraces, when
  // not sampling.
  this.doSample = settings.traceTaskId.getSampleFlag()

  // it is possible to ignore some errors. the only error that customers have
  // requested to be able to ignore is ENOENT because their application looks for
  // files at startup but it's not really an error for them to not be found.
  // in order to ignore an error the probe must call Span.setErrorsToIgnoreFunction().
  this.ignoreErrorFn = undefined;

  const edge = 'edge' in settings ? settings.edge : true

  const entry = new Event(name, 'entry', settings.traceTaskId, edge)
  const exit = new Event(name, 'exit', entry.event, true)

  entry.set(data)

  this.events.entry = entry
  this.events.exit = exit
}

const getSpan = util.deprecate(() => ao.lastSpan, 'use ao.lastSpan instead of Span.last');
const setSpan = util.deprecate(span => ao.lastSpan = span, 'use ao.lastSpan instead of Span.last');

Object.defineProperty(Span, 'last', {
  get: getSpan,
  set: setSpan,
});

/**
 * Create a new entry span. An entry span is the top span in a new trace in
 * this process. It might be continued from another process, e.g., an X-Trace-ID
 * header was attached to an inbound HTTP/HTTPS request.
 *
 * @method Span.makeEntrySpan
 * @param {string} name the name for the span.
 * @param {object} settings the object returned by ao.getTraceSettings()
 * @param {object} kvpairs key/value pairs to be added to the entry event
 */
Span.makeEntrySpan = function makeEntrySpan (name, settings, kvpairs) {
  stats.topSpansCreated += 1;

  log.span('Span.makeEntrySpan %s from inbound %x', name, settings.traceTaskId)

  // use the Event from settings or make new (error getting settings or testing).
  const traceTaskId = settings.traceTaskId || ao.addon.Event.makeRandom(settings.doSample)

  const span = new Span(name, {traceTaskId, edge: settings.edge}, kvpairs);

  // if not sampling make a single skeleton span that will be used for all other spans in this
  // trace.
  span.skeleton = undefined;
  if (!span.doSample) {
    const skeleton = new Span('__skeleton__', span.events.entry.event);
    //const skeleton = Object.create(span);
    span.skeleton = skeleton;
    skeleton.name = '__skeleton__';
    //console.log(skeleton.events);
    skeleton.events.entry.Layer = skeleton.events.exit.Layer = '__skeleton__';
    skeleton.isSkeleton = true;
    // decrement the created and active event counts as if the entry and exit were not created.
    Event.incrementStats(-2);
  }

  // fill in entry-span-specific properties.
  span.topSpan = true;
  span.doMetrics = settings.doMetrics;

  // supply a default in case the user didn't provide a txname string or
  // function that returns a string. if the span is unnamed then let oboe
  // provide "unknown". there is no customTxName function by default.
  span.defaultTxName = span.name ? 'custom-' + span.name : '';
  span.customTxName = undefined;

  span.events.entry.set({
    SampleSource: settings.source,
    SampleRate: settings.rate,
  })

  return span
}

/**
 * Create a new span descending from the current span
 *
 * @method Span#descend
 * @param {string} name Span name
 * @param {object} data Key/Value pairs of info to add to the entry event
 * @returns {Span} the created span
 *
 * @example
 * var inner = outer.descend('fs', {
 *   File: file
 * })
 */
Span.prototype.descend = function (name, data) {
  const last = ao.lastEvent
  log.span('span.descend %s from ao.lastEvent %e', name, last);

  if (this.debugIt) debugger;

  // if this trace is not sampled then avoid as much work as possible.
  if (!this.doSample) {
    let span;
    // if descending from the topSpan then use the pre-constructed skeleton. if not
    // then this is the pre-constructed skeleton. re-use it.
    if (this.topSpan) {
      span = this.skeleton;
      span.count += 1;
    } else {
      if (!this.isSkeleton) {
        log.debug('expected isSkeleton');
      }
      this.count += 1;
      span = this;
    }

    // increment stats because logically two new events have been created and they
    // should be sent.
    // N.B. this is problematic because express and restify count on utility.once()
    // to prevent invoking span.exit() more than one time. And if the .exit() function
    // is wrapped once it prevents all subsequent span.exit() calls, so the number of
    // active skeleton spans cannot be known. The best we can do, without restructuring
    // this code is to know how many spans are associated with this particular topSpan.
    //Event.incrementStats(2);
    return span;
  }

  const span = new Span(name, {traceTaskId: last.event}, data)

  // fill in descended-span-specific properties.
  //span.parent = this;

  return span;
}

/**
 * Whether or not the span is async
 *
 * @property {boolean} async
 * @memberof Span
 */
Object.defineProperty(Span.prototype, 'async', {
  get () { return this._async },
  set (val) {
    try {
      this._async = val
      if (val) {
        this.events.entry.kv.Async = true
      } else {
        delete this.events.entry.kv.Async
      }
      log.span(`span ${this.name} ${val ? 'enabled' : 'disabled'} async`)
    } catch (e) {
      log.error(`${this.name} span failed to set async to ${val}`, e.stack)
    }
  }
})

/**
 * Run a function within the context of this span. Similar to mocha, this
 * identifies asynchronicity by function arity and invokes runSync or runAsync
 *
 * @method Span#run
 * @param {function} fn - function to run within the span context
 * @returns the value returned by fn()
 *
 * @example
 * span.run(function () {
 *   syncCallToTrace()
 * })
 * @example
 * span.run(function (wrap) {
 *   asyncCallToTrace(wrap(callback))
 * })
 */
Span.prototype.run = function (fn) {
  return fn.length === 1 ? this.runAsync(fn) : this.runSync(fn)
}

/**
 * Run an async function within the context of this span.
 *
 * @method Span#runAsync
 * @param {function} fn - async function to run within the span context
 * @returns the value returned by fn()
 *
 * @example
 * span.runAsync(function (wrap) {
 *   asyncCallToTrace(wrap(callback))
 * })
 */
Span.prototype.runAsync = function (fn) {
  this.async = true
  const span = this
  let ctx
  let startTime
  const kvpairs = {}

  try {
    ctx = ao.requestStore.createContext({newContext: this.topSpan});
    ao.requestStore.enter(ctx);
  } catch (e) {
    log.error(`${this.name} span failed to enter context`, e.stack)
  }

  if (span.doMetrics) {
    startTime = Date.now();
  }

  span.enter()
  // fn is a function that accepts our wrapper, wraps the user's callback with
  // it, then runs the user's runner function. That way our wrapper is invoked
  // before the user's callback. handler is used only for memcached. No other
  // callback function supplies it.
  const ret = fn.call(span, (cb, handler) => ao.bind(function (err) {
    if (handler) {
      // handler is present only for some memcached functions.
      // TODO BAM how to handle this with customTxName...
      handler.apply(this, arguments)
    } else {
      // this is the "normal", i.e., non-memcached path.

      if (ctx && span.doMetrics) {
        const txname = span.getTransactionName()
        const et = (Date.now() - startTime) * 1000;
        const finaltxname = Span.sendNonHttpSpan(txname, et, err)
        kvpairs.TransactionName = finaltxname
        if (txname !== finaltxname) {
          log.warn('Span.runAsync txname mismatch: %s !== %s', txname, finaltxname)
        }
      }

      span.exitCheckingError(err, kvpairs)
    }

    return cb.apply(this, arguments)
  }))

  try {
    if (ctx) {
      ao.requestStore.exit(ctx);
    }
  } catch (e) {
    log.error(`${this.name} span failed to exit context`, e.stack)
  }

  return ret
}

/**
 * Run a sync function within the context of this span.
 *
 * @method Span#runSync
 * @param {function} fn - sync function to run withing the span context
 * @returns the value returned by fn()
 *
 * @example
 * span.runSync(function () {
 *   syncCallToTrace()
 * })
 */
Span.prototype.runSync = function (fn) {
  let ctx = null
  let error
  let startTime
  const kvpairs = {}

  try {
    if (this.topSpan) {
      if (this.doMetrics) {
        startTime = Date.now();
      }
      ctx = ao.requestStore.createContext({newContext: true});
      ao.requestStore.enter(ctx)
    }
  } catch (e) {
    log.error(`${this.name} span failed to enter context`, e.stack)
  }

  this.enter()

  try {
    return fn.call(this)
  } catch (err) {
    error = err
    this.setExitError(err)
    throw err
  } finally {
    // ctx is only set for a topSpan
    if (ctx && this.doMetrics) {
      const txname = this.getTransactionName()
      const et = (Date.now() - startTime) * 1000;
      const finaltxname = Span.sendNonHttpSpan(txname, et, error)
      kvpairs.TransactionName = finaltxname
      if (txname !== finaltxname) {
        log.warn('Span.runAsync txname error: %s !== %s', txname, finaltxname)
      }
    }

    this.exit(kvpairs)

    try {
      if (ctx) {
        ao.requestStore.exit(ctx)
      }
    } catch (e) {
      log.error(`${this.name} span failed to exit context`, e.stack)
    }
  }
}

/**
 * Send the enter event
 *
 * @method Span#enter
 * @param {object} data - Key/Value pairs of info to add to event
 *
 * @example
 * span.enter()
 * syncCallToTrace()
 * span.exit()
 * @example
 * // If using enter/exit to trace async calls, you must flag it as async
 * // manually and bind the callback to maintain the trace context
 * span.async = true
 * span.enter()
 * asyncCallToTrace(ao.bind(function (err, res) {
 *   span.exit()
 *   callback(err, res)
 * }))
 */
Span.prototype.enter = function (data) {
  log.span('span.enter %e', this.events.entry);
  if (this.topSpan) {
    ao.requestStore.set('topSpan', this);
    stats.topSpansActive += 1;
    if (stats.topSpansActive > stats.topSpansMax) {
      stats.topSpansMax = stats.topSpansActive;
    }
  } else {
    stats.otherSpansActive += 1;
  }


  try {
    ao.lastSpan = this
    const {entry} = this.events

    // Send the entry event
    entry.sendReport(data)
    // clear async and kvs. the kvs shouldn't matter as they're never sent but
    // this makes sure any extra keys are freed as opposed to just accumulating.
    if (this.isSkeleton) {
      this._async = false;
      const {Layer, Label} = this.events.entry.kv;
      this.events.entry.kv = {Layer, Label};
    }
  } catch (e) {
    log.error(`${this.name} span failed to enter`, e.stack)
  }
}

/**
 * Send the exit event
 *
 * @method Span#exit
 * @param {object} data - key-value pairs of info to add to event
 */
Span.prototype.exit = function (data) {
  const exit = this.events.exit;

  log.span('span.exit for %e', exit);
  if (this.topSpan) {
    stats.topSpansActive -= 1;
    stats.topSpansExited += 1;
  } else {
    stats.otherSpansActive -= 1;
  }

  try {
    // Edge back to previous event, if not already connected
    const last = ao.lastEvent
    if (last && last !== this.events.entry && !exit.ignore) {
      exit.edges.push(last)
    } else if (!last) {
      log.debug('span.exit - no last event %l', this)
    } else {
      log.span('span.exit - no extra edge found for %e', exit)
    }

    // Send the exit event
    exit.sendReport(data)

    if (this.isSkeleton) {
      const {Layer, Label} = this.events.entry.kv;
      this.events.entry.kv = {Layer, Label};
    }
  } catch (e) {
    log.error(`${this.name} span failed to exit`, e.stack)
  }
}

/**
 * Send the exit event with an error status
 *
 * @method Span#exitCheckingError
 * @param {Error} err - Error to add to event
 * @param {object} data - Key/Value pairs of info to add to event
 */
Span.prototype.exitCheckingError = function (error, data) {
  this.setExitError(error)
  this.exit(data)
}

/**
 * Set an error to be sent with the exit event
 *
 * @method Span#setExitError
 * @param {Error} err - Error to add to event
 */
Span.prototype.setExitError = function (error) {
  try {
    error = Span.toError(error)
    if (error) {
      if (!this.ignoreErrorFn || !this.ignoreErrorFn(error)) {
        this.events.exit.error = error;
      }
    }
  } catch (e) {
    log.error(`${this.name} span failed to set exit error`, e.stack)
  }
}

/**
 * @ignore
 * Create and send an internal event
 *
 *     span._internal('info', { Foo: 'bar' })
 *
 * @method Span#_internal
 * @param {String} label Event type label
 * @param {Object} data Key/Value pairs to add to event
 */
Span.prototype._internal = function (label, data) {
  const last = ao.lastEvent
  if (!last) {
    log.error(`${this.name} span ${label} call could not find last event`)
    return
  }

  const event = new Event(null, label, last.event, true)
  this.events.internal.push(event)

  // Send the exit event
  event.sendReport(data)
}

/**
 * Create and send an info event
 *
 * @method Span#info
 * @param {object} data - key-value pairs to add to event
 *
 * @example
 * span.info({Foo: 'bar'})
 */
Span.prototype.info = function (data) {
  log.span(`span.info ${this.name}`)

  try {
    // Skip sending non-objects
    if (!isRealObject(data)) {
      log.info('span.info invalid input');
      return
    }

    this._internal('info', data)
  } catch (e) {
    log.error(`${this.name} span failed to send info event`, e.stack)
  }
}

// Helper to identify object literals
function isRealObject (v) {
  return Object.prototype.toString.call(v) === '[object Object]'
}

/**
 * Create and send an error event
 *
 * @method Span#error
 * @param {object} data Key/Value pairs to add to event
 *
 * @example
 * span.error(error)
 */
Span.prototype.error = function (error) {
  log.span(`span.error on ${this.name}`);

  try {
    error = Span.toError(error)
    if (!error) {
      log.info('invalid input to span.error(...)')
      return
    }

    this._internal('error', {error: error})
  } catch (e) {
    log.error(`${this.name} span failed to send error event`, e.stack)
  }
}

/**
 * Set a function that determines whether an error is reported or not. This
 * is for internal use only.
 *
 * @method Span#setIgnoreErrorFn
 * @param {Error} err the error to evaluate
 * @returns {boolean} truthy to ignore the error
 * @ignore
 *
 * @example
 * span.setIgnoreErrorFn(function (err) {
 *   // return true to ignore the error.
 *   return err.code === 'ENOENT';
 * })
 */
Span.prototype.setIgnoreErrorFn = function setIgnoreErrorFn (fn) {
  if (this.ignoreErrorFn) {
    log.warn(`resetting ignoreErrorFn for ${this.name}`);
  }
  this.ignoreErrorFn = fn;
}

//
// This is not really associated with a Span now so make it static.
//
Span.sendNonHttpSpan = function (txname, duration, error) {
  const args = {
    txname: txname,
    //domain: ao.cfg.domainPrefix ? ao.getDomainPrefix(req) : '',
    duration: duration,
    error: !!error
  }

  const finalTxName = ao.reporter.sendNonHttpSpan(args);

  // if it's good and not a null string return it.
  if (typeof finalTxName === 'string' && finalTxName) {
    return finalTxName;
  }

  // if it wasn't a string then it should be a numeric code. worst
  // case is that it is a null string.
  dbSendError.log(`sendNonHttpSpan() code ${finalTxName}`);


  // try to return a valid transaction name of some sort. it doesn't really
  // matter because it wasn't sent no matter what it was.
  return args.txname || 'unknown';
}

//
// Given rootOpts return the transaction name. Only root spans
// have transaction names.
//
Span.prototype.getTransactionName = function () {
  let txname
  if (this.customTxName) {
    if (typeof this.customTxName === 'string') {
      txname = this.customTxName
    } else if (typeof this.customTxName === 'function') {
      try {
        // if the user needs context they need to create a closure.
        txname = this.customTxName()
      } catch (e) {
        log.error('customTxName function %s', e)
      }
    }
  }
  if (!txname) {
    txname = this.defaultTxName
  }
  return txname
}

//
// Convert a string to an error, return an Error instance
// or return undefined.
//
Span.toError = function (error) {
  // error can be a string or Error
  if (typeof error === 'string') {
    return new Error(error)
  }

  if (error instanceof Error) {
    return error
  }
}

// because this module is invoked before the ao object is initialized
// data required from ao must be deferred until init is called.
Span.init = function (populatedAo) {
  ao = populatedAo;
  ao._stats.span = stats;
  log = ao.loggers;
  dbSendError = new ao.loggers.Debounce('error');
}

module.exports = Span;
