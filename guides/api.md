## Classes

<dl>
<dt><a href="#ao">ao</a></dt>
<dd></dd>
<dt><a href="#Span">Span</a></dt>
<dd></dd>
<dt><a href="#Event">Event</a></dt>
<dd></dd>
</dl>

## Typedefs

<dl>
<dt><a href="#TraceSettings">TraceSettings</a> : <code>object</code></dt>
<dd></dd>
<dt><a href="#spanInfo">spanInfo</a> : <code>object</code></dt>
<dd></dd>
<dt><a href="#spanInfoFunction">spanInfoFunction</a> ⇒ <code><a href="#spanInfo">spanInfo</a></code></dt>
<dd></dd>
<dt><a href="#metric">metric</a> : <code>object</code></dt>
<dd></dd>
<dt><a href="#SendMetricsReturn">SendMetricsReturn</a> : <code>object</code></dt>
<dd></dd>
</dl>

<a name="ao"></a>

## ao
**Kind**: global class  

* [ao](#ao)
    * [.logLevel](#ao.logLevel)
    * [.serviceKey](#ao.serviceKey)
    * [.loggers](#ao.loggers)
    * [.traceMode](#ao.traceMode)
    * [.tracing](#ao.tracing)
    * [.traceId](#ao.traceId)
    * [.lastEvent](#ao.lastEvent)
    * [.lastSpan](#ao.lastSpan)
    * [.logLevelAdd(levels)](#ao.logLevelAdd) ⇒ <code>string</code> \| <code>undefined</code>
    * [.logLevelRemove(levels)](#ao.logLevelRemove) ⇒ <code>string</code> \| <code>undefined</code>
    * [.backtrace()](#ao.backtrace) ⇒ <code>string</code>
    * [.bind(fn)](#ao.bind) ⇒ <code>function</code>
    * [.bindEmitter(em)](#ao.bindEmitter) ⇒ <code>EventEmitter</code>
    * [.setCustomTxNameFunction(probe, fn)](#ao.setCustomTxNameFunction) ⇒ <code>boolean</code>
    * [.readyToSample(ms, [obj])](#ao.readyToSample) ⇒ <code>boolean</code>
    * [.sampling(item)](#ao.sampling) ⇒ <code>boolean</code>
    * [.stringToMetadata(xtrace)](#ao.stringToMetadata) ⇒ <code>Metabuf</code> \| <code>null</code>
    * [.instrumentHttp(span, run, [options], res)](#ao.instrumentHttp) ⇒
    * [.instrument(span, run, [options], [callback])](#ao.instrument) ⇒ <code>value</code>
    * [.pInstrument(span, run, [options])](#ao.pInstrument) ⇒ <code>Promise</code>
    * [.startOrContinueTrace(xtrace, span, runner, [opts], [callback])](#ao.startOrContinueTrace) ⇒ <code>value</code>
    * [.pStartOrContinueTrace(xtrace, span, run, [opts])](#ao.pStartOrContinueTrace) ⇒ <code>Promise</code>
    * [.reportError(error)](#ao.reportError)
    * [.reportInfo(data)](#ao.reportInfo)
    * ~~[.sendMetric(name, [options])](#ao.sendMetric) ⇒ <code>number</code>~~
    * [.sendMetrics(metrics, [gopts])](#ao.sendMetrics) ⇒ [<code>SendMetricsReturn</code>](#SendMetricsReturn)
    * [.getFormattedTraceId()](#ao.getFormattedTraceId) ⇒ <code>string</code>
    * [.insertLogObject([object])](#ao.insertLogObject) ⇒ <code>object</code>

<a name="ao.logLevel"></a>

### ao.logLevel
**Kind**: static property of [<code>ao</code>](#ao)  
**Properties**

| Type | Description |
| --- | --- |
| <code>string</code> | comma separated list of log settings |

**Example** *(Sets the log settings)*  
```js
ao.logLevel = 'warn,error'
```
**Example** *(Get the log settings)*  
```js
var settings = ao.logLevel
```
<a name="ao.serviceKey"></a>

### ao.serviceKey
**Kind**: static property of [<code>ao</code>](#ao)  
**Properties**

| Type | Description |
| --- | --- |
| <code>string</code> | the service key |

<a name="ao.loggers"></a>

### ao.loggers
Expose debug logging global and create a function to turn
logging on/off.

**Kind**: static property of [<code>ao</code>](#ao)  
**Properties**

| Type | Description |
| --- | --- |
| <code>object</code> | the loggers available for use |

<a name="ao.traceMode"></a>

### ao.traceMode
Get and set the trace mode

**Kind**: static property of [<code>ao</code>](#ao)  
**Properties**

| Type | Description |
| --- | --- |
| <code>string</code> | the sample mode |

<a name="ao.tracing"></a>

### ao.tracing
Return whether or not the current code path is being traced.

**Kind**: static property of [<code>ao</code>](#ao)  
**Read only**: true  
**Properties**

| Type |
| --- |
| <code>boolean</code> | 

<a name="ao.traceId"></a>

### ao.traceId
Get X-Trace ID of the last event

**Kind**: static property of [<code>ao</code>](#ao)  
**Read only**: true  
**Properties**

| Type | Description |
| --- | --- |
| <code>string</code> | the trace ID as a string or undefined if not tracing. |

<a name="ao.lastEvent"></a>

### ao.lastEvent
The last reported event in the active context

**Kind**: static property of [<code>ao</code>](#ao)  
**Properties**

| Type | Description |
| --- | --- |
| [<code>Event</code>](#Event) | the last event sent in the active context. |

<a name="ao.lastSpan"></a>

### ao.lastSpan
The last span that was entered in the active context

**Kind**: static property of [<code>ao</code>](#ao)  
**Properties**

| Name | Type |
| --- | --- |
| ao.lastSpan | [<code>Span</code>](#Span) | 

<a name="ao.logLevelAdd"></a>

### ao.logLevelAdd(levels) ⇒ <code>string</code> \| <code>undefined</code>
Add log levels to the existing set of log levels.

**Kind**: static method of [<code>ao</code>](#ao)  
**Returns**: <code>string</code> \| <code>undefined</code> - - the current log levels or undefined if an error  

| Param | Type | Description |
| --- | --- | --- |
| levels | <code>string</code> | comma separated list of levels to add |

**Example**  
```js
ao.logLevelAdd('warn,debug')
```
<a name="ao.logLevelRemove"></a>

### ao.logLevelRemove(levels) ⇒ <code>string</code> \| <code>undefined</code>
Remove log levels from the current set.

**Kind**: static method of [<code>ao</code>](#ao)  
**Returns**: <code>string</code> \| <code>undefined</code> - - log levels after removals or undefined if an
                             error.  

| Param | Type | Description |
| --- | --- | --- |
| levels | <code>string</code> | comma separated list of levels to remove |

**Example**  
```js
var previousLogLevel = ao.logLevel
ao.logLevelAdd('debug')
ao.logLevelRemove(previousLogLevel)
```
<a name="ao.backtrace"></a>

### ao.backtrace() ⇒ <code>string</code>
Generate a backtrace string

**Kind**: static method of [<code>ao</code>](#ao)  
**Returns**: <code>string</code> - the backtrace  
<a name="ao.bind"></a>

### ao.bind(fn) ⇒ <code>function</code>
Bind a function to the CLS context if tracing.

**Kind**: static method of [<code>ao</code>](#ao)  
**Returns**: <code>function</code> - The bound function or the unmodified argument if it can't
  be bound.  

| Param | Type | Description |
| --- | --- | --- |
| fn | <code>function</code> | The function to bind to the context |

<a name="ao.bindEmitter"></a>

### ao.bindEmitter(em) ⇒ <code>EventEmitter</code>
Bind an emitter if tracing

**Kind**: static method of [<code>ao</code>](#ao)  
**Returns**: <code>EventEmitter</code> - The bound emitter or the original emitter if an error.  

| Param | Type | Description |
| --- | --- | --- |
| em | <code>EventEmitter</code> | The emitter to bind to the trace context |

<a name="ao.setCustomTxNameFunction"></a>

### ao.setCustomTxNameFunction(probe, fn) ⇒ <code>boolean</code>
Set a custom transaction name function for a specific probe. This is
most commonly used when setting custom names for all or most routes.

**Kind**: static method of [<code>ao</code>](#ao)  
**Returns**: <code>boolean</code> - true if successfully set else false  

| Param | Type | Description |
| --- | --- | --- |
| probe | <code>string</code> | The probe to set the function for |
| fn | <code>function</code> | A function that returns a string custom name or a                        falsey value indicating the default should be used.                        Pass a falsey value for the function to clear. |

**Example**  
```js
// custom transaction function signatures for supported probes:
express: customFunction (req, res)
hapi: customFunction (request)
```
<a name="ao.readyToSample"></a>

### ao.readyToSample(ms, [obj]) ⇒ <code>boolean</code>
Check whether the appoptics agent is ready to sample. It will wait up to
the specified number of milliseconds before returning.

**Kind**: static method of [<code>ao</code>](#ao)  
**Returns**: <code>boolean</code> - - true if ready to sample; false if not  

| Param | Type | Description |
| --- | --- | --- |
| ms | <code>Number</code> | milliseconds to wait; default 0 means don't wait (poll). |
| [obj] | <code>Object</code> | if present obj.status will receive low level status |

<a name="ao.sampling"></a>

### ao.sampling(item) ⇒ <code>boolean</code>
Determine if the sample flag is set for the various forms of
metadata.

**Kind**: static method of [<code>ao</code>](#ao)  
**Returns**: <code>boolean</code> - - true if the sample flag is set else false.  

| Param | Type | Description |
| --- | --- | --- |
| item | <code>string</code> \| [<code>Event</code>](#Event) \| <code>Metabuf</code> | the item to get the sampling flag of |

<a name="ao.stringToMetadata"></a>

### ao.stringToMetadata(xtrace) ⇒ <code>Metabuf</code> \| <code>null</code>
Convert an xtrace ID to metadata in the form of Metabuf.

**Kind**: static method of [<code>ao</code>](#ao)  
**Returns**: <code>Metabuf</code> \| <code>null</code> - - Metabuf object if successful, else null.  

| Param | Type | Description |
| --- | --- | --- |
| xtrace | <code>string</code> | X-Trace ID, string version of Metadata. |

<a name="ao.instrumentHttp"></a>

### ao.instrumentHttp(span, run, [options], res) ⇒
Instrument HTTP request/response

**Kind**: static method of [<code>ao</code>](#ao)  
**Returns**: the value returned by the run function or undefined if it can't be run.  

| Param | Type | Description |
| --- | --- | --- |
| span | <code>string</code> \| [<code>spanInfoFunction</code>](#spanInfoFunction) | name or function returning spanInfo |
| run | <code>function</code> | code to instrument and run |
| [options] | <code>object</code> | options |
| [options.enabled] | <code>object</code> | enable tracing, on by default |
| [options.collectBacktraces] | <code>object</code> | collect backtraces |
| res | <code>HTTPResponse</code> | HTTP response to patch |

<a name="ao.instrument"></a>

### ao.instrument(span, run, [options], [callback]) ⇒ <code>value</code>
Apply custom instrumentation to a synchronous or async-callback function.

**Kind**: static method of [<code>ao</code>](#ao)  
**Returns**: <code>value</code> - the value returned by the run function or undefined if it can't be run  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| span | <code>string</code> \| [<code>spanInfoFunction</code>](#spanInfoFunction) |  | span name or span-info function     If `span` is a string then a span is created with that name. If it     is a function it will be run only if tracing; it must return a     spanInfo-compatible object - see instrumenting-a-module.md in guides/. |
| run | <code>function</code> |  | the function to instrument<br/><br/>     Synchronous `run` function:<br/>     the signature has no callback, e.g., `function run () {...}`. If a     synchronous `run` function throws an error appoptics will report that     error for the span and re-throw the error.<br/>     <br/>     Asynchronous `run` function:<br/>     the signature must include a done callback that is used to let     AppOptics know when your instrumented async code is done running,     e.g., `function run (done) {...}`. In order to report an error for     an async span the done function must be called with an Error object     as the argument. |
| [options] | <code>object</code> |  | options |
| [options.enabled] | <code>boolean</code> | <code>true</code> | enable tracing |
| [options.collectBacktraces] | <code>boolean</code> | <code>false</code> | collect stack traces. |
| [callback] | <code>function</code> |  | optional callback, if async |

**Example**  
```js
//
// A synchronous `run` function.
//
//   If the run function is synchronous the signature does not include
//   a callback, e.g., `function run () {...}`.
//

function spanInfo () {
  return {name: 'custom', kvpairs: {Foo: 'bar'}}
}

function run () {
  const contents = fs.readFileSync('some-file', 'utf8')
  // do things with contents
}

ao.instrument(spanInfo, run)
```
**Example**  
```js
//
// An asynchronous `run` function.
//
// Rather than callback directly, you give the done argument.
// This tells AppOptics when your instrumented code is done running.
//
// The `callback` function is the callback you normally would have given
// directly to the code you want to instrument. It receives the same
// arguments as were received by the `done` callback for the `run` function
// and the same `this` context is also applied to it.

function spanInfo () {
  return {name: 'custom', {Foo: 'bar'}}
}

function run (done) {
  fs.readFile('some-file', done)
}

function callback (err, data) {
  console.log('file contents are: ' + data)
}

ao.instrument(spanInfo, run, callback)
```
<a name="ao.pInstrument"></a>

### ao.pInstrument(span, run, [options]) ⇒ <code>Promise</code>
Apply custom instrumentation to a promise-returning asynchronous function.

**Kind**: static method of [<code>ao</code>](#ao)  
**Returns**: <code>Promise</code> - the value returned by the run function or undefined if it can't be run  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| span | <code>string</code> \| [<code>spanInfoFunction</code>](#spanInfoFunction) |  | span name or span-info function     If `span` is a string then a span is created with that name. If it     is a function it will be run only if tracing; it must return a     spanInfo-compatible object - see instrumenting-a-module.md in guides/. |
| run | <code>function</code> |  | the function to instrument<br/><br/>     This function must return a promise. |
| [options] | <code>object</code> |  | options |
| [options.enabled] | <code>boolean</code> | <code>true</code> | enable tracing |
| [options.collectBacktraces] | <code>boolean</code> | <code>false</code> | collect stack traces. |

**Example**  
```js
//
// A synchronous `run` function.
//
//   If the run function is synchronous the signature does not include
//   a callback, e.g., `function run () {...}`.
//

function spanInfo () {
  return {name: 'custom', kvpairs: {Foo: 'bar'}}
}

function run () {
  return axios.get('https://google.com').then(r => {
    ...
    return r;
  })
}

ao.pInstrument(spanInfo, run).then(...)
```
<a name="ao.startOrContinueTrace"></a>

### ao.startOrContinueTrace(xtrace, span, runner, [opts], [callback]) ⇒ <code>value</code>
Start or continue a trace. Continue is in the sense of continuing a
trace based on an X-Trace ID received from an external source, e.g.,
HTTP headers or message queue headers.

**Kind**: static method of [<code>ao</code>](#ao)  
**Returns**: <code>value</code> - the value returned by the run function or undefined if it can't be run  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| xtrace | <code>string</code> |  | X-Trace ID to continue from or null |
| span | <code>string</code> \| [<code>spanInfoFunction</code>](#spanInfoFunction) |  | name or function returning spanInfo |
| runner | <code>function</code> |  | run this function. sync if no arguments, async if one. |
| [opts] | <code>object</code> |  | options |
| [opts.enabled] | <code>boolean</code> | <code>true</code> | enable tracing |
| [opts.collectBacktraces] | <code>boolean</code> | <code>false</code> | collect backtraces |
| [opts.forceNewTrace] | <code>boolean</code> | <code>false</code> | force a new trace, ignoring any existing context (but not xtrace) |
| [opts.customTxName] | <code>string</code> \| <code>function</code> |  | name or function |
| [callback] | <code>function</code> |  | this is supplied as the callback if runner is async. |

**Example**  
```js
ao.startOrContinueTrace(
  null,
  'sync-span-name',
  functionToRun,           // synchronous so function takes no arguments
  {customTxName: 'special-span-name'}
)
```
**Example**  
```js
ao.startOrContinueTrace(
  null,
  'sync-span-name',
  functionToRun,
  // note - no context is provided for the customTxName function. If
  // context is required the caller should wrap the function in a closure.
  {customTxName: customNameFunction}
)
```
**Example**  
```js
// this is the function that should be instrumented
request('https://www.google.com', function realCallback (err, res, body) {...})
// because asyncFunctionToRun only accepts one parameter it must be
// wrapped, so the function to run becomes
function asyncFunctionToRun (cb) {
  request('https://www.google.com', cb)
}
// and realCallback is supplied as the optional callback parameter

ao.startOrContinueTrace(
  null,
  'async-span-name',
  asyncFunctionToRun,     // async, so function takes one argument
  // no options this time
  realCallback            // receives request's callback arguments.
)
```
<a name="ao.pStartOrContinueTrace"></a>

### ao.pStartOrContinueTrace(xtrace, span, run, [opts]) ⇒ <code>Promise</code>
Start or continue a trace running a function that returns a promise. Continue is in
the sense of continuing a trace based on an X-Trace ID received from an external
source, e.g., HTTP headers or message queue headers.

**Kind**: static method of [<code>ao</code>](#ao)  
**Returns**: <code>Promise</code> - the value returned by the run function or undefined if it can't be run  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| xtrace | <code>string</code> |  | X-Trace ID to continue from or null |
| span | <code>string</code> \| [<code>spanInfoFunction</code>](#spanInfoFunction) |  | name or function returning spanInfo |
| run | <code>function</code> |  | the promise-returning function to instrument |
| [opts] | <code>object</code> |  | options |
| [opts.enabled] | <code>boolean</code> | <code>true</code> | enable tracing |
| [opts.collectBacktraces] | <code>boolean</code> | <code>false</code> | collect backtraces |
| [opts.forceNewTrace] | <code>boolean</code> | <code>false</code> | ignore any existing context and force a new trace |
| [opts.customTxName] | <code>string</code> \| <code>function</code> |  | name or function |

**Example**  
```js
function spanInfo () {
  return {name: 'custom', kvpairs: {Foo: 'bar'}}
}

// axios returns a promise
function functionToRun () {
  return axios.get('https://google.com').then(r => {
    ...
    return r;
  })
}

ao.pStartOrContinueTrace(
  null,
  spanInfo,
  functionToRun,
).then(...)
```
<a name="ao.reportError"></a>

### ao.reportError(error)
Report an error event in the current trace.

**Kind**: static method of [<code>ao</code>](#ao)  

| Param | Type | Description |
| --- | --- | --- |
| error | <code>Error</code> | The error instance to report |

<a name="ao.reportInfo"></a>

### ao.reportInfo(data)
Report an info event in the current trace.

**Kind**: static method of [<code>ao</code>](#ao)  

| Param | Type | Description |
| --- | --- | --- |
| data | <code>object</code> | Data to report in the info event |

<a name="ao.sendMetric"></a>

### ~~ao.sendMetric(name, [options]) ⇒ <code>number</code>~~
***Deprecated***

**Kind**: static method of [<code>ao</code>](#ao)  
**Returns**: <code>number</code> - - (-1) for success else an error code.  
**Throws**:

- <code>TypeError</code> - if an invalid argument is supplied


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| name | <code>string</code> |  | the name of the metric |
| [options] | <code>object</code> |  |  |
| [options.count] | <code>number</code> | <code>1</code> | the number of observations being reported |
| [options.value] | <code>number</code> |  | if present the metric is value based and this                                   is the value, or sum of the values if count is                                   greater than 1 |
| [options.addHostTag] | <code>boolean</code> |  | add {host: hostname} to tags |
| [options.tags] | <code>object</code> |  | an object containing {tag: value} pairs |

**Example**  
```js
// simplest forms
ao.sendMetric('my.little.count')
ao.sendMetric('my.little.value', {value: 234.7})

// report two observations
ao.sendMetric('my.little.count', {count: 2})
ao.sendMetric('my.little.value', {count: 2, value: 469.4})

// to supply tags that can be used for filtering
ao.sendMetric('my.little.count', {tags: {status: error}})

// to have a host name tag added automatically
ao.sendMetric('my.little.count', {addHostTag: true, tags: {status: error}})
```
<a name="ao.sendMetrics"></a>

### ao.sendMetrics(metrics, [gopts]) ⇒ [<code>SendMetricsReturn</code>](#SendMetricsReturn)
Send custom metrics. There are two types of metrics:
1) count-based - the number of times something has occurred (no
                 value is associated with this type)
2) value-based - a specific value (or sum of values if count > 1).

**Kind**: static method of [<code>ao</code>](#ao)  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| metrics | [<code>metric</code>](#metric) \| [<code>Array.&lt;metric&gt;</code>](#metric) |  | a metric or an array of metrics |
| [gopts] | <code>object</code> |  | supply defaults to be applied to each metric. |
| [gopts.addHostTag] | <code>boolean</code> | <code>false</code> | add a hostname tag |
| [gopts.tags] | <code>object</code> |  | tags to add to each metric. the tags are     added as "metric.tags = Object.assign({}, gopts.tags, metric.tags)" |

**Example**  
```js
// send a single metric
ao.sendMetrics({name: 'my.counts.basic'});
ao.sendMetrics({name: 'my.values.some', value: 42.42});

// send multiple metrics (most efficient)
ao.sendMetrics([
  // default count is 1
  {name: 'my.counts.defaulted'},
  {name: 'my.counts.multiple', count: 3},
  {name: 'my.values.xyzzy', value: 10},
  // report two values for which the sum is 25.
  {name: 'my.values.xyzzy', count: 2, value: 25}
]);

// add tags that can be used for filtering on the host
ao.sendMetrics([
  {name: 'my.metric.end-of-file', tags: {class: 'error', subsystem: 'fs'}}
]);

// add a hostname tag automatically.
ao.sendMetrics([
  {name: 'my.metric.end-of-file', tags: {class: 'error'}, addHostTag: true}
]);

// add a hostname tag and an application tag to each metric.
ao.sendMetrics(
  [
    {name: 'my.metric', tags: {class: 'status'}},
    {name: 'my.time', value: 33.3, tags: {class: 'performance'}}
   ],
  {addHostTag: true, tags: {application: 'x'}}
);

// default class to 'status' for metrics that don't supply a class
// tag.
ao.sendMetrics(
  [
    {name: 'my.metric'},
    {name: 'my.time', value: 33.3, tags: {class: 'performance'}}
  ],
  {tags: {class: 'status'}}
);
```
<a name="ao.getFormattedTraceId"></a>

### ao.getFormattedTraceId() ⇒ <code>string</code>
Get the abbreviated trace ID format used for logs.

**Kind**: static method of [<code>ao</code>](#ao)  
**Returns**: <code>string</code> - - 40 character trace identifier - sample flag  
**Example**  
```js
//
// using morgan in express
//
const ao = require('appoptics');
const Express = require('express');
const app = new Express();
const morgan = require('morgan');

// define a format with a new token in it, 'trace-id' or a name of your choosing.
const logFormat = ':method :url :status :res[content-length] :trace-id - :response-time ms';
// define a token for the name used in the format. return
morgan.token('trace-id', function (req, res) {return ao.getFormattedTraceId();});
const logger = morgan(logFormat, {...});
app.use(logger);
// now the 42-character trace-id will be added to log entries.
```
<a name="ao.insertLogObject"></a>

### ao.insertLogObject([object]) ⇒ <code>object</code>
Insert the appoptics object containing a trace ID into an object. The primary intended use for this is
to auto-insert traceIds into JSON-like logs; it's documented so it can be used for unsupported logging
packages or by those wishing a higher level of control.

**Kind**: static method of [<code>ao</code>](#ao)  
**Returns**: <code>object</code> - - the object with the an additional property, ao, e.g., object.ao === {traceId: ...}.  

| Param | Type | Description |
| --- | --- | --- |
| [object] | <code>object</code> | inserts an ao log object containing a traceId property when conditions are met. |

**Example**  
```js
const ao = require('appoptics-apm');
const logger = require('pino')();

// with no object as an argument ao.insertLogObject returns {ao: {traceId: ...}}
logger.info(ao.insertLogObject(), 'not-so-important message');
```
**Example**  
```js
const ao = require('appoptics-apm');
const winston = require('winston');
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.splat(),
      winston.format.json()
    ),
    defaultMeta: {service: 'ao-log-example'},
    transports: [...]
})

logger.info(ao.insertLogObject({
    message: 'this object is being modified by insertLogObject',
    more: 'there will be an added ao property'
}))
```
<a name="Span"></a>

## Span
**Kind**: global class  

* [Span](#Span)
    * [new Span(name, settings, [data])](#new_Span_new)
    * _instance_
        * [.descend(name, data)](#Span+descend) ⇒ [<code>Span</code>](#Span)
        * [.run(fn)](#Span+run) ⇒
        * [.runAsync(fn)](#Span+runAsync) ⇒
        * [.runSync(fn)](#Span+runSync) ⇒
        * [.enter(data)](#Span+enter)
        * [.exit(data)](#Span+exit)
        * [.exitWithError(err, data)](#Span+exitWithError)
        * [.setExitError(err)](#Span+setExitError)
        * [.info(data)](#Span+info)
        * [.error(data)](#Span+error)
    * _static_
        * [.makeEntrySpan(name, settings, kvpairs)](#Span.makeEntrySpan)

<a name="new_Span_new"></a>

### new Span(name, settings, [data])
Create an execution span.


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| name | <code>string</code> |  | Span name |
| settings | <code>object</code> |  | Settings returned from getTraceSettings() |
| [settings.metadata] | <code>metadata</code> |  | an addon.Metadata instance to create the events from.     Events will have the same task ID and sample bit but unique op IDs. This value is set     by getTraceSettings() and must be present. |
| [settings.edge] | <code>boolean</code> | <code>true</code> | the entry event of this span should edge back to the     metadata. The only time this is not true is when the span being created is a new top     level span not being continued from an inbound X-Trace ID. This must be set explicitly     to a falsey value; it's absence is true. |
| [data] | <code>object</code> |  | Key/Value pairs of info to add to event |

**Example**  
```js
var span = new Span('fs', ao.lastEvent, {
  File: file
})
```
<a name="Span+descend"></a>

### span.descend(name, data) ⇒ [<code>Span</code>](#Span)
Create a new span descending from the current span

**Kind**: instance method of [<code>Span</code>](#Span)  
**Returns**: [<code>Span</code>](#Span) - the created span  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | Span name |
| data | <code>object</code> | Key/Value pairs of info to add to the entry event |

**Example**  
```js
var inner = outer.descend('fs', {
  File: file
})
```
<a name="Span+run"></a>

### span.run(fn) ⇒
Run a function within the context of this span. Similar to mocha, this
identifies asynchronicity by function arity and invokes runSync or runAsync

**Kind**: instance method of [<code>Span</code>](#Span)  
**Returns**: the value returned by fn()  

| Param | Type | Description |
| --- | --- | --- |
| fn | <code>function</code> | function to run within the span context |

**Example**  
```js
span.run(function () {
  syncCallToTrace()
})
```
**Example**  
```js
span.run(function (wrap) {
  asyncCallToTrace(wrap(callback))
})
```
<a name="Span+runAsync"></a>

### span.runAsync(fn) ⇒
Run an async function within the context of this span.

**Kind**: instance method of [<code>Span</code>](#Span)  
**Returns**: the value returned by fn()  

| Param | Type | Description |
| --- | --- | --- |
| fn | <code>function</code> | async function to run within the span context |

**Example**  
```js
span.runAsync(function (wrap) {
  asyncCallToTrace(wrap(callback))
})
```
<a name="Span+runSync"></a>

### span.runSync(fn) ⇒
Run a sync function within the context of this span.

**Kind**: instance method of [<code>Span</code>](#Span)  
**Returns**: the value returned by fn()  

| Param | Type | Description |
| --- | --- | --- |
| fn | <code>function</code> | sync function to run withing the span context |

**Example**  
```js
span.runSync(function () {
  syncCallToTrace()
})
```
<a name="Span+enter"></a>

### span.enter(data)
Send the enter event

**Kind**: instance method of [<code>Span</code>](#Span)  

| Param | Type | Description |
| --- | --- | --- |
| data | <code>object</code> | Key/Value pairs of info to add to event |

**Example**  
```js
span.enter()
syncCallToTrace()
span.exit()
```
**Example**  
```js
// If using enter/exit to trace async calls, you must flag it as async
// manually and bind the callback to maintain the trace context
span.async = true
span.enter()
asyncCallToTrace(ao.bind(function (err, res) {
  span.exit()
  callback(err, res)
}))
```
<a name="Span+exit"></a>

### span.exit(data)
Send the exit event

**Kind**: instance method of [<code>Span</code>](#Span)  

| Param | Type | Description |
| --- | --- | --- |
| data | <code>object</code> | key-value pairs of info to add to event |

<a name="Span+exitWithError"></a>

### span.exitWithError(err, data)
Send the exit event with an error status

**Kind**: instance method of [<code>Span</code>](#Span)  

| Param | Type | Description |
| --- | --- | --- |
| err | <code>Error</code> | Error to add to event |
| data | <code>object</code> | Key/Value pairs of info to add to event |

<a name="Span+setExitError"></a>

### span.setExitError(err)
Set an error to be sent with the exit event

**Kind**: instance method of [<code>Span</code>](#Span)  

| Param | Type | Description |
| --- | --- | --- |
| err | <code>Error</code> | Error to add to event |

<a name="Span+info"></a>

### span.info(data)
Create and send an info event

**Kind**: instance method of [<code>Span</code>](#Span)  

| Param | Type | Description |
| --- | --- | --- |
| data | <code>object</code> | key-value pairs to add to event |

**Example**  
```js
span.info({Foo: 'bar'})
```
<a name="Span+error"></a>

### span.error(data)
Create and send an error event

**Kind**: instance method of [<code>Span</code>](#Span)  

| Param | Type | Description |
| --- | --- | --- |
| data | <code>object</code> | Key/Value pairs to add to event |

**Example**  
```js
span.error(error)
```
<a name="Span.makeEntrySpan"></a>

### Span.makeEntrySpan(name, settings, kvpairs)
Create a new entry span. An entry span is the top span in a new trace in
this process. It might be continued from another process, e.g., an X-Trace-ID
header was attached to an inbound HTTP/HTTPS request.

**Kind**: static method of [<code>Span</code>](#Span)  

| Param | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | the name for the span. |
| settings | <code>object</code> | the object returned by ao.getTraceSettings() |
| kvpairs | <code>object</code> | key/value pairs to be added to the entry event |

<a name="Event"></a>

## Event
**Kind**: global class  

* [Event](#Event)
    * [new Event(span, label, parent, edge)](#new_Event_new)
    * [.getSampleFlag()](#Event+getSampleFlag)
    * [.addKVs(data)](#Event+addKVs)
    * [.enter()](#Event+enter)
    * [.toString()](#Event+toString)
    * [.send(data)](#Event+send)

<a name="new_Event_new"></a>

### new Event(span, label, parent, edge)
Create an event

An event is agent metadata with all the KV pairs and edges for the event.


| Param | Type | Description |
| --- | --- | --- |
| span | <code>string</code> | name of the event's span |
| label | <code>string</code> | Event label (usually entry or exit) |
| parent | <code>Metabuf</code> | Metadata to use to construct the event. |
| edge | <code>boolean</code> | Add an edge back to the parent. |

<a name="Event+getSampleFlag"></a>

### event.getSampleFlag()
Get sample flag from the event. Compatibility function.

**Kind**: instance method of [<code>Event</code>](#Event)  
<a name="Event+addKVs"></a>

### event.addKVs(data)
Add key-value pairs to this event. They will be sent when the
event is exited.

**Kind**: instance method of [<code>Event</code>](#Event)  

| Param | Type | Description |
| --- | --- | --- |
| data | <code>object</code> | Key/Value pairs of info to add to event |

<a name="Event+enter"></a>

### event.enter()
Enter the context of this event

**Kind**: instance method of [<code>Event</code>](#Event)  
<a name="Event+toString"></a>

### event.toString()
Get the X-Trace ID string of the event

**Kind**: instance method of [<code>Event</code>](#Event)  
<a name="Event+send"></a>

### event.send(data)
Send this event to the reporter

**Kind**: instance method of [<code>Event</code>](#Event)  

| Param | Type | Description |
| --- | --- | --- |
| data | <code>object</code> | additional key-value pairs to send |

<a name="TraceSettings"></a>

## TraceSettings : <code>object</code>
**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| doSample | <code>boolean</code> | the sample decision |
| doMetrics | <code>boolean</code> | the metrics decision |
| metadata | <code>Metadata</code> | the metadata to use |
| edge | <code>boolean</code> | whether to edge back to metadata |
| source | <code>number</code> | the sample decision source |
| rate | <code>number</code> | the sample rate used |
| mode | <code>number</code> | local mode to use for decision |
| ttRequested | <code>boolean</code> | trigger trace requested |
| ttOptions | <code>string</code> | X-Trace-Options header value |
| ttSignature | <code>string</code> | X-Trace-Options-Signature header value |
| ttTimestamp | <code>integer</code> | UNIX timestamp value from X-Trace-Options |

<a name="spanInfo"></a>

## spanInfo : <code>object</code>
**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| name | <code>string</code> | the name for the span |
| [kvpairs] | <code>object</code> | kvpairs to add to the span |
| [finalize] | <code>function</code> | callback receiving created span |

<a name="spanInfoFunction"></a>

## spanInfoFunction ⇒ [<code>spanInfo</code>](#spanInfo)
**Kind**: global typedef  
<a name="metric"></a>

## metric : <code>object</code>
**Kind**: global typedef  
**Properties**

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| name | <code>string</code> |  | name of the metric |
| [count] | <code>integer</code> | <code>1</code> | count of the metric |
| [value] | <code>number</code> |  | if summary, value or sum of values |
| [addHostTag] | <code>boolean</code> | <code>false</code> | add a hostname tag |
| [tags] | <code>object</code> |  | key-value pairs that can be used for filtering |
| [testing] | <code>boolean</code> | <code>false</code> | return array of correct metrics in addition     to an array of metrics with errors. |
| [noop] | <code>boolean</code> | <code>false</code> | do not actually send the metrics to the collector |

<a name="SendMetricsReturn"></a>

## SendMetricsReturn : <code>object</code>
**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| errors | <code>array</code> | an array of metrics for which an error occurred |
| [correct] | <code>array</code> | if globalOption.testing specified the correctly                               processed metrics are returned in this array. |

