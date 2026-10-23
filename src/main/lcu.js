// League Client (LCU) connection: finds the running client, makes
// authenticated requests and relays client events over its WebSocket.
// The LCU is local and only reachable from this PC; Riot does not officially
// support it, so every call here is defensive.
const https = require('https');
const fs = require('fs');
const { execFile } = require('child_process');
const { EventEmitter } = require('events');
const WebSocket = require('ws');

const DEFAULT_DIRS = ['C:\\Riot Games\\League of Legends', 'D:\\Riot Games\\League of Legends'];
const agent = new https.Agent({ rejectUnauthorized: false }); // the client uses a self-signed cert

function credentialsFromLockfile(dir) {
  try {
    const [, , port, password, protocol] = fs.readFileSync(`${dir}\\lockfile`, 'utf8').split(':');
    return { port: Number(port), password, protocol: protocol || 'https' };
  } catch { return null; }
}

// The client's command line holds the port, token and install folder, which
// also covers installs outside the default folder.
function credentialsFromProcess() {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-Command',
      "(Get-CimInstance Win32_Process -Filter \"name='LeagueClientUx.exe'\").CommandLine"],
    { windowsHide: true, timeout: 8000 }, (err, out) => {
      if (err || !out) return resolve(null);
      const port = /--app-port=(\d+)/.exec(out);
      const token = /--remoting-auth-token=([\w-]+)/.exec(out);
      resolve(port && token ? { port: Number(port[1]), password: token[1], protocol: 'https' } : null);
    });
  });
}

class Lcu extends EventEmitter {
  constructor({ override } = {}) {
    super();
    this.override = override; // "port:password" for the fake client in tests
    this.creds = null;
    this.ws = null;
    this.timer = null;
  }

  get connected() { return !!this.creds; }

  start() {
    const tick = async () => {
      if (!this.creds) await this.tryConnect();
      this.timer = setTimeout(tick, this.creds ? 10000 : 3000);
    };
    tick();
  }

  stop() {
    clearTimeout(this.timer);
    this.ws?.close();
  }

  async findCredentials() {
    if (this.override) {
      const [port, password] = this.override.split(':');
      return { port: Number(port), password, protocol: 'https' };
    }
    for (const d of DEFAULT_DIRS) {
      const c = credentialsFromLockfile(d);
      if (c) return c;
    }
    return credentialsFromProcess();
  }

  async tryConnect() {
    const creds = await this.findCredentials();
    if (!creds) return;
    this.creds = creds;
    try {
      await this.request('GET', '/lol-summoner/v1/current-summoner');
    } catch {
      this.creds = null; // client still starting or a stale lockfile
      return;
    }
    this.openSocket();
    this.emit('connected');
  }

  drop() {
    if (!this.creds) return;
    this.creds = null;
    this.ws?.removeAllListeners();
    this.ws?.close();
    this.ws = null;
    this.emit('disconnected');
  }

  auth() { return 'Basic ' + Buffer.from(`riot:${this.creds.password}`).toString('base64'); }

  request(method, path, body) {
    if (!this.creds) return Promise.reject(new Error('League client not connected'));
    const payload = body === undefined ? null : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = https.request({
        host: '127.0.0.1', port: this.creds.port, path, method, agent,
        headers: { Authorization: this.auth(), Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json' } : {}) },
        timeout: 8000,
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch { json = text; }
          if (res.statusCode >= 400) {
            const err = new Error(`${method} ${path} -> ${res.statusCode}`);
            err.status = res.statusCode;
            err.body = json;
            return reject(err);
          }
          resolve(json);
        });
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', (e) => {
        if (e.code === 'ECONNREFUSED') this.drop();
        reject(e);
      });
      if (payload) req.write(payload);
      req.end();
    });
  }

  get(path) { return this.request('GET', path); }

  openSocket() {
    const ws = new WebSocket(`wss://127.0.0.1:${this.creds.port}/`, 'wamp', {
      headers: { Authorization: this.auth() }, rejectUnauthorized: false,
    });
    this.ws = ws;
    ws.on('open', () => ws.send(JSON.stringify([5, 'OnJsonApiEvent'])));
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg[0] === 8 && msg[2]) this.emit('event', msg[2]); // { uri, eventType, data }
      } catch { /* the client sends some empty frames */ }
    });
    ws.on('close', () => { if (this.ws === ws) this.drop(); });
    ws.on('error', () => {});
  }
}

module.exports = { Lcu };
