import { getAuthToken, rawRequest } from './api.js';

export class WhySocket extends EventTarget {
  constructor() {
    super();
    this.clientId = crypto.randomUUID();
    this.cursor = 0;
    this.closedByUser = false;
    this.connected = false;
    this.connecting = false;
    this.currentRoomJoin = null;
    this.pollTimer = null;
    this.sendChain = Promise.resolve();
    this.online = new Set();
    this.failures = 0;
    this.outbox = [];
    this.maxOutbox = 256;
  }

  async request(path, options = {}) {
    const r = await rawRequest(path, options);
    if (!r?.ok) {
      const err = new Error(r?.data?.error || (r?.status ? `HTTP_${r.status}` : 'CONNECTION_ERROR'));
      err.code = r?.data?.error || 'CONNECTION_ERROR';
      err.status = r?.status || 0;
      throw err;
    }
    return r.data;
  }

  async connect() {
    if (this.connecting || this.closedByUser) return;
    this.connecting = true;
    try {
      const data = await this.request('/api/realtime/connect', { method: 'POST', body: { clientId: this.clientId } });
      this.cursor = Number(data.cursor || 0);
      this.connected = true;
      this.failures = 0;
      this.online = new Set(data.onlineFriendIds || []);
      this.dispatchEvent(new CustomEvent('open'));
      this.dispatchEvent(new CustomEvent('ready', { detail: { user: data.user, onlineFriendIds: [...this.online] } }));
      this.flushOutbox();
      this.schedulePoll(50);
    } catch (err) {
      this.connected = false;
      this.dispatchEvent(new CustomEvent('connect-error', { detail: { error: err.code || 'CONNECTION_ERROR', status: err.status || 0 } }));
      if (!this.closedByUser && err.status !== 401) {
        this.dispatchEvent(new CustomEvent('close'));
        setTimeout(() => this.connect(), Math.min(8000, 800 * 2 ** Math.min(this.failures++, 4)));
      }
    } finally {
      this.connecting = false;
    }
  }

  schedulePoll(delay = null) {
    if (this.closedByUser) return;
    clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => this.poll(), delay ?? (this.currentRoomJoin ? 300 : 3500));
  }

  async poll() {
    if (this.closedByUser) return;
    try {
      const q = new URLSearchParams({ clientId: this.clientId, since: String(this.cursor) });
      const data = await this.request(`/api/realtime/poll?${q}`);
      const wasDisconnected = !this.connected;
      this.connected = true;
      this.failures = 0;
      if (wasDisconnected) this.dispatchEvent(new CustomEvent('open'));
      this.applyPresence(data.onlineFriendIds || []);
      for (const msg of data.events || []) this.dispatchMessage(msg);
      this.cursor = Math.max(this.cursor, Number(data.cursor || this.cursor));
      this.flushOutbox();
      this.schedulePoll();
    } catch {
      const first = this.connected;
      this.connected = false;
      if (first) this.dispatchEvent(new CustomEvent('close'));
      if (!this.closedByUser) this.schedulePoll(Math.min(8000, 800 * 2 ** Math.min(this.failures++, 4)));
    }
  }

  applyPresence(ids) {
    const next = new Set(ids);
    for (const id of next) if (!this.online.has(id)) this.dispatchEvent(new CustomEvent('friends:presence', { detail: { userId: id, online: true } }));
    for (const id of this.online) if (!next.has(id)) this.dispatchEvent(new CustomEvent('friends:presence', { detail: { userId: id, online: false } }));
    this.online = next;
  }

  dispatchMessage(msg) {
    if (!msg?.type) return;
    this.dispatchEvent(new CustomEvent(msg.type, { detail: msg }));
    this.dispatchEvent(new CustomEvent('message', { detail: msg }));
  }

  compactOutbox(type, payload) {
    // State messages are replaceable; SDP/ICE signals are not.
    if (type === 'media:state') {
      for (let i = this.outbox.length - 1; i >= 0; i -= 1) {
        if (this.outbox[i].type === type) { this.outbox.splice(i, 1); break; }
      }
    }
    this.outbox.push({ type, payload, createdAt: Date.now() });
    if (this.outbox.length > this.maxOutbox) this.outbox.splice(0, this.outbox.length - this.maxOutbox);
  }

  flushOutbox() {
    if (!this.connected || this.closedByUser || !this.outbox.length) return;
    const queued = this.outbox.splice(0);
    for (const item of queued) {
      // ICE/SDP older than 30s is no longer useful after a prolonged outage.
      if (item.type === 'signal' && Date.now() - item.createdAt > 30000) continue;
      this.send(item.type, item.payload, true);
    }
  }

  send(type, payload = {}, fromOutbox = false) {
    if (this.closedByUser) return false;
    if (!this.connected) {
      if (!fromOutbox) this.compactOutbox(type, payload);
      if (!this.connecting && !this.pollTimer) this.connect();
      return true;
    }
    const body = { clientId: this.clientId, type, ...payload };
    this.sendChain = this.sendChain.then(async () => {
      try {
        const data = await this.request('/api/realtime/action', { method: 'POST', body });
        for (const msg of data?.events || []) this.dispatchMessage(msg);
      } catch (err) {
        if (!this.closedByUser && ['CONNECTION_ERROR', 'REQUEST_TIMEOUT'].includes(err.code || '')) {
          this.connected = false;
          this.compactOutbox(type, payload);
          this.schedulePoll(250);
          return;
        }
        this.dispatchMessage({ type: 'error', error: err.code || 'CONNECTION_ERROR' });
      }
    });
    return true;
  }

  waitUntilConnected(timeoutMs = 10000) {
    if (this.connected) return Promise.resolve();
    if (this.closedByUser) this.closedByUser = false;
    if (!this.connecting) this.connect();
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => { clearTimeout(timer); this.removeEventListener('open', onOpen); this.removeEventListener('connect-error', onError); };
      const onOpen = () => { cleanup(); resolve(); };
      const onError = (e) => { if (e.detail?.status === 401) { cleanup(); const err = new Error('AUTH_REQUIRED'); err.code = 'AUTH_REQUIRED'; reject(err); } };
      this.addEventListener('open', onOpen);
      this.addEventListener('connect-error', onError);
      timer = setTimeout(() => { cleanup(); const err = new Error('CONNECTION_TIMEOUT'); err.code = 'CONNECTION_TIMEOUT'; reject(err); }, timeoutMs);
    });
  }

  joinRoom(roomId, inviteCode = '', options = {}) {
    const join = { roomId, inviteCode, ...(options || {}) };
    this.currentRoomJoin = join;
    this.waitUntilConnected().then(() => {
      if (this.currentRoomJoin !== join) return;
      this.send('room:join', join);
      this.schedulePoll(100);
    }).catch((err) => this.dispatchMessage({ type: 'room:error', error: err.code || 'CONNECTION_ERROR' }));
  }

  joinRoomAndWait(roomId, inviteCode = '', options = {}, timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => { clearTimeout(timer); this.removeEventListener('room:joined', onJoined); this.removeEventListener('room:error', onError); };
      const onJoined = (e) => { if (e.detail?.room?.id !== roomId) return; cleanup(); resolve(e.detail); };
      const onError = (e) => { cleanup(); const err = new Error(e.detail?.error || 'ROOM_JOIN_FAILED'); err.code = e.detail?.error || 'ROOM_JOIN_FAILED'; reject(err); };
      this.addEventListener('room:joined', onJoined);
      this.addEventListener('room:error', onError);
      timer = setTimeout(() => { cleanup(); const err = new Error('ROOM_JOIN_TIMEOUT'); err.code = 'ROOM_JOIN_TIMEOUT'; reject(err); }, timeoutMs);
      this.joinRoom(roomId, inviteCode, options);
    });
  }

  leaveRoom() {
    this.send('room:leave', { deliberate: true });
    this.currentRoomJoin = null;
    // Never replay stale SDP/ICE into the next room.
    this.outbox = this.outbox.filter((item) => !['signal', 'media:announce', 'media:state', 'relay:track-meta'].includes(item.type));
    this.schedulePoll(300);
  }

  close() {
    this.closedByUser = true;
    clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.outbox.length = 0;
    this.request('/api/realtime/disconnect', { method: 'POST', body: { clientId: this.clientId } }).catch(() => {});
    this.connected = false;
  }
}
