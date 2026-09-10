async function waitForIceGatheringComplete(pc, timeoutMs = 3500) {
  if (!pc || pc.iceGatheringState === 'complete') return;
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    };
    const onChange = () => { if (pc.iceGatheringState === 'complete') finish(); };
    const timer = setTimeout(finish, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

class PeerLink {
  constructor(engine, peerId, polite) {
    this.engine = engine;
    this.peerId = peerId;
    this.polite = polite;
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.isSettingRemoteAnswerPending = false;
    this.senders = new Map();
    this.senderInfo = new Map();
    this.remoteTrackMetaByMid = new Map();
    this.pendingCandidates = [];
    this.restartTimer = null;
    this.pc = new RTCPeerConnection({ iceServers: engine.iceServers, bundlePolicy: 'max-bundle', iceCandidatePoolSize: 8 });
    // Signaling is carried over shared-hosting HTTP polling. Sending dozens of
    // trickle ICE candidates as individual POSTs is both slow and easy to reorder.
    // Gather candidates briefly and send one candidate-complete SDP instead.
    this.pc.onicecandidate = null;
    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        await waitForIceGatheringComplete(this.pc);
        engine.socket.send('signal', { to: peerId, data: { description: this.pc.localDescription, trackMap: this.buildTrackMap() } });
      } catch (err) {
        console.warn('negotiation failed', peerId, err);
      } finally {
        this.makingOffer = false;
      }
    };
    this.pc.ontrack = (event) => {
      const mid = event.transceiver?.mid ?? null;
      const transportMeta = mid != null ? this.remoteTrackMetaByMid.get(String(mid)) || null : null;
      engine.onRemoteTrack(peerId, event.track, event.streams[0] || new MediaStream([event.track]), transportMeta);
    };
    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      engine.dispatchEvent(new CustomEvent('peer-state', { detail: { peerId, state, iceState: this.pc.iceConnectionState } }));
      if (state === 'failed' || state === 'disconnected') this.scheduleIceRestart(state === 'disconnected' ? 2500 : 500);
      if (state === 'connected') {
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = null;
      }
    };
    this.pc.oniceconnectionstatechange = () => {
      engine.dispatchEvent(new CustomEvent('peer-state', { detail: { peerId, state: this.pc.connectionState, iceState: this.pc.iceConnectionState } }));
      if (this.pc.iceConnectionState === 'failed' || this.pc.iceConnectionState === 'disconnected') this.scheduleIceRestart(this.pc.iceConnectionState === 'disconnected' ? 2500 : 500);
    };
  }

  buildTrackMap() {
    const out = {};
    for (const info of this.senderInfo.values()) {
      const transceiver = this.pc.getTransceivers().find((t) => t.sender === info.sender);
      const mid = transceiver?.mid;
      if (mid == null || !info.sender?.track) continue;
      out[String(mid)] = {
        sourceUserId: info.sourceUserId,
        mediaType: info.mediaType
      };
    }
    return out;
  }

  applyRemoteTrackMap(trackMap) {
    if (!trackMap || typeof trackMap !== 'object' || Array.isArray(trackMap)) return;
    for (const [mid, meta] of Object.entries(trackMap)) {
      if (!meta || typeof meta !== 'object') continue;
      const mediaType = ['audio', 'camera', 'screen', 'screen-audio'].includes(meta.mediaType) ? meta.mediaType : null;
      const sourceUserId = typeof meta.sourceUserId === 'string' ? meta.sourceUserId : '';
      if (!mediaType || !sourceUserId) continue;
      this.remoteTrackMetaByMid.set(String(mid), { sourceUserId, mediaType });
    }
  }

  scheduleIceRestart(delay = 800) {
    if (this.restartTimer || this.pc.signalingState === 'closed') return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.pc.signalingState === 'closed') return;
      try { this.pc.restartIce?.(); } catch {}
    }, delay);
  }

  async flushPendingCandidates() {
    if (!this.pc.remoteDescription) return;
    const queued = this.pendingCandidates.splice(0);
    for (const candidate of queued) {
      try { await this.pc.addIceCandidate(candidate); }
      catch (err) { if (!this.ignoreOffer) console.warn('queued ICE candidate failed', this.peerId, err); }
    }
  }

  sync(entries) {
    const wanted = new Set(entries.map((x) => x.key));
    for (const [key, sender] of this.senders) {
      if (!wanted.has(key)) {
        try { this.pc.removeTrack(sender); } catch {}
        this.senders.delete(key);
        this.senderInfo.delete(key);
      }
    }
    for (const entry of entries) {
      const existing = this.senders.get(entry.key);
      if (existing?.track === entry.track) {
        this.senderInfo.set(entry.key, { sender: existing, sourceUserId: entry.sourceUserId, mediaType: entry.mediaType });
        continue;
      }
      if (existing) {
        existing.replaceTrack(entry.track).catch(() => {});
        this.senderInfo.set(entry.key, { sender: existing, sourceUserId: entry.sourceUserId, mediaType: entry.mediaType });
      } else {
        const sender = this.pc.addTrack(entry.track, entry.stream || new MediaStream([entry.track]));
        this.engine.tuneSender(sender, entry.mediaType);
        this.senders.set(entry.key, sender);
        this.senderInfo.set(entry.key, { sender, sourceUserId: entry.sourceUserId, mediaType: entry.mediaType });
      }
    }
  }

  async handleSignal(data) {
    try {
      if (data.description) {
        const description = data.description;
        this.applyRemoteTrackMap(data.trackMap);
        const readyForOffer = !this.makingOffer && (this.pc.signalingState === 'stable' || this.isSettingRemoteAnswerPending);
        const offerCollision = description.type === 'offer' && !readyForOffer;
        this.ignoreOffer = !this.polite && offerCollision;
        if (this.ignoreOffer) return;
        this.isSettingRemoteAnswerPending = description.type === 'answer';
        await this.pc.setRemoteDescription(description);
        this.isSettingRemoteAnswerPending = false;
        await this.flushPendingCandidates();
        if (description.type === 'offer') {
          await this.pc.setLocalDescription();
          await waitForIceGatheringComplete(this.pc);
          this.engine.socket.send('signal', { to: this.peerId, data: { description: this.pc.localDescription, trackMap: this.buildTrackMap() } });
        }
      } else if (data.candidate) {
        // Polling/signaling timing can deliver an ICE candidate before the matching
        // remote SDP has been applied. Queue it instead of dropping the candidate.
        if (!this.pc.remoteDescription) this.pendingCandidates.push(data.candidate);
        else {
          try { await this.pc.addIceCandidate(data.candidate); } catch (err) { if (!this.ignoreOffer) throw err; }
        }
      }
    } catch (err) {
      console.warn('signal handling failed', this.peerId, err);
    }
  }

  close() {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.pendingCandidates.length = 0;
    this.senderInfo.clear();
    this.remoteTrackMetaByMid.clear();
    this.pc.ontrack = null;
    this.pc.close();
  }
}

export class VoiceEngine extends EventTarget {
  constructor({ socket, audio, selfUserId, hostUserId, iceServers }) {
    super();
    this.socket = socket;
    this.audio = audio;
    this.selfUserId = selfUserId;
    this.hostUserId = hostUserId;
    this.isHost = selfUserId === hostUserId;
    this.iceServers = iceServers;
    this.peers = new Map();
    this.relayTracks = new Map();
    this.trackMeta = new Map();
    this.moderation = new Map();
    this.mediaState = new Map();
    this.remoteTrackKeys = new Set();
  }

  ensurePeer(peerId) {
    let link = this.peers.get(peerId);
    if (!link) {
      const polite = !this.isHost;
      link = new PeerLink(this, peerId, polite);
      this.peers.set(peerId, link);
    }
    return link;
  }

  bootstrapMembers(members) {
    if (this.isHost) {
      for (const m of members) {
        if (m.user.id !== this.selfUserId) this.ensurePeer(m.user.id);
      }
    } else {
      this.ensurePeer(this.hostUserId);
    }
    this.syncAll();
  }


  async tuneSender(sender, mediaType) {
    try {
      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      const bitrate = mediaType === 'audio' ? 96000 : mediaType === 'screen-audio' ? 128000 : mediaType === 'screen' ? 2500000 : 800000;
      params.encodings[0].maxBitrate = bitrate;
      if (mediaType === 'camera') params.degradationPreference = 'balanced';
      if (mediaType === 'screen') params.degradationPreference = 'maintain-resolution';
      await sender.setParameters(params);
    } catch {}
  }

  setTrackMeta(sourceUserId, trackId, mediaType) {
    this.trackMeta.set(trackId, { sourceUserId, mediaType });

    // Track metadata and the actual WebRTC track travel over different paths.
    // If the track arrived first, correct its classification now (especially
    // screen-share video, which otherwise looks like a camera track by kind alone).
    for (const item of this.relayTracks.values()) {
      if (item.track.id !== trackId) continue;
      const changed = item.sourceUserId !== sourceUserId || item.mediaType !== mediaType;
      item.sourceUserId = sourceUserId;
      item.mediaType = mediaType;
      if (changed && this.isHost) {
        this.socket.send('relay:track-meta', { sourceUserId, trackId, mediaType });
        this.syncAll();
      }
    }
    this.dispatchEvent(new CustomEvent('remote-track-meta', { detail: { sourceUserId, trackId, mediaType } }));
  }

  setMediaState(userId, media) {
    this.mediaState.set(userId, { ...(this.mediaState.get(userId) || {}), ...(media || {}) });
    if (this.isHost) this.syncAll();
  }

  setModeration(userId, data) {
    const current = this.moderation.get(userId) || {};
    this.moderation.set(userId, { ...current, ...data });
    if (this.isHost) this.syncAll();
  }

  outboundFor(peerId) {
    const local = this.audio.getLocalTrackEntries().map((entry) => ({ ...entry, sourceUserId: this.selfUserId }));
    if (!this.isHost) return local;
    const relayed = [];
    for (const [key, item] of this.relayTracks) {
      if (item.sourceUserId === peerId) continue;
      const mod = this.moderation.get(item.sourceUserId) || {};
      const media = this.mediaState.get(item.sourceUserId) || {};
      if (item.mediaType === 'audio' && (mod.forcedMuted || media.mic !== true)) continue;
      if (item.mediaType === 'camera' && (mod.permissions?.camera === false || media.camera !== true)) continue;
      if (item.mediaType === 'screen' && (mod.permissions?.screen === false || media.screen !== true)) continue;
      if (item.mediaType === 'screen-audio' && (mod.permissions?.screen === false || media.screen !== true)) continue;
      relayed.push({ key, track: item.track, stream: item.stream, mediaType: item.mediaType, sourceUserId: item.sourceUserId });
    }
    return [...local, ...relayed];
  }

  syncAll() {
    for (const [peerId, link] of this.peers) link.sync(this.outboundFor(peerId));
  }

  async handleSignal(from, data) {
    const allowed = this.isHost ? from !== this.selfUserId : from === this.hostUserId;
    if (!allowed) return;
    const link = this.ensurePeer(from);
    this.syncAll();
    await link.handleSignal(data);
  }

  onMemberJoined(member) {
    this.setMediaState(member.user.id, member.media || {});
    if (this.isHost && member.user.id !== this.selfUserId) {
      // A rejoin/reload represents a fresh browser WebRTC endpoint. Never reuse
      // the old RTCPeerConnection for the same account.
      this.peers.get(member.user.id)?.close();
      this.peers.delete(member.user.id);
      this.ensurePeer(member.user.id);
      this.syncAll();
      return;
    }
    if (!this.isHost && member.user.id === this.hostUserId) {
      this.peers.get(this.hostUserId)?.close();
      this.peers.delete(this.hostUserId);
      this.ensurePeer(this.hostUserId);
      this.syncAll();
    }
  }

  onMemberLeft(userId) {
    this.peers.get(userId)?.close();
    this.peers.delete(userId);
    this.mediaState.delete(userId);
    this.moderation.delete(userId);
    for (const [key, item] of [...this.relayTracks]) {
      if (item.sourceUserId === userId) this.relayTracks.delete(key);
    }
    this.syncAll();
  }

  onRemoteTrack(peerId, track, stream, transportMeta = null) {
    if (this.isHost) {
      const sourceUserId = peerId;
      const meta = transportMeta || this.trackMeta.get(track.id);
      const mediaType = meta?.mediaType || (track.kind === 'audio' ? 'audio' : 'camera');
      const key = `relay:${sourceUserId}:${track.id}`;
      this.relayTracks.set(key, { key, sourceUserId, mediaType, track, stream });
      track.addEventListener('ended', () => {
        this.relayTracks.delete(key);
        this.syncAll();
        this.dispatchEvent(new CustomEvent('remote-track-ended', { detail: { sourceUserId, trackId: track.id, mediaType } }));
      });
      this.socket.send('relay:track-meta', { sourceUserId, trackId: track.id, mediaType });
      this.syncAll();
      this.dispatchEvent(new CustomEvent('remote-track', { detail: { sourceUserId, track, stream, mediaType } }));
    } else {
      const meta = transportMeta || this.trackMeta.get(track.id);
      const sourceUserId = meta?.sourceUserId || this.hostUserId;
      const mediaType = meta?.mediaType || (track.kind === 'audio' ? 'audio' : 'camera');
      this.dispatchEvent(new CustomEvent('remote-track', { detail: { sourceUserId, track, stream, mediaType } }));
      track.addEventListener('ended', () => this.dispatchEvent(new CustomEvent('remote-track-ended', { detail: { sourceUserId, trackId: track.id, mediaType } })));
    }
  }

  close() {
    for (const link of this.peers.values()) link.close();
    this.peers.clear();
    this.relayTracks.clear();
    this.trackMeta.clear();
    this.mediaState.clear();
    this.moderation.clear();
  }
}
