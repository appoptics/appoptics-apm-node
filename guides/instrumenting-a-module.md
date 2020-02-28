# Instrumenting a module

Using the API is the most direct way to implement custom instrumentation.

## Using the instrumentation API

There are several different ways to use the instrumentation API, with varying
degrees of control.

### Basic instrumentation

Wherever possible, it is preferred that `ao.instrument(...)` is used, however
there are some alternatives, which we'll explore later. The `ao.instrument(...)`
function takes four arguments:

The signature is `ao.instrument (span, runner, config, callback)`.

- `span` is either the string name of the span to be created or a function that returns spanInfo (see below).
- `runner` is a function that will run the function to be instrumented (see below).
- `config` [optional] allows non-default settings to be specified.
- `callback` is only present if the function to be instrumented is asynchronous.

#### Span

If the `span` argument is a string a span will be created using that name.

If the `span` argument is a function (a "span-info" function), it must create and return an object
with information on how to build the span. There are two reasons to use a "span-info" function:
- specify KV pairs to be set on the entry event of the span
- gain access to the created span for deferred actions, e.g., adding a KV pair that is only defined during execution of the span.

The span-info function's signature is `span-info ()` and it returns an object with up to three properties:
- name (required) - the name of the span
- kvpairs (optional) - an object of key-value pairs that will be added to the span's entry event
- finalize (optional function) - `finalize(createdSpan, previousSpan)` will be called after the span has been created. N.B. `previousSpan` will not exist for a new trace or a trace being continued from an inbound X-Trace ID.


```js
let span;

function spanInfo () {
  return {
      name: 'span-name',
      kvpairs: {
        elapsed: currentTime() - startTime,
        cpuTime: currentCpu() - startCpu
      },
      // it is uncommon that the previous span is needed. this
      // function just stores the created span for later use. if
      // there is no need to add execution-time KVs to the span
      // then this may be omitted.
      finalize (createdSpan) {
        span = createdSpan;
      }
  }
}
```

#### Runner functions

Runner functions are wrappers around the function that you are instrumenting. The
instrumentation API cannot know the signature and arguments of each function being
instrumented so it must be wrapped in a "runner" function, i.e., a function that
runs the real function.

For a sync call it has no arguments.

```js
function syncRunner () {
  return yourFunctionToInstrument(your, args, go, here);
}
```

For an async call it has one argument, a replacement callback. The replacement
callback is supplied by the instrumentation function so it can take actions when
`yourFunctionToInstrument()` has completed. Your callback, if supplied to one of
instrumentation functions (`ao.instrument()`, `startOrContinueTrace()`, etc.) will
be called after the instrumentation function has completed its work.

```js
function asyncRunner (done) {
  return yourFunctionToInstrument(your, args, go, here, done);
}
```

#### Optional configuration

The third argument can optionally be a config object to toggle some features
of the instrumentation. It should contain `config.enabled = true` to turn the
instrumentation on, and can contain `config.collectBacktraces = true` to turn
on backtrace collection. Keep in mind that collecting backtraces may have a
lot of overhead.

#### Optional callback

When instrumenting an async function, a callback should be provided for the
runner to call when it completes. It can be in the fourth argument position,
if optional configs are included or the third position if configs are omitted.

The signature of the callback is unconstrained but should match the signature of
the callback in the runner function. The only assumption made is that
the callback may have an error to report in the first argument position, but
this is not required. If it is something other than a string or an error object,
it will simply be passed through as expected, without trying to report it. An
error is reported as is while a string is converted to an error then reported.

#### Putting all that together

So if we wanted to use `ao.instrument(...)` to patch an async `abc.xyz` call,
it'd look something like this:

```js
shimmer.wrap(abc, 'xyz', xyz => {
  return function (n, cb) {
    const spanInfoMaker = () => return {name: 'awesome-span', kvpairs: {n: n}};
    const runner = done => xyz.call(this, n, done);
    return ao.instrument(spanInfoMaker, runner, {enabled: true}, cb);
  }
})
```

### Instrumenting HTTP requests

Sometimes you want to instrument something that is constrained to the lifetime
of a request rather than a discrete call and callback pairing. For these times
there is `ao.instrumentHttp(...)`. It shares most of the signature of the
`ao.instrument(...)` function, but with a response object in place of the
callback. It will trigger the exits in reverse chronological order when the
`end` event of the request is fired.

```js
http.createServer((req, res) => {
  const runner = () => res.end('done')
  ao.instrumentHttp('http-span', runner, options, res)
})
```

### Advanced API usage

Sometimes `ao.instrument(...)` or `ao.instrumentHttp(...)` don't quite fit
what is needed for a given patch. For these situations, you can drop down to
the lower-level API. Those other functions are really just sugar over the
`Span`	class. The current span reference can be acquired via `ao.lastSpan`
and you can call the `descend(...)` function on that. The runner part is
encapsulated by `span.runSync(fn)` and `span.runAsync(fn)`, with a function-length
based sugar wrapper around both of those at `span.run(fn)`. When using the `Span`
class, you will need to call both the run callback and the callback for the
instrumented function itself separately.

```js
const last = ao.lastSpan;
const span = last.descend('abc', {
  foo: 'bar'
})
span.runSync(() => {
  console.log('doing some stuff');
})
```

If creating an entry span, i.e., a span when there is no `ao.lastSpan`, the
static class function `Span.makeEntrySpan()` is available. The kvpairs are
an optional object of KVs to be attached to the span entry event.

```js
const settings = ao.getTraceSettings();
const span = Span.makeEntrySpan('my-span', settings, kvpairs);
```


### Starting or continuing a trace

The API methods so far, except for `makeEntrySpan()`, have all been geared
toward use when a trace is already in progress. When you aren't in a trace
already, you might need to start a fresh one. For this purpose, there is the
`ao.startOrContinueTrace(...)` function. The signature is almost identical
to `ao.instrument(...)` with the exception that it has an optional xtrace
argument at the beginning to provide the id of a trace to continue from.

```js
ao.startOrContinueTrace(headers['X-Trace'], 'abc', done => {
  return setImmediate(done, a, b, c);
}, (a, b, c) => {
  console.log('called from setImmediate with:', a, b, c);
})
```

To get the current xtrace id to pass along through a header or some other
method, you can use the `ao.xtraceId` getter.

### Info and error events

Info and error events are simply inserted into the current span and can be
created with the `ao.reportInfo(...)` and `ao.reportError(...)` functions.

```js
ao.reportInfo({ foo: 'bar' });
ao.reportError(new Error('some error'));
ao.reportError('a string error');
```

## Context management

The agent propagates context alongside the execution flow. The context is
used to keep track of the state of the trace: the current span, the last
event sent, etc.

### Accessing the context

The context is available as an object with `get(key)` and `set(key, value)`
methods on `ao.tContext`. You can store whatever data you need in the store,
but it is *only* available within the chain of synchronous and asynchrous
calls in which the data was set. The asynchronous context tracking begins
when a call is made to `ao.tContext.run(functionToRunInContext)`.

Note that any keys beginning with `ao.` as well as the keys `lastEvent`,
`lastSpan`, and `topLevel` are reserved.

```js
ao.tContext.run(function () {
  ao.tContext.set('foo', 'bar');
  var called = false;

  setImmediate(function () {
    assert('bar', ao.tContext.get('foo'));
    ao.tContext.set('baz', 'buz');
    called = true;

    setImmediate(after);
  })

  function after () {
    assert('buz', ao.tContext.get('baz'));
  }

  setTimeout(function () {
    assert('bar', ao.tContext.get('foo'));
    assert(null, ao.tContext.get('baz'));
    assert(called, true);
  })
})
```

### Maintaining context

Unfortunately, due to the interleaving of requests caused by the event loop,
asynchronous boundaries must be linked together manually to keep track of
the asynchronous context of a call graph. Much of this is handled automatically
by the `ace-context` module but there are sometimes instances of user-mode
queueing, like connection pools, which interfere with context tracking. For
this reason, it is sometimes necessary to use `ao.bind(...)` and
`ao.bindEmitter(...)` to bind callbacks and event emitters to the context at
the point which they are defined.

```js
ao.bindEmitter(request);
ao.bindEmitter(response);

ao.tContext.set('it works', true);

someAsyncThing(ao.bind(function () {
  res.on('end', function () {
    assert(true, ao.tContext.get('it works'));
  })
}))
```

## Auto-instrumentation overview for internal developers

Let's say you want to instrument module `abc` to trace function `xyz`. First,
you need a file that will patch module `abc` when it is loaded. This patch
file should go in `lib/probes` and be named the same as the module, e.g.,
`lib/probes/abc.js`. It should export a single function as module.exports,
which accepts the unmodified module as the first input argument and returns
the modified module. The agent modifies node's `require` function so that the
module that end-users load will be the module returned by this function.

`options.version` contains the version of the module `abc` and can be used
to make decisions on version-dependent patches.


```js
module.exports = function (abc, options) {
  return abc;
}
```

If you have a specific package you'd like help with let us know; we're happy
to help.

## Wrapping functions

To collect the performance data of a given function, we'll need to wrap it
in another function that collects and reports the relevant data. You can simply
store the old function reference in a new variable, overwrite the function
at the original location, and call the stored function within the new one.
However, there are handy tools to make this process easier. We use shimmer.

### Sync wrapping

To wrap a sync function, you simply need to place some code before and after
the call of the stored function.

```js
shimmer.wrap(abc, 'xyz', xyz => {
  return function () {
    const before = Date.now();
    const returnValue = xyz.apply(this, arguments);
    const after = Date.now();
    console.log(`xyz took ${after - before}ms`);
    return returnValue;
  }
})
```

### Async wrapping

For async calls, it's a bit harder. You'll need to locate the callback in the
arguments and wrap that too, so you can inject the second part.

```js
shimmer.wrap(abc, 'xyz', xyz => {
  return function w(n, trueCb) {
    const before = Date.now();
    function cb () {
      const after = Date.now();
      console.log(`xyz took ${after - before}ms`);
      return trueCb.apply(this, arguments);
    }
    return xyz.call(this, n, cb);
  }
})
```

### More information

This is just a quick overview of auto-instrumentation mechanics. For more details see
`lib/require-patch.js` and existing probes in `lib/probes/`.
