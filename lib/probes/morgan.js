'use strict'

const ao = require('..')

const logMissing = ao.makeLogMissing('morgan');

let token;

//
// patch morgan so the arguments can be mucked with. this is a proxy
// because 1) morgan is typically only called once or maybe twice and
// 2) it will let us intercept token and format calls at some point if
// we choose to do so.
//
module.exports = function (morgan) {
  if (!ao.probes.morgan.enabled) {
    return morgan;
  }

  const pmorgan = new Proxy(morgan, {
    // call target/morgan as a function
    apply (target, thisArg, argumentsList) {
      if (ao.cfg.insertTraceIdsIntoMorgan) {
        argumentsList = tryInsertion(morgan, argumentsList);
      } else if (ao.cfg.createTraceIdsToken === 'morgan') {
        if (!token) {
          token = createToken(morgan);
        }
      }
      return Reflect.apply(morgan, thisArg, argumentsList);
    },
  })

  return pmorgan;
}

//
// get the string to insert into the morgan log output
//
function getAutoTraceTokenString () {
  const last = ao.lastEvent;
  const mode = ao.cfg.insertTraceIdsIntoMorgan;
  if ((!last && mode !== 'always') || !mode) {
    return '';
  // now we know there is a last event.
  } else if (mode === 'sampledOnly' && !last.sampling) {
    return '';
  }
  return ` ao.traceId=${ao.getFormattedTraceId()}`;
}

//
// token creation
//
const autoToken = ':ao-auto-trace-id';

function createToken (morgan) {
  return morgan.token(`${autoToken.slice(1)}`, () => getAutoTraceTokenString())
}

//
// try to insert the trace ID. this is where morgan's various calling
// sequences get decoded.
//
function tryInsertion (morgan, args) {
  // make sure the token is defined
  if (!token) {
    token = createToken(morgan);
  }

  // the first argument can be a string name, a string format, or a custom format function.
  // it can also be an options argument (deprecated).
  //
  // the following code is modeled directly after the morgan code to try to handle arguments
  // as correctly as possible.
  const [format, options] = args;
  let fmt = format;
  let opts = options || {};

  if (format && typeof format === 'object') {
    opts = format;
    fmt = opts.format || 'default';
  }

  if (fmt === undefined) {
    fmt = 'default';
  }

  if (typeof fmt === 'function') {
    // the caller is passing a custom format function
    const wrapped = function () {
      // generate the log line.
      const string = fmt.apply(this, arguments);
      // don't apply this if it's already there - the function could have inserted it.
      if (string.indexOf(ao.getFormattedTraceId()) >= 0) {
        return string;
      }
      return `${string}${getAutoTraceTokenString()}`;
    }
    // substitute the wrapper for the caller's function.
    args[0] = wrapped;
    args[1] = opts;
  } else if (fmt in morgan) {
    // the format exists in morgan. it's kind of fragile though, morgan stores all
    // tokens, formats, and it's own functions as properties on the morgan object so
    // the fmt name could exist yet not be a format. but that's the way it works. if
    // it's a function it could be a token, one of morgan's functions, or a compiled
    // format. either way, all that can be done here is to wrap it. this is particularly
    // true for the 'dev' format that is precompiled.
    let needsWrapped = true;
    if (typeof morgan[fmt] === 'function') {
      // dev is the only precompiled format so it's the only one that needs to be wrapped.
      if (fmt === 'dev' && needsWrapped) {
        const dev = morgan.dev;
        const wrapped = function () {
          const string = dev.apply(this, arguments);
          if (!string.endsWith(autoToken)) {
            return `${string}${autoToken}`;
          }
          return string;
        }
        morgan[fmt] = wrapped;
        args[0] = 'dev';
        args[1] = opts;
        needsWrapped = false;
      }
    } else if (typeof fmt === 'string') {
      // the format doesn't exist so this must be a format string or the property name for
      // one of morgan's predefined format strings. that's the way morgan is going to interpret
      // it regardless. that means that there is not going to be a referenceable function to
      // wrap so the only way to insert our trace ID is to modify the format string by adding
      // our token at the end. in this case modify the calling signature to the standard form
      // of morgan('format', options) not matter how it was originally called.
      if (typeof morgan[fmt] === 'string') {
        if (!morgan[fmt].endsWith(autoToken)) {
          morgan[fmt] = `${morgan[fmt]}${autoToken}`;
        }
      } else {
        // not sure we should do this. if the caller is supplying their own format they can
        // insert :ao-trace-id on their own. if they choose not to should we be inserting it?
        // TODO BAM note - this also applies to calling 'morgan.format' to define a format.
        //args[0] = `${fmt} ao.traceId=:ao-trace-id`;
        //args[1] = opts;
        ao.loggers.debug('morgan.tryInsertion() - no action taken');
      }
    } else {
      logMissing(`expected fmt type (got ${typeof fmt})`);
    }
  }

  // return the possibly modified args.
  return args;
}
