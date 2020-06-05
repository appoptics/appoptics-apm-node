'use strict';

const net = require('net');
const EventEmitter = require('events').EventEmitter;

let aob;
try {
  aob = require('appoptics-bindings');
} catch (e) {
  aob = require('./addon-sim');
}

//
// sent by oboe
//

// common properties
// seqNo
// source
// type
// timestamp

// source 'oboe'
// type 'config'
// hostname 'collector.appoptics.com'
// port 443
// log ''
// clientId maskedKey
// buffersize 1000
// maxTransactions 200
// flushMaxWaitTime 5000
// eventsFlushInterval 2
// maxRequestSizeBytes 3000000
// proxy ''

// source 'oboe'
// type 'keep-alive'

// source 'oboe'
// type 'logging'
// message 'the log message'
// srcName 'oboe.c'
// srcLine 1113
// module 'lib'
// level fatal|error|warn|info|low|medium|high
// pid 23644
// tid 23644

// source 'agent'
// type 'error'
// error Error

// source 'collector'
// type 'remote-config'
// config remote-config-name
// value remote-config-value

//
// emitted by this module, not oboe
//

// common properties
// source
// type

// msg.source 'notifier'
// msg.type 'error'
// msg.error Error

class Notifications extends EventEmitter {
  constructor (consumer, options = {}) {
    super();
    if (typeof consumer !== 'function') {
      throw new TypeError('consumer must be a function');
    }
    // allow for testing
    if (options.aob) {
      aob = options.aob;
    }

    this.socketDir = options.socketDir || '/tmp/';
    if (!this.socketDir.endsWith('/')) {
      this.socketDir = this.socketDir + '/';
    }
    this.socketPrefix = options.socketPrefix || 'ao-notifier-';

    // the event consumer and function to call it. don't expose "this" to
    // the consumer.
    this.consumer = consumer;
    this.listener = function (...args) {consumer(...args)};
    this.on('message', this.listener);

    // set internal data to the initial state.
    this.initialize();

    // except startCount which survives across restarts.
    this.startCount = 0;

    this.startServer();
  }

  // function to initialize the notifications instance so that it can
  // be restarted without creating a new instance.
  initialize () {
    this.client = undefined;
    this.previousData = '';
    this.socket = undefined;
    this.expectedSeqNo = 0;
    this.server = undefined;
    this.serverStatus = undefined;

    this.timeoutCheckInterval = aob.Notifier.kKeepAliveIntervalSeconds * 1000 / 2;
    this.timeoutInterval = aob.Notifier.kKeepAliveIntervalSeconds * 1000 * 1.5;
    if (this.keepAliveTimerId) {
      clearInterval(this.keepAliveTimerId);
      this.keepAliveTimerId = undefined;
    }
    this.lastMessageTimestamp = NaN;
    this.stats = undefined;
    this.total = Notifications.initializeStats();
  }

  startServer (options = {}) {
    if (this.server) {
      throw new Error('server already exists');
    }
    this.total.starts += 1;

    // create a server that only allows one client.
    this.server = net.createServer(client => {
      if (this.client) {
        // TODO - close and reinitialize?
        throw new Error('more than one client connection');
      }
      this.stats = Notifications.initializeStats();
      delete this.stats.starts;

      this.client = client;
      this.client.on('end', () => {
        this.client = undefined;
      });

      const dataAvailable = data => {
        this.stats.dataEvents += 1;
        this.total.dataEvents += 1;
        this.stats.bytesRead += data.length;
        this.total.bytesRead += data.length;

        this.previousData = this.previousData + data.toString('utf8');
        // each message ends in a newline. it's possible that a full message
        // might not arrive in one 'data' event or that more than one message
        // arrives in one event.
        let ix;
        while ((ix = this.previousData.indexOf('\n')) >= 0) {
          this.stats.messages += 1;
          this.total.messages += 1;
          const json = this.previousData.substring(0, ix);
          this.previousData = this.previousData.substring(ix + 1);
          try {
            const msg = JSON.parse(json);
            this.lastMessageTimestamp = Date.now();
            this.emit('message', msg);
            if (this.expectedSeqNo !== msg.seqNo) {
              const ctx = `[${msg.source}:${msg.type}`;
              const text = `found seqNo ${msg.seqNo} when expecting ${this.expectedSeqNo} ${ctx}`;
              this.emit('message', this.errorMessage(new Error(text)));
              // set to message value so not every message will generate an
              // error if it gets out of sync once.
              this.expectedSeqNo = msg.seqNo;
            }
            this.expectedSeqNo += 1;
            this.stats.goodMessages += 1;
            this.total.goodMessages += 1;
          } catch (e) {
            // if it can't be parsed tell the consumer.
            this.emit('message', this.errorMessage(e));
          }
        }
      };

      this.client.on('data', dataAvailable);

      // once we have a client connection start the keep alive timer.
      this.keepAliveTimerId = setInterval(
        () => this.checkKeepAlive(),
        this.timeoutCheckInterval
      );
      this.keepAliveTimerId.unref();
    });
    this.serverStatus = 'created';

    // find an unused socket path. none should be in use but be cautious.
    const max = 10;
    for (let i = 0; i < max; i++) {
      this.socket = this.socketDir + this.socketPrefix + randomDigits();
      try {
        this.server.listen(this.socket);
        this.serverStatus = 'listening';
        break;
      } catch (e) {
        // not sure how to handle not being able to listen on any socket.
        // but if the error is something other than EADDRINUSE stop trying.
        if (e.code !== 'EADDRINUSE') {
          this.server.close(e => {
            this.server = undefined;
            this.serverStatus = 'initial';
          });
          break;
        }
      }
    }
    if (this.serverStatus === 'listening') {
      this.startCount += 1;
    } else {
      this.serverClose(e => {
        this.server = undefined;
        this.serverStatus = 'initial';
      });
    }

    return this.serverStatus;
  }

  async stopServer () {
    if (this.client) {
      this.client.destroy();
      this.client = undefined;
    }
    return new Promise((resolve, reject) => {
      this.server.close(err => {
        this.server = undefined;
        this.serverStatus = 'initial';
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  restart () {
    return this.stopServer()
      .then(() => {
        this.initialize();
        this.startServer();
        return this.startNotifier();
      })
  }

  startNotifier () {
    const status = aob.Notifier.init(this.socket);
    return status;
  }

  // returns promise that resolves when the requested components are stopped.
  async stopNotifier (options = {}) {
    return new Promise((resolve, reject) => {

      const status = aob.Notifier.stop();
      if (status === -1) {
        // it's "disabled" somehow but no reason to wait in this case.
        resolve(status);
        return;
      }
      if (status !== -3) {
        // it should have been "shutting-down" if it wasn't "disabled".
        reject(status);
        return;
      }

      // wait for the notifier to get to disabled state
      let counter = 0;
      const iid = setInterval(() => {
        const status = this.getStatus();
        // is it "disabled" yet?
        if (status === -1) {
          clearInterval(iid);
          resolve(status);
          return;
        }
        // the client hasn't stopped yet
        counter += 1;
        if (counter > 10) {
          clearInterval(iid);
          reject(new Error('notifier-stop timed out'));
        }
      }, 5000);
    })
  }

  checkKeepAlive () {
    if (Date.now() > this.lastMessageTimestamp + this.timeoutInterval) {
      this.restart();
    }
  }

  getStatus () {
    // OBOE_NOTIFIER_SHUTTING_DOWN -3
    // OBOE_NOTIFIER_INITIALIZING -2
    // OBOE_NOTIFIER_DISABLED -1
    // OBOE_NOTIFIER_OK 0
    // OBOE_NOTIFIER_SOCKET_PATH_TOO_LONG 1
    // OBOE_NOTIFIER_SOCKET_CREATE 2
    // OBOE_NOTIFIER_SOCKET_CONNECT 3
    // OBOE_NOTIFIER_SOCKET_WRITE_FULL 4
    // OBOE_NOTIFIER_SOCKET_WRITE_ERROR 5
    // OBOE_NOTIFIER_SHUTDOWN_TIMED_OUT 6
    return aob.Notifier.status();
  }

  getStats (clear) {
    const stats = {interval: this.stats, total: this.total};
    if (clear) {
      this.stats = Notifications.initializeStats();
      delete this.stats.starts;
    }
    return stats;
  }

  errorMessage (error) {
    this.stats.errors += 1;
    this.total.errors += 1;
    return {source: 'notifier', type: 'error', error};
  }

}

Notifications.initializeStats = function () {
  return {
    starts: 0,
    dataEvents: 0,
    messages: 0,
    goodMessages: 0,
    bytesRead: 0,
    errors: 0,
  };
}

function randomDigits () {
  return Math.trunc(Math.random() * 1000000000000);
}

module.exports = Notifications;
