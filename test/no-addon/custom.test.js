'use strict';

process.env.AO_TEST_NO_BINDINGS = '1';

const ao = require('../..');
const assert = require('assert');


//
//                 ^     ^
//            __--| \:::/ |___
//    __---```   /    ;;;  \  ``---___
//      -----__ |   (@  \\  )       _-`
//             ```--___   \\ \   _-`
//                     ````----``
//     /````\  /```\   /```\  |`\   ||
//     ||``\| |/```\| |/```\| ||\\  ||
//      \\    ||   || ||   || || || ||
//        \\  ||   || ||   || || || ||
//     |\__|| |\___/| |\___/| ||  \\||
//     \____/  \___/   \___/  ||   \_|
//

const soon = global.setImmediate || process.nextTick

// eslint-disable-next-line no-unused-vars
function psoon () {
  return new Promise((resolve, reject) => {
    soon(() => resolve())
  })
}

// Without the native liboboe bindings present,
// the custom instrumentation should be a no-op
describe('custom (without native bindings present)', function () {
  it('should have a version of \'not loaded\'', function () {
    assert(ao.addon.version === 'not loaded');
  });

  it('should passthrough instrumentHttp', function () {
    let counter = 0;
    ao.instrumentHttp('span-name', function () {
      counter += 1;
    });
    assert(counter === 1);
  })

  it('should passthrough sync instrument', function () {
    let counter = 0;
    ao.instrument('test', function () {
      counter++;
    })
    assert(counter === 1, 'counter should be 1');
  })

  it('should passthrough async instrument', function (done) {
    function localDone () {
      done();
    }
    ao.instrument('test', soon, {}, localDone);
  })

  it('should passthrough pInstrument', function () {
    let counter = 0;

    function pfunc () {
      counter += 1;
      return Promise.resolve(99);
    }

    return ao.pInstrument('test', pfunc).then(r => {
      assert(counter === 1, 'counter should be 1');
      assert(r === 99, 'the result of pInstrument should be 99');
      return r;
    })
  })

  it('should passthrough sync startOrContinueTrace', function () {
    let counter = 0
    ao.startOrContinueTrace(null, 'test', function () {
      counter++
    })
    assert(counter === 1, 'counter should be equal to 1');
  })

  it('should passthrough async startOrContinueTrace', function (done) {
    function localDone () {
      done();
    }
    ao.startOrContinueTrace(null, 'test', soon, localDone)
  })

  it('should passthrough pStartOrContinueTrace', function () {
    let counter = 0;

    function pfunc () {
      counter += 1;
      return Promise.resolve(99);
    }
    return ao.pStartOrContinueTrace(null, 'test', pfunc).then(r => {
      assert(counter === 1, 'counter should be 1');
      assert(r === 99, 'the result of pStartOrContinueTrace should be 99');
      return r;
    })
  })

  it('should support callback shifting', function (done) {
    ao.instrument('test', soon, done)
  })

  it('should supply API functions and properties', function () {
    assert(ao.traceMode === 'disabled');
    assert(ao.sampleRate === 0);
    assert(ao.tracing === false);
    assert(ao.traceId === undefined);
    assert(ao.lastEvent === undefined);
    assert(ao.lastSpan === undefined);
    assert(ao.tContext && typeof ao.tContext.get === 'function');
    assert(typeof ao.resetTContext === 'function');
    assert(ao.clsCheck() === false);
    assert(ao.stack() === '');
    assert(ao.bind('x') === 'x');
    assert(ao.bindEmitter('x') === 'x');
    assert(ao.backtrace());
    assert(ao.setCustomTxNameFunction('x') === false);

    assert(ao.readyToSample() === false);
    assert(ao.getTraceSettings().doSample === false);
    assert(ao.sampling() === false);
    assert(ao.stringToMetadata('') === null);
    assert(ao.stringToMetadata('2BBC99C9E42EDB57F0B6746B41DB181B5D9B812E8E78549D538F67DAAC01') instanceof ao.MB);
    assert(ao.patchResponse('x') === undefined);
    assert(ao.addResponseFinalizer('x') === undefined);
    assert(ao.traceId === undefined);
    assert(ao.reportError(new Error('xyzzy')) === undefined);
    assert(ao.reportInfo('this is info') === undefined);
    assert(ao.sendMetric() === -1);
    assert(ao.getFormattedTraceId() === `${'0'.repeat(40)}-0`);

    let o = ao.insertLogObject();
    assert(typeof o === 'object');
    assert(Object.keys(o).length === 0);

    o = ao.insertLogObject({existing: 'bruce'});
    assert(typeof o === 'object');
    assert(Object.keys(o).length === 1);
    assert(o.existing === 'bruce');
  })
})
