const WebSocket      = require('ws');
const EventEmitter   = require('eventemitter3');
const Message        = require('./Message');

const DEFAULT_API = 'https://api.authsrng.xyz';
const DEFAULT_WS  = 'wss://api.authsrng.xyz';

class AsteriskClient extends EventEmitter {
  constructor(options = {}) {
    super();

    if (!options.token) throw new Error('AsteriskClient requires a token.');

    this.token         = options.token;
    this.prefix        = options.prefix || '!';
    this.autoReconnect = options.autoReconnect !== false;
    this.apiBase       = (options.apiBase || DEFAULT_API).replace(/\/$/, '');
    this.wsBase        = (options.wsBase  || DEFAULT_WS).replace(/\/$/, '');

    this.user          = null;
    this.commands      = new Map();
    this._ws           = null;
    this._reconnecting = false;
    this._reconnectDelay = 2000;
    this._destroyed    = false;
    this._prevUsers    = [];
  }

  // ── Public API ────────────────────────────────────────────────────────────

  login() {
    this._connect();
  }

  destroy() {
    this._destroyed = true;
    this.autoReconnect = false;
    if (this._ws) this._ws.close();
  }

  addCommand(command) {
    this.commands.set(command.name, command);
    return this;
  }

  removeCommand(name) {
    this.commands.delete(name);
    return this;
  }

  send(channel, text, options = {}) {
    this._sendWS({
      type: 'message',
      channel,
      text,
      replyTo: options.replyTo || null
    });
  }

  sendDM(username, text, options = {}) {
    this._sendWS({
      type: 'dm',
      to: username,
      text,
      replyTo: options.replyTo || null
    });
  }

  sendToNode(nodeId, channel, text, options = {}) {
    this._sendWS({
      type: 'node_message',
      nodeId,
      channel,
      text,
      replyTo: options.replyTo || null
    });
  }

  setStatus(status) {
    const valid = ['online', 'away', 'busy', 'invisible'];
    if (!valid.includes(status)) throw new Error(`Invalid status: ${status}`);
    this._sendWS({ type: 'set_status', status });
    return this._api('PATCH', '/api/profile', { status });
  }

  deleteMessage(nodeId, messageId) {
    return this._api('DELETE', `/api/nodes/${nodeId}/messages/${messageId}`);
  }

  kickFromNode(nodeId, username) {
    return this._api('POST', `/api/nodes/${nodeId}/kick/${encodeURIComponent(username)}`);
  }

  banFromNode(nodeId, username) {
    return this._api('POST', `/api/nodes/${nodeId}/ban/${encodeURIComponent(username)}`);
  }

  getProfile(username) {
    return this._api('GET', `/api/profile/${encodeURIComponent(username)}`);
  }

  getOnlineUsers() {
    return [...this._prevUsers];
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────

  _connect() {
    if (this._destroyed) return;

    this._ws = new WebSocket(`${this.wsBase}/ws?token=${encodeURIComponent(this.token)}`);

    this._ws.on('open', () => {
      this._reconnectDelay = 2000;
      this._reconnecting   = false;
    });

    this._ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      this._handle(msg);
    });

    this._ws.on('close', code => {
      this.emit('disconnect', { code });
      if (this.autoReconnect && !this._destroyed) this._scheduleReconnect();
    });

    this._ws.on('error', err => {
      this.emit('error', err);
    });
  }

  _scheduleReconnect() {
    if (this._reconnecting) return;
    this._reconnecting = true;
    setTimeout(() => {
      if (!this._destroyed) this._connect();
    }, this._reconnectDelay);
    this._reconnectDelay = Math.min(this._reconnectDelay * 1.5, 30000);
  }

  _sendWS(data) {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(data));
    }
  }

  // ── Message handling ──────────────────────────────────────────────────────

  _handle(data) {
    switch (data.type) {

      case 'history':
        if (!this.user) {
          this._verify().then(u => {
            this.user = u;
            this.emit('ready', u);
          });
        }
        break;

      case 'message': {
        const msg = new Message(data, this);
        this.emit('message', msg);
        this._handleCommand(msg);
        break;
      }

      case 'dm': {
        if (data.to !== this.user?.username) break;
        const msg = new Message(data, this);
        this.emit('dm', msg);
        this._handleCommand(msg);
        break;
      }

      case 'node_message': {
        const msg = new Message(data, this);
        this.emit('nodeMessage', msg);
        this._handleCommand(msg);
        break;
      }

      case 'system': {
        const joinMatch = data.text?.match(/^(.+) joined$/);
        const leaveMatch = data.text?.match(/^(.+) left$/);
        if (joinMatch)  this.emit('userJoin',  { username: joinMatch[1] });
        if (leaveMatch) this.emit('userLeave', { username: leaveMatch[1] });
        this.emit('system', data);
        break;
      }

      case 'user_list':
        this._prevUsers = data.users || [];
        this.emit('userList', data.users);
        break;

      case 'friends_state':
        this.emit('friendsState', data);
        break;

      case 'friend_request':
        this.emit('friendRequest', { id: data.id, from: data.from, color: data.color });
        break;

      case 'friend_accepted':
        this.emit('friendAccepted', { username: data.username, color: data.color });
        break;

      case 'rate_limit':
        if (data.remaining === 0) this.emit('rateLimited', { reset: data.reset });
        break;

      case 'kicked':
        this.emit('kicked', { reason: data.reason });
        this.destroy();
        break;
    }
  }

  _handleCommand(msg) {
    if (!msg.text?.startsWith(this.prefix)) return;
    if (!this.commands.size) return;

    const args    = msg.text.slice(this.prefix.length).trim().split(/\s+/);
    const name    = args.shift().toLowerCase();
    const command = [...this.commands.values()].find(c => c.matches(name));

    if (command) {
      try { command.execute(msg, args, this); }
      catch (err) { this.emit('error', err); }
    }
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────

  async _api(method, path, body = null) {
    const opts = {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      }
    };
    if (body && method !== 'GET' && method !== 'DELETE') opts.body = JSON.stringify(body);

    const res  = await fetch(this.apiBase + path, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async _verify() {
    return this._api('GET', '/api/verify');
  }
}

module.exports = AsteriskClient;
