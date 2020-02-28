'use strict'

//
// common file for http and https tests.
//

const helper = require('../helper')
const {ao} = require('../1.test-common')
const addon = ao.addon;

const Url = require('url');
const expect = require('chai').expect;
const crypto = require('crypto');

const {randomBytes} = require('crypto');
const WebSocket = require('ws');

if (process.env.AO_TEST_HTTP !== 'http' && process.env.AO_TEST_HTTP !== 'https') {
  throw new Error(`invalid value for AO_TEST_HTTP: ${process.env.AO_TEST_HTTP}`);
}

// p stands for protocol
const p = process.env.AO_TEST_HTTP;

const driver = require(p);

const httpsOptions = {
  key: '-----BEGIN RSA PRIVATE KEY-----\nMIICXQIBAAKBgQCsJU2dO/K3oQEh9wo60VC2ajCZjIudc8cqHl9kKNKwc9lP4Rw9\nKWso/+vHhkp6Cmx6Cshm6Hs00rPgZo9HmY//gcj0zHmNbagpmdvAmOudK8l5Npzd\nQwNROKN8EPoKjlFEBMnZj136gF5YAgEN9ydcLtS2TeLmUG1Y3RR6ADjgaQIDAQAB\nAoGBAJTD9/r1n5/JZ+0uTIzf7tx1kGJh7xW2xFtFvDIWhV0wAJDjfT/t10mrQNtA\n1oP5Fh2xy9YC+tZ/cCtw9kluD93Xhzg1Mz6n3h+ZnvnlMb9E0JCgyCznKSS6fCmb\naBz99pPJoR2JThUmcuVtbIYdasqxcHStYEXJH89Ehr85uqrBAkEA31JgRxeuR/OF\n96NJFeD95RYTDeN6JpxJv10k81TvRCxoOA28Bcv5PwDALFfi/LDya9AfZpeK3Nt3\nAW3+fqkYdQJBAMVV37vFQpfl0fmOIkMcZKFEIDx23KHTjE/ZPi9Wfcg4aeR4Y9vt\nm2f8LTaUs/buyrCLK5HzYcX0dGXdnFHgCaUCQDSc47HcEmNBLD67aWyOJULjgHm1\nLgIKsBU1jI8HY5dcHvGVysZS19XQB3Zq/j8qMPLVhZBWA5Ek41Si5WJR1EECQBru\nTUpi8WOpia51J1fhWBpqIbwevJ2ZMVz0WPg85Y2dpVX42Cf7lWnrkIASaz0X+bF+\nTMPuYzmQ0xHT3LGP0cECQQCqt4PLmzx5KtsooiXI5NVACW12GWP78/6uhY6FHUAF\nnJl51PB0Lz8F4HTuHhr+zUr+P7my7X3b00LPog2ixKiO\n-----END RSA PRIVATE KEY-----',
  cert: '-----BEGIN CERTIFICATE-----\nMIICWDCCAcGgAwIBAgIJAPIHj8StWrbJMA0GCSqGSIb3DQEBCwUAMEUxCzAJBgNV\nBAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEwHwYDVQQKDBhJbnRlcm5ldCBX\naWRnaXRzIFB0eSBMdGQwHhcNMTQwODI3MjM1MzUwWhcNMTQwOTI2MjM1MzUwWjBF\nMQswCQYDVQQGEwJBVTETMBEGA1UECAwKU29tZS1TdGF0ZTEhMB8GA1UECgwYSW50\nZXJuZXQgV2lkZ2l0cyBQdHkgTHRkMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKB\ngQCsJU2dO/K3oQEh9wo60VC2ajCZjIudc8cqHl9kKNKwc9lP4Rw9KWso/+vHhkp6\nCmx6Cshm6Hs00rPgZo9HmY//gcj0zHmNbagpmdvAmOudK8l5NpzdQwNROKN8EPoK\njlFEBMnZj136gF5YAgEN9ydcLtS2TeLmUG1Y3RR6ADjgaQIDAQABo1AwTjAdBgNV\nHQ4EFgQUTqL/t/yOtpAxKuC9zVm3PnFdRqAwHwYDVR0jBBgwFoAUTqL/t/yOtpAx\nKuC9zVm3PnFdRqAwDAYDVR0TBAUwAwEB/zANBgkqhkiG9w0BAQsFAAOBgQBn1XAm\nAsVdXKr3aiZIgOmw5q+F1lKNl/CHtAPCqwjgntPGhW08WG1ojhCQcNaCp1yfPzpm\niaUwFrgiz+JD+KvxvaBn4pb95A6A3yObADAaAE/ZfbEA397z0RxwTSVU+RFKxzvW\nyICDpugdtxRjkb7I715EjO9R7LkSe5WGzYDp/g==\n-----END CERTIFICATE-----'
};

const options = p === 'https' ? httpsOptions : {};

describe(`probes.${p} websocket`, function () {
  let emitter
  const previousHttpEnabled = ao.probes[p].enabled;
  const previousHttpClientEnabled = ao.probes[`${p}-client`].enabled;
  let clear
  let originalFlag
  // idk why eslint-disable-line prefer-const doesn't work
  let socketServer;     // eslint-disable-line

  before(function (done) {
    socketServer = new SocketServer({port: 8888});
    done();
  });
  before(function (done) {
    ao.sampleRate = addon.MAX_SAMPLE_RATE
    ao.traceMode = 'always'
    ao.g.testing(__filename)
    // intercept message for analysis
    emitter = helper.appoptics(done);
  })
  after(function (done) {
    emitter.close(done)
  })
  after(function () {
    const {spansTopSpanEnters, spansTopSpanExits} = ao.Span.getMetrics();
    ao.loggers.debug(`enters ${spansTopSpanEnters} exits ${spansTopSpanExits}`);
  })

  //
  before(function () {
    // Awful hack
    originalFlag = process.env.NODE_TLS_REJECT_UNAUTHORIZED
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  })
  after(function () {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalFlag
  })


  beforeEach(function () {
    if (this.currentTest.title === `should not report anything when ${p} probe is disabled`) {
      ao.probes[p].enabled = false
      ao.probes[`${p}-client`].enabled = false
    } else if (this.currentTest.title === 'should trace correctly within asyncrony') {
      //this.skip()
    } else if (this.currentTest.title === 'should not send a span or metrics when there is a filter for it') {
      //this.skip()
    }
  })

  afterEach(function () {
    if (this.currentTest.title === `should not report anything when ${p} probe is disabled`) {
      ao.probes[p].enabled = previousHttpEnabled
      ao.probes[`${p}-client`].enabled = previousHttpClientEnabled
    } else if (this.currentTest.title === 'should not send a span when there is a filter for it') {
      ao.specialUrls = undefined
    }
  })
  afterEach(function () {
    if (clear) {
      clear()
      clear = undefined
    }
  })

  const check = {
    server: {
      entry: function (msg) {
        expect(`${msg.Layer}:${msg.Label}`).equal('nodejs:entry');
      },
      info: function (msg) {
        expect(`${msg.Layer}:${msg.Label}`).equal('undefined:info');
      },
      error: function (msg) {
        expect(`${msg.Layer}:${msg.Label}`).equal('undefined:error');
      },
      exit: function (msg) {
        expect(`${msg.Layer}:${msg.Label}`).equal('nodejs:exit');
      }
    },
    client: {
      entry: function (msg) {
        expect(`${msg.Layer}:${msg.Label}`).equal(`${p}-client:entry`);
      },
      info: function (msg) {
        expect(`${msg.Layer}:${msg.Label}`).equal('undefined:info');
      },
      error: function (msg) {
        expect(`${msg.Layer}:${msg.Label}`).equal('undefined:error');
      },
      exit: function (msg) {
        expect(`${msg.Layer}:${msg.Label}`).equal(`${p}-client:exit`);
      }
    },
  }

  function makeOptions (url) {
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'GET',
      headers: {
        Connection: 'upgrade',
        Upgrade: 'websocket',
        // if missing the version "real" websocket servers return a 400.
        'Sec-WebSocket-Version': 13,
        // if missing the key "real" sites like websocket.org and kaazing.com
        // reset the socket resulting in an ECONNRESET error.
        'Sec-WebSocket-Key': randomBytes(16).toString('base64')
      }
    };
    return Object.assign({}, opts, options);
  }

  // these are constant for a given protocol.
  const prefix = p === 'http' ? 'ws' : 'wss';
  const url = `${p}://echo.websocket.org/`;
  const wsUrl = `${prefix}://echo.websocket.org/`
  const parsedUrl = new URL(wsUrl);

  describe(`${p}-client`, function () {
    // eslint-disable-next-line no-unused-vars
    const conf = ao.probes[p];

    after(function () {
      ao.resetTContext();
    });

    // it's possible for a local UDP send to fail but oboe doesn't report
    // it, so compensate for it.
    it('UDP might lose a message running locally', function (done) {
      helper.test(emitter, function (done) {
        ao.instrument('fake', function () {})
        done()
      }, [
        function (msg) {
          expect(msg).property('Label').oneOf(['entry', 'exit']);
          expect(msg).property('Layer', 'fake');
        }
      ], done)
    });

    it(`${p} connect to a public server`, function (done) {
      const options = makeOptions(parsedUrl);

      helper.test(
        emitter,
        // execute this function
        function (xdone) {
          const req = driver.get(options, function (res) {
            res.on('end', () => done());
            res.resume();
          })
          req.on('error', e => {
            xdone(e);
          });
          req.on('response', res => {
            throw new Error('unexpected response');
          });
          req.on('upgrade', (res, socket) => {
            socket.on('close', () => {
              xdone();
            });
            socket.end();
          });
        },
        // and perform these checks
        [
          function (msg) {
            check.client.entry(msg);
            expect(msg).property('RemoteURL', url);
            expect(msg).property('IsService', 'yes');
          },
          function (msg) {
            check.client.exit(msg);
            expect(msg).property('HTTPStatus', 101);
          }
        ],
        // end the test when complete.
        done
      );
    });

    it('WebSocket connect to a public server', function (done) {
      helper.test(
        emitter,
        function (xdone) {
          const ws = new WebSocket(wsUrl);
          ws.on('open', function () {
            ws.close();
            xdone();
          });
          ws.on('close', () => undefined);
        },
        [
          function (msg) {
            check.client.entry(msg);
            expect(msg).property('RemoteURL', url);
            expect(msg).property('IsService', 'yes');
          },
          function (msg) {
            check.client.exit(msg);
            expect(msg).property('HTTPStatus', 101);
          }
        ],
        done
      );
    });

    it(`${p} connect with missing headers should fail`, function (done) {
      const options = makeOptions(parsedUrl);
      // a server should disconnect if the key is missing
      delete options.headers['Sec-WebSocket-Version'];
      delete options.headers['Sec-WebSocket-Key'];

      helper.test(
        emitter,
        // execute this function
        function (xdone) {
          const req = driver.get(options, function (res) {
            res.on('end', () => xdone());
            res.resume();
          })
          req.on('error', e => {
            // expect ECONNRESET
            xdone(e.code === 'ECONNRESET' ? undefined : e);
          });
          req.on('response', res => {
            throw new Error('unexpected response event');
          });
          req.on('upgrade', (res, socket) => {
            throw new Error('unexpected upgrade event');
          });
        },
        // and perform these checks
        [
          function (msg) {
            check.client.entry(msg);
            expect(msg).property('RemoteURL', url);
            expect(msg).property('IsService', 'yes');
          },
          function (msg) {
            check.client.error(msg);
            expect(msg.ErrorMsg).equal('socket hang up');
          },
          function (msg) {
            check.client.exit(msg);
            expect(msg).not.property('HTTPStatus');
          }
        ],
        // end the test when complete.
        done
      );
    });

    it(`${p} connect to a non-existent server should fail`, function (done) {
      const url = `${p}://localhost:10000`;
      const parsedUrl = new URL(url);
      const options = makeOptions(parsedUrl);

      helper.test(
        emitter,
        // execute this function
        function (xdone) {
          const req = driver.get(options, function (res) {
            res.on('end', () => xdone());
            res.resume();
          })
          req.on('error', e => {
            // expect ECONNRESET
            xdone(e.code === 'ECONNREFUSED' ? undefined : e);
          });
          req.on('response', res => {
            throw new Error('unexpected response event');
          });
          req.on('upgrade', (res, socket) => {
            throw new Error('unexpected upgrade event');
          });
        },
        // and perform these checks
        [
          function (msg) {
            check.client.entry(msg);
            expect(msg).property('RemoteURL', Url.format(parsedUrl));
            expect(msg).property('IsService', 'yes');
          },
          function (msg) {
            check.client.error(msg);
            expect(msg.ErrorMsg).equal('connect ECONNREFUSED 127.0.0.1:10000');
          },
          function (msg) {
            check.client.exit(msg);
            expect(msg).not.property('HTTPStatus');
          }
        ],
        // end the test when complete.
        done
      );
    });

    it(`${p} connecting to a web server should look like a normal request`, function (done) {
      const url = `${p}://google.com`;
      const parsedUrl = new URL(url);
      const options = makeOptions(parsedUrl);

      helper.test(
        emitter,
        // execute this function
        function (xdone) {
          const req = driver.get(options, function (res) {
            res.on('end', () => xdone());
            res.resume();
          })
          req.on('error', e => {
            // there should not be a socket error.
            xdone(e.code);
          });
          req.on('response', res => {
            expect(res.statusCode).equal(400);
          });
          req.on('upgrade', (res, socket) => {
            throw new Error('unexpected upgrade event');
          });
        },
        // and perform these checks
        [
          function (msg) {
            check.client.entry(msg);
            expect(msg).property('RemoteURL', Url.format(parsedUrl));
            expect(msg).property('IsService', 'yes');
          },
          function (msg) {
            check.client.exit(msg);
            expect(msg).property('HTTPStatus', 400);
          }
        ],
        // end the test when complete.
        done
      );
    });

  });
});


//
// Tweakable websocket server. Allow testing of bad behavior if needed.
//
class SocketServer {
  constructor (options) {
    this.listening = false;
    this.isWebSocket = false;
    this.socket = undefined;
    this.options = Object.assign({port: 9999}, options);

    // yes, driver is an implicit parameter. this is a test.
    this.server = driver.createServer();

    this.server.listen(this.options.port, () => {
      this.listening = true;
    })

    this.server.on('request', this.requestHandler);
    this.server.on('error', this.errorHandler);
    this.server.on('upgrade', this.upgradeHandler);
  }

  requestHandler (req, res) {
    req.end();
  }

  errorHandler (e) {
    throw e;
  }

  upgradeHandler (req, socket) {
    if (!req.headers.upgrade || req.headers.upgrade.toLowerCase() !== 'websocket') {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }

    if (options.doChecks) {
      if (req.headers['sec-websocket-version'] !== 13 || !req.headers['sec-websocket-key']) {
        socket.close();
        return;
      }
    }

    // the client can decline but until this this is good.
    this.isWebSocket = true;
    this.socket = socket;

    // choose protocols?

    const key = req.headers['sec-websocket-key'];
    const hash = SocketServer.genHash(key);

    const headers = [
      'HTTP/1.1 101 Web Socket Protocol Handshake',
      'Upgrade: WebSocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${hash}`,
      '', ''                             // add two trailing \r\n
    ];
    socket.write(headers.join('\r\n'));

    socket.on('data', buffer => {
      const {status, opCode, message} = SocketServer.parseFrame(buffer);
      if (status && this.options.replier) {
        const reply = this.options.replier(message);

        // Convert the reply to JSON and copy it into a buffer
        const json = JSON.stringify(reply);

        socket.write(this.makeTextFrame(json));
      } else if (opCode & 0x8) {
        // websocket was closed by the client
        this.isWebSocket = false;
        this.socket = undefined;
      }
    });

    socket.on('error', e => {
      this.isWebSocket = false;
      this.socket = undefined;
    });
  }


  makeTextFrame (data) {
    // get number of bytes in the string
    const byteLength = Buffer.byteLength(data);
    // Note: we're not supporting > 65535 byte payloads at this stage
    const lengthByteCount = byteLength < 126 ? 0 : 2;
    const payloadLength = lengthByteCount === 0 ? byteLength : 126;
    const buffer = Buffer.alloc(2 + lengthByteCount + byteLength);
    // Write out the first byte, using opcode `1` to indicate that the message
    // payload contains text data
    buffer.writeUInt8(0b10000001, 0);
    buffer.writeUInt8(payloadLength, 1);
    // Write the length of the JSON payload to the second byte. Doesn't handle
    // lengths > 125 correctly.
    let payloadOffset = 2;
    if (lengthByteCount > 125) {
      throw new Error('cannot send frames larger than 125 yet, sorry');
    }
    if (lengthByteCount > 0) {
      buffer.writeUInt16BE(byteLength, 2); payloadOffset += lengthByteCount;
    }
    // Write the data to the frame buffer
    buffer.write(data, payloadOffset);
    return buffer;
  }
}

SocketServer.genHash = function (key) {
  const hash = crypto.createHash('sha1');
  hash.update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11');
  return hash.digest('base64');
}

//
// return {status, opCode [, message]}
//
// status - true if message is parsed, else false
// opCode - the nibble from the first byte of the frame or -1 if 64 bit framesize
// [message] - the parsed message if status === true
//
SocketServer.parseFrame = function (buffer) {
  const status = false;

  const firstByte = buffer.readUInt8(0);
  //const isFinalFrame = firstByte & 0x80;
  //const reserved1 = firstByte & 0x40;
  //const reserved2 = firstByte & 0x20;
  //const reserved3 = firstByte & 0x10;
  const opCode = firstByte & 0x0F;
  // this is a connection termination frame
  if (opCode === 0x8) {
    return {status, opCode};
  }
  // We only care about text frames from this point onward
  if (opCode !== 0x1) {
    return {status, opCode};
  }

  const secondByte = buffer.readUInt8(1);
  const isMasked = secondByte & 0x80;
  // Keep track of our current position as we advance through the buffer
  let currentOffset = 2;
  let payloadLength = secondByte & 0x7F;
  if (payloadLength > 125) {
    if (payloadLength === 126) {
      payloadLength = buffer.readUInt16BE(currentOffset);
      currentOffset += 2;
    } else {
      // 127
      // If this has a value, the frame size is ridiculously huge!
      const leftPart = BigInt(buffer.readUInt32BE(currentOffset));
      const rightPart = BigInt(buffer.readUInt32BE(currentOffset += 4));
      // eslint-disable-next-line space-infix-ops
      payloadLength = leftPart * 2 ** 32 + rightPart;
      // Honestly, if the frame length requires 64 bits, you're probably doing it wrong.
      return {status, opCode: -1};
    }
  }

  // get masking key
  let maskingBytes;
  if (isMasked) {
    maskingBytes = buffer.slice(currentOffset, currentOffset + 4);
    //maskingBytes = Buffer.allocUnsafe(4);
    //buffer.copy(maskingBytes, 0, currentOffset, currentOffset + 4);
    currentOffset += 4;
  }

  // Allocate somewhere to store the final message data
  const data = Buffer.alloc(payloadLength);
  // Only unmask the data if the masking bit was set to 1
  if (isMasked) {
    for (let i = 0; i < payloadLength; ++i) {
      // Read a byte from the source buffer
      const byte = buffer.readUInt8(currentOffset++);
      data.writeUInt8(byte ^ maskingBytes[i & 3], i);
    }
  } else {
    // Not masked - we can just read the data as-is
    buffer.copy(data, 0, currentOffset++);
  }

  return {status: true, opCode, message: data};
}

