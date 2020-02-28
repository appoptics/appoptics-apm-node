'use strict';

const tap = require('tap');
const test = tap.test;

const MB = require('../lib/metabuf.js');

test('metabuf core functions', function (t) {
  t.plan(10);

  let mb1;

  t.test('the Metabuf constructor works', function (t) {
    t.plan(2);

    mb1 = new MB();
    t.type(mb1, MB);
    t.ok(headerGood(mb1));
  });

  t.test('the Metabuf constructor throws with a bad argument', function (t) {
    t.plan(1);

    function throws () {
      new MB('i am not a Metabuf instance');
    }
    t.throws(throws, 'Metabuf constructor argument must be a Metabuf instance');
  });

  t.test('Metabuf.makeRandom() works', function (t) {
    t.plan(3);

    mb1 = MB.makeRandom();
    t.type(mb1, MB, 'the result is a Metabuf');
    t.ok(headerGood(mb1));
    t.notOk(isSampled(mb1), 'the sample flag isn\'t set');
  });

  t.test('Metabuf.makeRandom(1) works', function (t) {
    t.plan(3);

    mb1 = MB.makeRandom(1);
    t.type(mb1, MB, 'the result is a Metabuf');
    t.ok(headerGood(mb1));
    t.ok(isSampled(mb1), 'the sample flag is set');
  });

  t.test('Metabuf flag operations work', function (t) {
    t.plan(4);

    const mb0 = MB.makeRandom(0);
    t.equal(mb0.getFlags(), 0, 'no flags should be set');
    mb0.assignFlags(1);
    t.equal(mb0.getFlags(), 1, 'should set the sample bit');
    mb0.assignFlags(0xFF);
    t.equal(mb0.getFlags(), 0xFF, 'should allow setting any flag bits');
    mb0.assignFlags(0x00);
    t.equal(mb0.getFlags(), 0, 'should clear flags too');
  });

  t.test('Metabuf.taskIdsMatch() works', function (t) {
    t.plan(2);
    // 2b-6c412b824d4fc2486c8021a7ccaf747f70633ace-d716bf6b03d44ad8-01
    const re = /-/g;
    const x0 = '2b-6c412b824d4fc2486c8021a7ccaf747f70633ace-d716bf6b03d44ad8-01'.replace(re, '');
    const x1 = '2b-6c412b824d4fcccccc8021a7ccaf747f70633ace-d716bf6b03d44ad8-01'.replace(re, '');

    const mb0 = MB.stringToMetabuf(x0);
    const mb1 = MB.stringToMetabuf(x1);

    t.ok(mb0.taskIdsMatch(mb0), 'should match identical task IDs');
    t.notOk(mb1.taskIdsMatch(mb0), 'should detect non-matching task IDs');

  });

  t.test('the Metabuf constructor uses a prototype', function (t) {
    t.plan(5);

    const copy = Buffer.from(mb1.buf);

    const mb2 = new MB(mb1);
    t.ok(headerGood(mb2));
    t.ok(tidEqual(mb1, mb2), 'task IDs should be the same');
    t.notOk(oidEqual(mb1, mb2), 'op IDs should be different');
    t.ok(isSampled(mb2), 'sample flag should be set');

    // verify that the source buffer wasn't modified
    const same = copy.compare(mb1.buf) === 0;
    t.ok(same, 'the prototype shouldn\'t be modified');
  });

  t.test('toString() works correctly', function (t) {
    t.plan(6);
    // format control bits
    // header = 1;        (but as argument interpreted as fmtHuman)
    // task = 2;
    // op = 4;
    // flags = 8;          // include all flags (2 hex chars)
    // sample = 16;        // sample bit only (0 or 1)
    // separators = 32;    // separate fields with '-'
    // lowercase = 64;     // lowercase alpha hex chars

    let text = mb1.toString();
    let tt = `${headerHexU(mb1)}${tidHexU(mb1)}${oidHexU(mb1)}${flagsHexU(mb1)}`;
    t.equal(text, tt, 'should format with no argument');

    text = mb1.toString(1);
    tt = `${headerHex(mb1)}-${tidHex(mb1)}-${oidHex(mb1)}-${flagsHex(mb1)}`;
    t.equal(text, tt, 'toString(1) should format correctly');

    text = mb1.toString(MB.fmtLog);
    tt = `${tidHexU(mb1)}-${mb1.buf[29] & 1 ? '1' : '0'}`;
    t.equal(text, tt, 'toString(fmtLog) should format correctly');

    text = mb1.toString(2 | 64);
    tt = `${tidHex(mb1)}`;
    t.equal(text, tt, 'toString(task|lowercase) should format correctly');

    text = mb1.toString(2);
    tt = `${tidHexU(mb1)}`;
    t.equal(text, tt, 'toString(task) should format correctly');

    text = mb1.toString(1 | 2 | 4 | 8);
    tt = `${headerHexU(mb1)}${tidHexU(mb1)}${oidHexU(mb1)}${flagsHexU(mb1)}`;
    t.equal(text, tt, 'toString(header|task|op|flags should format correctly');
  });

  t.test('stringToMetabuf() works correctly', function (t) {
    const bad = [
      'xyzzy',
      '2b' + 'f'.repeat(40) + '0'.repeat(16) + '01',  // 0s in op id
      '2b' + 'f'.repeat(40) + 'a'.repeat(16) + '001', // too long
      '2b' + 'f'.repeat(40) + 'a'.repeat(16) + '0x'   // invalid char
    ];
    const good = [
      '2b' + 'f'.repeat(40) + 'a'.repeat(16) + '00',
      '2b' + 'f'.repeat(40) + 'a'.repeat(16) + '01'
    ];
    bad.forEach(b => {
      const result = MB.stringToMetabuf(b);
      t.notOk(result, `${b} should fail to convert`);
    });
    good.forEach(g => {
      const result = MB.stringToMetabuf(g);
      t.ok(result, `${g} should convert successfully`);
    });

    // 2b-6c412b824d4fc2486c8021a7ccaf747f70633ace-d716bf6b03d44ad8-01
    const re = /-/g;
    const x = '2b-6c412b824d4fc2486c8021a7ccaf747f70633ace-d716bf6b03d44ad8-01'.replace(re, '');
    const mb = MB.stringToMetabuf(x);
    t.equal(mb.toString(), x.toUpperCase(), 'should convert a known x-trace correctly');

    t.done();
  });

  t.test('the Metabuf.init() checks correctly', function (t) {
    t.plan(4);

    const fakeAo = {
      addon: {
        Event: {xtraceIdVersion: 2},
        MAX_TASK_ID_LEN: 20,
        MAX_OP_ID_LEN: 8,
      }
    };

    function test () {MB.init(fakeAo)}

    t.doesNotThrow(test, 'does not throw with current defines');

    fakeAo.addon.Event.xtraceIdVersion = 3;
    t.throws(test, 'throws when X-TraceId version is not 2');
    fakeAo.addon.Event.xtraceIdVersion = 2;
    fakeAo.addon.MAX_TASK_ID_LEN = 26;
    t.throws(test, 'throws when MAX_TASK_ID_LEN is not 20');
    fakeAo.addon.MAX_TASK_ID_LEN = 20;
    fakeAo.addon.MAX_OP_ID_LEN = 9;
    t.throws(test, 'throws when MAX_OP_ID_LEN is not 8');
  });
});

//
// test helpers
//

function headerGood (mb) {
  return mb.buf[0] === 0x2b;
}

function tidEqual (mb1, mb2) {
  return !mb1.buf.compare(mb2.buf, 1, 21, 1, 21);
}

function oidEqual (mb1, mb2) {
  return !mb1.buf.compare(mb2.buf, 21, 29, 21, 29);
}

function isSampled (mb) {
  return mb.buf[29] & 0x01;
}

function header (mb) {
  return Buffer.from([mb.buf[0]]);
}
function tid (mb) {
  const tid = Buffer.allocUnsafe(20);
  mb.buf.copy(tid, 0, 1, 21);
  return tid;
}
function oid (mb) {
  const oid = Buffer.allocUnsafe(8);
  mb.buf.copy(oid, 0, 21, 29);
  return oid;
}
function flags (mb) {
  return Buffer.from([mb.buf[29]]);
}

function headerHex (mb) {
  return header(mb).toString('hex');
}
function tidHex (mb) {
  return tid(mb).toString('hex');
}
function oidHex (mb) {
  return oid(mb).toString('hex');
}
function flagsHex (mb) {
  return flags(mb).toString('hex');
}

function headerHexU (mb) {
  return headerHex(mb).toUpperCase();
}
function tidHexU (mb) {
  return tidHex(mb).toUpperCase();
}
function oidHexU (mb) {
  return oidHex(mb).toUpperCase();
}
function flagsHexU (mb) {
  return flagsHex(mb).toUpperCase();
}
