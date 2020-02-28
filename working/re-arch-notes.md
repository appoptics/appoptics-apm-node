
## implementation strategy

remaining
- scrub in process
- publish bindings v10-alpha
- matrix tests
- benchmark

done
- move appropriate addon-sim to addon (far less in addon)
- implement Metabuf class (~~may get renamed to Metadata when complete~~). worked well
- create Metabuf tests - worked well
- don't require changes to bindings until the agent functions (as much as possible). one
example: ignore the metadata (wrong format) returned by getTraceSettings() and just
supply the metabuf that will be used in the new system. this may not be viable but it's
worth a try. - worked but minor
- rewrite test/basics.test.js to test new metabuf functionality - first milestone is passing
this - worked.
- rewrite test/event.test.js and re-evaluate whether various properties (e.g., .taskId, .opId,
 etc. are useful) - worked
- BIG find all metadata references. Metadata.makeRandom() is in many tests. - worked
- apis, api-sims, index.js (init msg), http (xtrace checks) - were details really.

## questions - open


### questions - closed

- pretty tight coupling between bindings Event::send(), OBOE_* constants, and Metabuf. another way?
for testing. not sure that anything else does; if not can substitute wrapper on reportInfo() function.
RESOLUTION - compromise. Metabuf.init() checks to make sure hardcoded numbers match. It should never
encounter a mismatch with the bindings/agent release process but if it does it should blow up during
testing. And Event::send() knowing the js structure is slightly more complicated than decomposing it
at the js end and passing separate arguments but that's not really any more bullet proof. Event::send()
does call `validEvent()` which makes a pretty deep duck-type check on the Event object passed to it.
- span._internal() - why are internal events kept in span.internal[]? custom.test.js depends on it. RESOLUTION
was used only for custom.test.js. replaced with placeholder noop that won't keep info events alive for the
life of the span; custom.test.js replaces the noop for it's purposes.
- consider converting internal use but keeping docs the same. RESOLVED - keep term metadata in user docs
but refer to it, when necessary, as metadata in the form of a Metabuf. will keep current usage ao.MB so
it can't be confused with Metadata.
- should Event constructor accept both Events and Metabuf-metadata? NO. There are only 4 places that
call `new Event()`; they can get it right and one additional instanceof check is avoided.

## details - items to do

- bunyan test 'mode=\'always\' should always insert a trace ID even if not tracing generates
context error. preventable?

### details - done ##

- provide initialization-time check that verifies aob metadata constants are the same
  as Metabuf uses.
- deprecate Event.last in favor of ao.lastEvent. why? most places don't need access
to Event except for this single purpose and all have/need access to ao. Ditto for Span.last.
- add internal metrics - # events, #spans generated, # sent, average size, time of event, spans/trace, etc.
  - eventsCreated, eventsSampled, eventsSent, eventsSendFailed ✔
  - spansCreated, spansSampled, spansTopSpanEnters, spansTopSpanExits ✔
  - eventsBytesSent - must be recorded in bindings.Event.send() (only place bson buffer size is calculated) ✔
  - timing for spans - from span.entry to span.exit. useful? RESOLVED, NO, unless capture buckets by span name. ✔
  - capture trace timing too (in span.js) ✔
- get rid of getters/setters. RESOLUTION - not really viable without breaking too much documented api.
- rename requestStore => tContext.
- rename Event.set() => Event.addKVs(). deprecate Event.set(). DO NOT remove all direct accesses to event.kv - too many.
- remove metadata & metadataFromXtrace from getTraceSettings() return.
- abstract edges better. create addEdge() method. remove all event.edges.push(...) instances.
- rework bindings tests (mostly removals).
- remove already gone bindings.Context.sampleTrace() references (testing, api-sim).
- event.addEdge() accepts both Metabuf and Event arguments - topLevel only has Metabuf but most code works at event-level.
- unix time in microseconds done. see api.js/getUnixTimeMicroseconds().
- agent: rework event code to use Metabuf. (only 3 "new Event" calls)
- bindings: getTraceSettings() changes - creates Metabuf, not oboe metadata.
- repurpose event completely - all javascript until event.send()
  constructor expects metadata, not event, or both? capture edges, KVs, etc.
- get rid of Event.sendStatus() - used only for init message. replace with optional second arg that
  determines channel. more in event.cc (bindings).
- there will be no oboe metadata, just events which contain a Buffer that holds the x-trace form of metadata.
  the only time an oboe event or metadata will be constructed is in the bindings Event.send() function -
  completely new. actually an oboe event is nothing more than metadata with a bson buffer and string. and the
  metadata object carries along lengths which are constant for any given build/version combination, so no need
  to carry that redundant information. a version will suffice if there is ever a change.
- bindings - Event & Metadata will go away. New function in Event namespace (most likely, or Reporter) that
  will send an event in one call. Each event will have all the KV pairs, edges, and metadata (in a Metabuf)
  required to construct an oboe event and then send it.
- bindings: might need an hrtime/unix-time base function.
- agent: validates x-trace strings
- replaced bindings.event.getSampleFlag() with event.sampling - simple property.
- formatters - log-formatters and toString() functions for low-level bindings metadata.
- agent: span changes TBD
- agent: rework getTraceSettings()
- make sure nothing but a Metabuf goes into Event._edges.
- weave metadata/Metabuf into documentation. e.g., settings returned by getTraceSettings() contains
the metadata required to construct the top-level span. and all events contain their metadata in a
metabuf referenceable via event.mb.

## perf notes

initial js => c++ transitions
- inbound xtrace validation
- getTraceSettings() +1 if error
- create Event
- every KV pair
- edges (2) set edge, send edge
- every toString() - log insertion, outbound x-trace headers, logging.
- every string => metadata conversion.
- send Event

trash-metadata js => c++ transitions
- getTraceSettings()
- send Event()

## breaking changes

- event.set() => event.addKVs(). would like to remove event.kv but it is used throughout
the probes. event.set() is really just deprecated but good enough.
- Event constructor used to allow the parent argument to be Event or Metadata. The parent
can be only Metabuf now.
- edges must be added using event.addEdge() now. They can no longer be pushed on to edges
property.
- requestStore => tContext. if you use ao.requestStore change ao.requestStore => ao.tContext
and ao.resetRequestStore => ao.resetTContext.
- Event.last => ao.lastEvent
- Span.last => ao.lastSpan
- any references to `lastEvent.event` will need to be changed - there is no longer an `event`
property on `lastEvent`. most code should have been accessing properties and methods on
`lastEvent` already but any that haven't need to change. e.g., `lastEvent.event.getSampleFlag()`
needs to be changed to `lastEvent.sampling`. this includes `const {last} = Event` references.
