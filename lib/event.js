'use strict'

const util = require('util');

let ao;
let aob;
let log;

let eventsCreated = 0;
let eventsSampled = 0;
let eventsSent = 0;
let eventsSendFailed = 0;
let eventsBytesSent = 0;

/**
 * Create an event
 *
 * An event is agent metadata with all the KV pairs and edges for the event.
 *
 * @class Event
 * @param {string} span name of the event's span
 * @param {string} label Event label (usually entry or exit)
 * @param {Metabuf} parent Metadata to use to construct the event.
 * @param {boolean} edge Add an edge back to the parent.
 */
function Event (span, label, parent, edge) {
  if (!(parent instanceof ao.MB)) {
    throw new Error('Event() requires parent to be Metadata');
  }

  this.parent = parent;
  this.mb = new ao.MB(parent);

  // All KV pairs become oboe's BSON data and used to be kept as properties on
  // each Event instance. They were distinguished by being enumerable while all
  // private properties were defined using Object.defineProperty(). All KV data
  // is now kept in the kv property to avoid hidden class creation. Layer and
  // Label are so commonly used that they remain direct properties of the Event
  // instances but are duplicated in the kv object so they don't require special
  // treatment.
  this.Layer = span;
  this.Label = label;

  // this used to create an oboe event structure and wrap it in an c++ class called
  // from javascript. that's relatively slow stuff, so now metadata is a Metabuf,
  // a thinly wrapped Buffer with a few additions for formatting and manipulating
  // specific metadata fields, like flags.
  //
  // the metadata is only converted into an oboe event when it is sent.
  //
  // oboe_event_init(&event, &metadata, &opid);         // use my own metadata and op id
  // oboe_event_add_info<type>(& event, key, value);    // for all agent KV & also timestamp & hostname
  // oboe_event_add_edge()         // if required.
  //

  this.ignore = false;
  this.sent = false;
  this._edges = [];
  this.sampling = !!(this.mb.getFlags() & 0x01);

  if (this.sampling) {
    eventsSampled += 1;
  }

  if (edge) {
    this.addEdge(parent);
  }

  // object where kv pairs are stored now.
  this.kv = {
    Layer: span,
    Label: label,
  };

  log.event.create('created event %e', this);
  eventsCreated += 1;
}

Event.prototype.addEdge = function addEdge (mb) {
  // duck type-check for an event instead of a metabuf
  if (mb.mb) {
    mb = mb.mb;
  }
  if (!this.mb.taskIdsMatch(mb)) {
    // if not sampling log at debug level because the mistmatch doesn't matter.
    const level = this.sampling ? 'error' : 'debug';
    log[level]('task IDs don\'t match this %e vs edge %e)', this, mb);
    return false;
  }
  log.event.edge('%e added edge %e', this, mb);
  this._edges.push(mb);
  return true;
}


/**
 * The error instance if an error occurs in the event
 *
 * @property {Error} error
 * @memberof Event
 */
Object.defineProperty(Event.prototype, 'error', {
  set (err) {
    log.event.set(`${this} setting error`)

    // Allow string errors
    if (typeof err === 'string') {
      err = new Error(err)
    }

    if (!(err instanceof Error)) {
      log.event.set(`${this} set error with non-error, non-string type`)
      return
    }

    this.addKVs({
      ErrorClass: err.constructor.name,
      ErrorMsg: err.message,
      Backtrace: err.stack,
    })
    log.event.set(`${this} set error to "${this.ErrorMsg}"`)
  }
})

/**
 * Get taskId from the event
 *
 * @property {string} taskId
 * @memberof Event
 * @readOnly
 */
Object.defineProperty(Event.prototype, 'taskId', {
  get () {
    return this.mb.toString(2)
  }
});

/**
 * Get opId from the event
 *
 * @property {string} opId
 * @memberof Event
 * @readOnly
 */
Object.defineProperty(Event.prototype, 'opId', {
  get () {
    return this.mb.toString(4)
  }
});

/**
 * Get sample flag from the event. Compatibility function.
 */
Event.prototype.getSampleFlag = function getSampleFlag () {
  return this.sampling;
}

const lastGetter = util.deprecate(function () {return ao.lastEvent},
  'reading Event.last is deprecated, use ao.lastEvent');
const lastSetter = util.deprecate(function (value) {ao.lastEvent = value},
  'setting Event.last is deprecated, use ao.lastEvent');
/**
 * The last reported event in the active context
 *
 * @property {Event} Event.last
 * @deprecated
 */
Object.defineProperty(Event, 'last', {
  get () {
    return lastGetter();
  },
  set (value) {
    lastSetter(value);
  }
});

/**
 * Add key-value pairs to this event. They will be sent when the
 * event is exited.
 *
 * @method Event#addKVs
 * @param {object} data Key/Value pairs of info to add to event
 */
Event.prototype.addKVs = function (kvs) {
  const valid = {string: true, boolean: true, number: true}
  for (const k in kvs) {
    if (typeof kvs[k] in valid && !Number.isNaN(kvs[k])) {
      this.kv[k] = kvs[k]
    } else if (k === 'error' && kvs[k] instanceof Error) {
      // use the setter to decompose the error into appropriate keys
      this.error = kvs[k]
    } else {
      const type = Number.isNaN(kvs[k]) ? 'NaN' : typeof kvs[k]
      const stack = ao.stack(`Invalid type for KV ${k}: ${type}`);
      log.error(stack);
    }
  }
}

Event.prototype.set = util.deprecate(function (data) {
  this.addKVs(data);
}, 'event.set() is deprecated; use event.addKVs()');

Event.prototype.deleteKV = function (kv) {
  delete this.kv[kv];
}


/**
 * Enter the context of this event
 *
 * @method Event#enter
 */
Event.prototype.enter = util.deprecate(function () {
  log.event.enter(`${this} entered`);
}, 'Event.prototype.enter() is deprecated; it is now a no-op');

/**
 * Get the X-Trace ID string of the event
 *
 * @method Event#toString
 */
Event.prototype.toString = function (bits) {
  return this.mb.toString(bits)
}

/**
 * Send this event to the reporter
 *
 * @method Event#send
 * @param {object} data - additional key-value pairs to send
 */
Event.prototype.send = function (kvpairs) {
  // if it's been sent there's nothing to do
  if (this.sent) {
    log.debug('event already sent: %e', this)
    return
  }

  // if it's ignored then we can't continue from it, so don't set
  // last event.
  if (!this.ignore) {
    log.event.enter('setting last event to: %e', this)
    ao.lastEvent = this;
  }

  // if not sampling return now that lastEvent has been set (unless ignored).
  if (!this.sampling) {
    log.event.enter('not sampling so not sending %e', this)
    return
  }

  // Set data, if supplied
  if (typeof kvpairs === 'object') {
    this.addKVs(kvpairs)
  }

  // add the time-of-day timestamp.
  this.kv.Timestamp_u = ao.getUnixTimeMicroSeconds();

  // pass this object to C++ code where it will be transformed into the form
  // required by oboe and then sent.
  const result = aob.Event.send(this);

  // status will change dramatically - similar to sendMetrics() - multiple errors
  // can be returned.
  if (result.status !== true) {
    log.error('event.send(%e) failed', this, result.errors);
    eventsSendFailed += 1;
  } else {
    log.event.send('sent to reporter => %e', this)
    eventsSent += 1;
  }

  eventsBytesSent += result.bsonSize;

  this.sent = true
}

Event.getMetrics = function () {
  return {
    eventsCreated,
    eventsSampled,
    eventsSent,
    eventsSendFailed,
    eventsBytesSent,
  }
}

Event.init = function (populatedAo) {
  ao = populatedAo;
  aob = ao.addon;
  log = ao.loggers;

  log.addGroup({
    groupName: 'event',
    subNames: ['create', 'send', 'enter', 'change', 'edge', 'set', 'state']
  });
}

module.exports = Event;

