'use strict';

const crypto = require('crypto');

// starting index, number of bytes
const fieldSpecs = {
  1: [0, 1],        // header
  2: [1, 20],       // task ID
  4: [21, 8],       // op ID
  8: [29, 1],       // flags
  24: [29, 1],      // flags | sample (flags | 16) to both require flags
}

class Metabuf {
  constructor (metabuf) {
    this.buf = Buffer.allocUnsafe(30);
    this.buf[0] = 0x2b;
    if (metabuf instanceof Metabuf) {
      // a prototype was provided so use its taskId and flags but create
      // a new, random opId for it.
      metabuf.buf.copy(this.buf, 1, 1, 21);
      this.buf[29] = metabuf.buf[29];
      crypto.randomFillSync(this.buf, 21, 8);
    } else if (arguments.length === 0) {
      this.buf[29] = 0x00;
    } else {
      throw new Error('Metabuf constructor argument must be a Metabuf instance');
    }
  }

  taskIdsMatch (mb) {
    return this.buf.compare(mb.buf, 1, 21, 1, 21) === 0;
  }

  assignFlags (bits) {
    return this.buf[29] = bits;
  }

  getFlags () {
    return this.buf[29];
  }

  // format control bits
  // header = 1;
  // task = 2;
  // op = 4;
  // flags = 8;          // include all flags (2 hex chars)
  // sample = 16;        // sample bit only (0 or 1)
  // separators = 32;    // separate fields with '-'
  // lowercase = 64;     // lowercase alpha hex chars
  //
  // Metadata.fmtHuman = header | task | op | flags | separators | lowercase;
  // Metadata.fmtLog = task | sample | separators;

  toString (fmt) {
    if (!fmt) {
      fmt = Metabuf.ffHeader | Metabuf.ffTask | Metabuf.ffOp | Metabuf.ffFlags;
    } else if (fmt === 1) {
      // 1 gets set to fmtHuman for historical purposes (used to be the only option
      // before individual format bits were added). but also getting just the header
      // is not very useful.
      fmt = Metabuf.fmtHuman;
    }

    return this.format(fmt);
  }

  format (fmt) {
    // if flags are specified ignore sample
    if (fmt & Metabuf.ffFlags) {
      fmt &= ~Metabuf.ffSample;
    }
    let sep;
    if (fmt & Metabuf.ffSeparators) {
      sep = '-'.charCodeAt(0);
    }
    const alpha = (fmt & Metabuf.ffLowercase ? 'a' : 'A').charCodeAt(0) - 10;
    const digit = '0'.charCodeAt(0);
    // eslint-disable-next-line max-len
    const fields = [Metabuf.ffHeader, Metabuf.ffTask, Metabuf.ffOp, Metabuf.ffFlags | Metabuf.ffSample];
    const fieldsToFormat = [];
    let sizeRequired = 0;
    for (let fix = 0; fix < fields.length; fix++) {
      if (fmt & fields[fix]) {
        fieldsToFormat.push(fields[fix])
        // 2 chars per byte plus a separator even though it will be one too many.
        sizeRequired += fieldSpecs[fields[fix]][1] * 2;
        if (sep) {
          sizeRequired += 1;
        }
      }
    }
    // create the output buffer with room for a trailing separator
    const chars = Buffer.allocUnsafe(sizeRequired);
    let p = 0;
    // for each field to be included
    for (let fix = 0; fix < fieldsToFormat.length; fix++) {
      const fieldInfo = fieldSpecs[fieldsToFormat[fix]];
      const end = fieldInfo[0] + fieldInfo[1];
      // format the bytes in the field
      for (let i = fieldInfo[0]; i < end; i++) {
        let nibble = this.buf[i] >>> 4;
        chars[p++] = nibble + (nibble > 9 ? alpha : digit);
        nibble = this.buf[i] & 0xF;
        chars[p++] = nibble + (nibble > 9 ? alpha : digit);
      }
      // add a separator if there is one.
      if (sep) {
        chars[p++] = sep;
      }
    }
    // exclude the trailing separator
    if (sep) {
      sizeRequired -= 1;
    }
    // for the case where only the sample flag is desired back up over
    // the first flags nibble character and replace it with the sample bit.
    if (fmt & Metabuf.ffSample) {
      sizeRequired -= 1;
      chars[sizeRequired - 1] = '0'.charCodeAt(0) + (this.buf[29] & 1);
    }

    // convert to chars
    return chars.toString('utf8', 0, sizeRequired);
  }
}

//
// static methods
//

// make a random Metabuf with the sample bit indicated.
Metabuf.makeRandom = function makeRandom (sample) {
  const mb = new Metabuf();
  crypto.randomFillSync(mb.buf, 1, 28);
  mb.buf[29] = sample ? 0x01 : 0x00;

  return mb;
}

// convert a valid string xtrace to a buffer. return buffer or null if buffer not valid.
Metabuf.stringToMetabuf = function stringToMetabuf (string) {
  if (string.length > 60) {
    return null;
  }
  const b = Buffer.from(string, 'hex');
  if (b.length !== 30 || b[0] !== 0x2b || b[29] & 0xFE) {
    return null;
  }
  if (string.indexOf('0'.repeat(16), 42) === 42) {
    return null;
  }
  const mb = new Metabuf();
  // replace the buf in mb.
  mb.buf = b;
  return mb;
}

//
// static properties
//

Metabuf.ffHeader = 1;
Metabuf.ffTask = 2;
Metabuf.ffOp = 4;
Metabuf.ffFlags = 8;          // include all flags as 2 hex chars
Metabuf.ffSample = 16;        // sample bit only: 0 or 1
Metabuf.ffSeparators = 32;    // separate fields with a '-'
Metabuf.ffLowercase = 64;     // lowercase alpha hex characters

Metabuf.fmtHuman = Metabuf.ffHeader | Metabuf.ffTask | Metabuf.ffOp | Metabuf.ffFlags
  | Metabuf.ffSeparators | Metabuf.ffLowercase;
Metabuf.fmtLog = Metabuf.ffTask | Metabuf.ffSample | Metabuf.ffSeparators;

//
// this module doesn't require access to ao but implements the init function so
// that the constants used for the buffer can be verified.
//
Metabuf.init = function (populatedAo) {
  const aob = populatedAo.addon;
  if (aob.Event.xtraceIdVersion !== 2) {
    throw new Error(`Metabuf: incompatible X-TRACE-ID version: ${aob.Event.xtraceIdVersion}`);
  }
  if (aob.MAX_TASK_ID_LEN !== 20) {
    throw new Error(`Metabuf: incompatible MAX_TASK_ID_LEN: ${aob.MAX_TASK_ID_LEN}`);
  }
  if (aob.MAX_OP_ID_LEN !== 8) {
    throw new Error(`Metabuf: incompatible MAX_OP_ID_LEN: ${aob.MAX_OP_ID_LEN}`);
  }
}

module.exports = Metabuf;
