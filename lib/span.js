'use strict'

const util = require('util');
const Event = require('./event')
let ao;
let log;
let dbSendError;

let spansCreated = 0;
let spansSampled = 0;
let spansTopSpanEnters = 0;
let spansTopSpanExits = 0;
let spansTopSpanTime = 0;

/**
 * Create an execution span.
 *
 * @class Span
 * @param {string} name Span name
 * @param {object} settings Settings returned from getTraceSettings()
 * @param {metadata} [settings.metadata] an addon.Metadata instance to create the events from.
 *     Events will have the same task ID and sample bit but unique op IDs. This value is set
 *     by getTraceSettings() and must be present.
 * @param {boolean} [settings.edge=true] the entry event of this span should edge back to the
 *     metadata. The only time this is not true is when the span being created is a new top
 *     level span not being continued from an inbound X-Trace ID. This must be set explicitly
 *     to a falsey value; it's absence is true.
 * @param {object} [data] Key/Value pairs of info to add to event
 *
 * @example
 * var span = new Span('fs', ao.lastEvent, {
 *   File: file
 * })
 */
function Span (name, settings, data) {
  this.descended = false
  this.parent = undefined;
  this._async = false
  this.name = name
  this.events = {
    internal: {push () {}},          // hook used for testing
    entry: null,
    exit: null
  }

  if (!name || typeof name !== 'string') {
    throw new TypeError(`invalid span name ${name}`)
  }

  spansCreated += 1;

  // the sampling state needs to be in each span because it is used
  // to avoid expensive operations, e.g., collecting backtraces, when
  // not sampling.
  this.doSample = !!(settings.metadata.getFlags() & 1);
  if (this.doSample) {
    spansSampled += 1;
  }

  // not a top, i.e., entry span
  this.topSpan = false
  this.doMetrics = false

  // it is possible to ignore some errors. the only error that customers have
  // requested to be able to ignore is ENOENT because their application looks for
  // files at startup but it's not really an error for them to not be found.
  // in order to ignore an error the probe must call Span.setErrorsToIgnoreFunction().
  this.ignoreErrorFn = undefined;

  const edge = 'edge' in settings ? settings.edge : true

  const entry = new Event(name, 'entry', settings.metadata, edge)
  const exit = new Event(name, 'exit', entry.mb, true)

  entry.addKVs(data)

  this.events.entry = entry
  this.events.exit = exit
}

const lastGetter = util.deprecate(function () {return ao.lastSpan},
  'reading ao.lastSpan is deprecated, use ao.lastSpan');
const lastSetter = util.deprecate(function (value) {ao.lastSpan = value},
  'setting Span.last is deprecated, use ao.lastSpan');
/**
 * The last reported span in the active context
 *
 * @property {Span} Span.last
 * @deprecated
 */
Object.defineProperty(Span, 'last', {
  get () {
    return lastGetter();
  },
  set (value) {
    lastSetter(value);
  }
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
  log.span('Span.makeEntrySpan %s from inbound %x', name, settings.metadata)

  // use the metadata from settings or (used in testing) make new.
  const metadata = settings.metadata || ao.MB.makeRandom(settings.doSample);

  const span = new Span(name, {metadata, edge: settings.edge}, kvpairs)

  // override default properties with entry-span-specific properties.
  span.topSpan = true;
  span.doMetrics = settings.doMetrics
  span.events.entry.addKVs({
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
  log.span('span.descend %s from ao.lastEvent %e', name, last)
  const span = new Span(name, {metadata: last.mb}, data)

  // fill in descended-span-specific properties.
  span.parent = this
  span.descended = true
  return span
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
        this.events.entry.addKVs({Async: true});
      } else {
        this.events.entry.deleteKV('Async');
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
    ctx = ao.tContext.createContext({newContext: this.topSpan});
    ao.tContext.enter(ctx)
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

      if (span.topSpan && span.doMetrics) {
        const txname = span.getTransactionName()
        const et = (Date.now() - startTime) * 1000;        // convert to microseconds for collector
        spansTopSpanTime += et;
        const finaltxname = Span.sendNonHttpSpan(txname, et, err)
        kvpairs.TransactionName = finaltxname
        if (txname !== finaltxname) {
          log.warn('Span.runAsync txname mismatch: %s !== %s', txname, finaltxname)
        }
      }

      span.exitWithError(err, kvpairs)
    }

    return cb.apply(this, arguments)
  }))

  try {
    ao.tContext.exit(ctx)
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
    if (!this.descended) {
      ctx = ao.tContext.createContext({newContext: this.topSpan});
      ao.tContext.enter(ctx)
    }
  } catch (e) {
    log.error(`${this.name} span failed to enter context`, e.stack)
  }

  if (this.doMetrics) {
    startTime = new Date().getTime()
  }

  this.enter()
  try {
    return fn.call(this)
  } catch (err) {
    error = err
    this.setExitError(err)
    throw err
  } finally {
    if (this.topSpan && this.doMetrics) {
      const txname = this.getTransactionName()
      const et = (new Date().getTime() - startTime) * 1000
      spansTopSpanTime += et;
      const finaltxname = Span.sendNonHttpSpan(txname, et, error)
      kvpairs.TransactionName = finaltxname
      if (txname !== finaltxname) {
        log.warn('Span.runAsync txname error: %s !== %s', txname, finaltxname)
      }
    }

    this.exit(kvpairs)

    try {
      if (ctx) {
        ao.tContext.exit(ctx)
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
    ao.tContext.set('topSpan', this);
    spansTopSpanEnters += 1;
  }


  try {
    ao.lastSpan = this
    const {entry} = this.events

    // Send the entry event
    entry.send(data)
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
  log.span('span.exit for %e', this.events.exit);
  if (this.topSpan) {
    ao.tContext.set('topSpan', undefined);
    ao.lastSpan = null;
    spansTopSpanExits += 1;
  }

  try {
    const {exit} = this.events

    // Edge back to previous event, if not already connected
    const last = ao.lastEvent;
    if (last && last !== this.events.entry && !exit.ignore) {
      exit.addEdge(last.mb);
    } else if (!last) {
      log.debug('span.exit - no last event %l', this)
    } else {
      log.span('span.exit - no extra edge found for %e', exit)
    }

    // Send the exit event
    exit.send(data)
  } catch (e) {
    log.error(`${this.name} span failed to exit`, e.stack)
  }
}

/**
 * Send the exit event with an error status
 *
 * @method Span#exitWithError
 * @param {Error} err - Error to add to event
 * @param {object} data - Key/Value pairs of info to add to event
 */
Span.prototype.exitWithError = function (error, data) {
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
 *     span._internal('info', {Foo: 'bar'})
 *
 * @method Span#_internal
 * @param {String} label Event type label
 * @param {Object} kvpairs Key/Value pairs to add to event
 */
Span.prototype._internal = function (label, kvpairs) {
  const last = ao.lastEvent;
  if (!last) {
    log.error(`${this.name} span ${label} call could not find last event`)
    return
  }

  const event = new Event(null, label, last.mb, true)
  this.events.internal.push(event)

  // because the layer is null oboe will return an error when trying to add it.
  event.deleteKV('Layer');

  // Send the exit event
  event.send(kvpairs)
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

Span.getMetrics = function () {
  return {
    spansCreated,
    spansSampled,
    spansTopSpanEnters,
    spansTopSpanExits,
    spansTopSpanTime,
  }
}


// because this module is invoked before the ao object is initialized
// data required from ao must be deferred until init is called.
Span.init = function (populatedAo) {
  ao = populatedAo;
  log = ao.loggers;
  dbSendError = new ao.loggers.Debounce('error');
}

module.exports = Span;
