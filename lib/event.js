'use strict'

const util = require('util');

let ao;
let aob;
let log;

const unsentEvents = new Map();  // Map() for debugging

const stats = {
  created: 0,               // total events created
  active: 0,                // event.send() has not been called
  sent: 0,                  // event.send() has been called
}

/**
 * Create an event
 *
 * @class Event
 * @param {string} span name of the event's span
 * @param {string} label Event label (usually entry or exit)
 * @param {aob.Event} parent supplies the taskId to construct the event from.
 * @param {boolean} edge This should edge back to the parent
 */
function Event (span, label, parent, edge) {
  // All KV pairs become oboe's BSON data and used to be properties directly on
  // each Event instance. They were distinguished by being enumerable while all
  // private properties were defined using Object.defineProperty(). All KV data
  // is now kept in the kv property to avoid hidden class creation. Layer and
  // Label are so commonly used that they remain direct properties of the Event
  // instances but are duplicated in the kv object so they don't require special
  // treatment.
  this.Layer = span;
  this.Label = label;

  // there is always a "parent" event but it might be a "foster" parent,
  // i.e., an event that provides the task ID but isn't a real parent.
  // in that case "edge" is false.

  // create event inheriting the task id from parent.
  const event = new aob.Event(parent, !!edge);

  // aob.Event() will add an edge to the parent if edge is true.
  if (edge) {
    log.event.edge('%e added edge %e', this, parent);
  }

  this.event = event
  this.ignore = false
  this.sent = false

  this._edges = []

  const getEdge = (target, prop) => target[prop]
  const setEdge = (target, prop, val, recv) => {
    if (prop === 'length') {
      target.length = val
      return true
    }
    let taskId = val
    if (val) {
      // if it's an event let toString() return the task ID directly. if not
      // presume it's something that can be stringified even if it's a string.
      if (val.event) {
        taskId = val.event.toString(2);
      } else {
        taskId = val.toString().slice(2, 42);
      }
    }

    if (this.taskId !== taskId) {
      // if not sampling log at debug level even though it's unexpected.
      const level = this.event.getSampleFlag() ? 'error' : 'debug';
      log[level]('task IDs don\'t match this %e vs edge %s)', this, taskId);
      return true
    }
    target[prop] = val
    return true
  }

  Object.defineProperty(this, 'edges', {
    value: new Proxy(this._edges, {
      get: getEdge,
      set: setEdge
    })
  })

  // object where kv pairs are stored now.
  this.kv = {
    Layer: span,
    Label: label
  }

  if (unsentEvents && span !== 'skeleton') {
    unsentEvents.set(this, this.event.toString());
  }
  stats.created += 1;
  stats.active += 1;
  log.event.create('created event %e', this);
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

    this.kv.ErrorClass = err.constructor.name
    this.kv.ErrorMsg = err.message
    this.kv.Backtrace = err.stack
    log.event.set(`${this} set error to "${this.ErrorMsg}"`)
  }
})

/**
 * Get taskId from native event
 *
 * @property {string} taskId
 * @memberof Event
 * @readOnly
 */
Object.defineProperty(Event.prototype, 'taskId', {
  get () {
    return this.event.toString(2)
  }
})

/**
 * Get opId from native event string
 *
 * @property {string} opId
 * @memberof Event
 * @readOnly
 */
Object.defineProperty(Event.prototype, 'opId', {
  get () {
    return this.event.toString(4)
  }
})

const getEvent = util.deprecate(() => ao.lastEvent, 'use ao.lastEvent instead of Event.last');
const setEvent = util.deprecate(event => ao.lastEvent = event, 'use ao.lastEvent instead of Event.last');

Object.defineProperty(Event, 'last', {
  get: getEvent,
  set: setEvent,
});

/**
 * Set key-value pairs on this event
 *
 * @method Event#set
 * @param {object} data Key/Value pairs of info to add to event
 */
Event.prototype.set = function (data) {
  const valid = {string: true, boolean: true, number: true}
  for (const k in data) {
    if (typeof data[k] in valid && !Number.isNaN(data[k])) {
      this.kv[k] = data[k]
    } else if (k === 'error' && data[k] instanceof Error) {
      // use the setter to decompose the error into appropriate keys
      this.error = data[k]
    } else {
      const type = Number.isNaN(data[k]) ? 'NaN' : typeof data[k]
      const stack = ao.stack(`Invalid type for KV ${k}: ${type}`);
      log.error(stack);
    }
  }
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
Event.prototype.toString = function () {
  return this.event.toString()
}

/**
 * Send this event to the reporter
 *
 * @method Event#sendReport
 * @param {object} data - additional key-value pairs to send
 */
Event.prototype.sendReport = function (data) {
  stats.sent += 1;
  stats.active -= 1;

  // if it's been sent there's nothing to do
  if (this.sent) {
    log.debug('event already sent: %e', this)
    return
  }

  if (unsentEvents && this.Layer !== 'skeleton') {
    if (!unsentEvents.has(this)) {
      log.debug(`expected to find ${this} in unsentEvents`);
    } else {
      unsentEvents.delete(this);
    }
  }

  // if it's ignored then we can't continue from it, so don't set
  // last event.
  if (!this.ignore) {
    log.event.send('setting last event to: %e', this)
    ao.lastEvent = this
  }

  // if not sampling return now that ao.lastEvent has been set (unless ignored).
  if (!this.event.getSampleFlag()) {
    log.event.send('not sampling so not sending %e', this)
    return
  }

  // Set data, if supplied
  if (typeof data === 'object') {
    this.set(data)
  }

  this.send()
}

Event.prototype.send = function () {
  this.addKvPairs();

  // Add any edges into oboe's context.
  const edges = this._edges;
  const len = edges.length;
  const event = this.event;

  for (let i = 0; i < len; i++) {
    let edge = edges[i]
    if (!edge) {
      log.error('%e tried to add empty edge', this)
      continue
    }

    if (edge.event) {
      edge = edge.event
    }

    try {
      event.addEdge(edge)
      log.event.edge('%e added edge %e', this, edge)
    } catch (e) {
      log.error('%e failed to add edge %e', this, e)
    }
  }

  // Send the event
  const status = event.sendReport();
  if (status < 0) {
    log.error(`%e failed (${status}) to send to reporter`, this)
  } else {
    log.event.send('sent to reporter => %e', this)
  }

  this.sent = true
}

// TODO BAM potentially remove this - used only by init.
Event.prototype.sendStatus = function (kvpairs) {
  stats.sent += 1;
  stats.active -= 1;

  // store the kvpairs in the event
  this.set(kvpairs);
  // add them to oboe's event
  this.addKvPairs();

  try {
    this.event.sendStatus();
  } catch (e) {
    log.error('failed to send status message', e)
  }

  if (unsentEvents && this.Layer !== 'skeleton') {
    if (!unsentEvents.has(this)) {
      log.debug(`expected to find ${this} in unsentEvents`);
    } else {
      unsentEvents.delete(this);
    }
  }

}

//
// Add the KV pairs stored in the agent event to oboe's event structure.
//
Event.prototype.addKvPairs = function () {
  const keys = Object.keys(this.kv)
  const event = this.event
  const len = keys.length

  for (let i = 0; i < len; i++) {
    const key = keys[i]
    const val = this.kv[key]
    try {
      event.addInfo(key, val)
      log.event.change(`{this} set ${key} = ${val}`)
    } catch (e) {
      // don't log null Layer for info events as errors.
      if (key !== 'Layer' || val !== null && this.Label !== 'info') {
        log.error(`failed to set ${key} = ${val} for %e - %s`, this, e.stack)
      }
    }
  }
}

Event.incrementStats = function (n = 1, skeys = ['created', 'active']) {
  for (let i = 0; i < skeys.length; i++) {
    stats[skeys[i]] += n;
  }
}

Event.init = function (populatedAo) {
  ao = populatedAo;
  ao._stats.event = stats;
  ao._stats.unsentEvents = unsentEvents;
  aob = ao.addon;
  log = ao.loggers;

  log.addGroup({
    groupName: 'event',
    subNames: ['create', 'send', 'enter', 'change', 'edge', 'set', 'state']
  });
}

module.exports = Event;

