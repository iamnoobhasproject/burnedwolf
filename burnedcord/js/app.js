import { api, setAuthToken } from './api.js';
import { WhySocket } from './socket.js';
import { AudioEngine } from './audio-engine.js?v=4.6.0';
import { VoiceEngine } from './voice-engine.js';

const $ = (s) => document.querySelector(s);
const authView = $('#authView');
const dashboardView = $('#dashboardView');
const homePanel = $('#homePanel');
const roomPanel = $('#roomPanel');
const modalRoot = $('#modalRoot');
const toastRoot = $('#toastRoot');
const SERVICE_ORIGIN = 'https://chat.whyscripts.com';
const inviteUrlFor = (code) => `${SERVICE_ORIGIN}/join?invite=${encodeURIComponent(String(code || ''))}`;

const state = {
  me: null,
  socket: null,
  audio: null,
  voice: null,
  friends: [],
  incoming: [],
  rooms: [],
  online: new Set(),
  devices: { microphones: [], outputs: [], micLabel: 'detecting', outputLabel: 'detecting', permission: 'unknown' },
  deviceProbePromise: null,
  room: null,
  members: new Map(),
  currentInvite: null,
  inviteCodeUsed: '',
  remoteMedia: new Map(),
  pendingSignals: [],
  pendingTrackMeta: new Map(),
  denoiserMode: 'browser',
  globalPtt: { supported: false, active: false, code: '' },
  globalPttUnsubscribe: null,
  deafened: false,
  audioOutput: null,
  voicePrefs: loadVoicePrefs()
};

function loadVoicePrefs() {
  const defaults = {
    voiceMode: 'voice-activity',
    pttKeyCode: 'KeyV',
    pttKeyLabel: 'V',
    pttReleaseDelay: 120,
    noiseEnabled: true,
    noiseProfile: 'strong',
    inputDeviceId: '',
    inputDeviceLabel: '',
    outputDeviceId: '',
    outputDeviceLabel: '',
    micPermissionSeen: false,
    outputVolume: 100,
    userVolumes: {},
    localMutes: {}
  };
  try {
    const saved = JSON.parse(localStorage.getItem('whyscripts.voice.preferences') || '{}');
    return {
      ...defaults,
      ...saved,
      voiceMode: saved.voiceMode === 'push-to-talk' ? 'push-to-talk' : 'voice-activity',
      pttReleaseDelay: Math.max(0, Math.min(1000, Number(saved.pttReleaseDelay ?? defaults.pttReleaseDelay))),
      noiseEnabled: saved.noiseEnabled !== false,
      noiseProfile: ['normal', 'strong', 'very-strong'].includes(saved.noiseProfile) ? saved.noiseProfile : defaults.noiseProfile,
      outputVolume: Math.max(0, Math.min(100, Number(saved.outputVolume ?? defaults.outputVolume))),
      userVolumes: saved.userVolumes && typeof saved.userVolumes === 'object' ? saved.userVolumes : {},
      localMutes: saved.localMutes && typeof saved.localMutes === 'object' ? saved.localMutes : {},
      screenVolumes: saved.screenVolumes && typeof saved.screenVolumes === 'object' ? saved.screenVolumes : {},
      screenMutes: saved.screenMutes && typeof saved.screenMutes === 'object' ? saved.screenMutes : {}
    };
  } catch {
    return defaults;
  }
}

function saveVoicePrefs() {
  try { localStorage.setItem('whyscripts.voice.preferences', JSON.stringify(state.voicePrefs)); } catch {}
}

function isTypingTarget(target) {
  if (!(target instanceof Element)) return false;
  return !!target.closest('input, textarea, select, [contenteditable="true"]');
}

function prettyKey(e) {
  if (e.code?.startsWith('Key')) return e.code.slice(3);
  if (e.code?.startsWith('Digit')) return e.code.slice(5);
  const map = { Space: 'Space', Backquote: '`', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Left Alt', AltRight: 'Right Alt' };
  return map[e.code] || e.key || e.code || 'Key';
}

function prettyMouseButton(button) {
  if (button === 3) return { code: 'Mouse4', label: 'Mouse 4' };
  if (button === 4) return { code: 'Mouse5', label: 'Mouse 5' };
  return null;
}

async function configureGlobalPtt() {
  if (!window.burnedCord?.setGlobalPtt) {
    state.globalPtt = { supported: false, active: false, code: state.voicePrefs.pttKeyCode };
    return state.globalPtt;
  }
  try {
    const result = await window.burnedCord.setGlobalPtt(
      state.voicePrefs.pttKeyCode,
      state.voicePrefs.voiceMode === 'push-to-talk'
    );
    state.globalPtt = {
      supported: result?.supported === true,
      active: result?.active === true,
      code: state.voicePrefs.pttKeyCode,
      reason: result?.reason || '',
    };
  } catch {
    state.globalPtt = { supported: false, active: false, code: state.voicePrefs.pttKeyCode, reason: 'IPC_FAILED' };
  }
  updateControls();
  return state.globalPtt;
}

function bindGlobalPttBridge() {
  if (state.globalPttUnsubscribe || !window.burnedCord?.onGlobalPtt) return;
  state.globalPttUnsubscribe = window.burnedCord.onGlobalPtt((detail = {}) => {
    if (!state.room || !state.audio || state.audio.voiceMode !== 'push-to-talk') return;
    if (detail.code && detail.code !== state.voicePrefs.pttKeyCode) return;
    state.audio.setPushToTalkPressed(detail.pressed === true);
    updateControls();
  });
}

function toast(text, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = text;
  toastRoot.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

function initials(user) {
  return (user?.displayName || user?.username || '?').split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
}

function avatarStyle() {
  return 'background:#0c0d10;border-color:rgba(255,255,255,.10);color:#cfd3db';
}

function showModal(html, modalClass = '') {
  const safeClass = String(modalClass || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const className = safeClass ? `modal ${safeClass}` : 'modal';
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="${className}">${html}</div></div>`;
  modalRoot.querySelector('.modal-backdrop').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });
}
function closeModal() { modalRoot.innerHTML = ''; }

function errorText(code) {
  const map = {
    AUTH_REQUIRED: 'Please sign in first.', INVALID_CREDENTIALS: 'Username or password is incorrect.',
    USERNAME_TAKEN: 'That username is already in use.', INVALID_INPUT: 'Please check the fields.',
    REGISTRATION_INVITE_REQUIRED: 'A registration invite code is required.', REGISTRATION_INVITE_INVALID: 'That registration invite code is invalid.', REGISTRATION_INVITE_USED: 'That registration invite code has already been used.', REGISTRATION_INVITE_LIMIT: 'You have already created your maximum of two registration invite codes.',
    USER_NOT_FOUND: 'User not found.', ALREADY_FRIENDS: 'You are already friends.', REQUEST_EXISTS: 'A friend request already exists.',
    CONNECTION_TIMEOUT: 'Could not connect to the realtime room service. Please try again.', ROOM_JOIN_TIMEOUT: 'The room was created, but the live connection did not complete in time. Please try again.',
    ROOM_FULL: 'This room is full.', ROOM_NOT_FOUND: 'This room is no longer available.', HOST_OFFLINE: 'The host is offline.',
    INVITE_INVALID: 'This invite is invalid or expired.', BANNED: 'You are banned from this room.', JOIN_DECLINED: 'The host declined the join request.', ALREADY_IN_ROOM: 'Leave your current room first.', JOIN_ALREADY_PENDING: 'You already have a join request waiting.', ROOM_ALREADY_EXISTS: 'Your saved room is still open. Use Rooms → Resume, or close it before creating a different room.', MIC_PERMISSION: 'Microphone access is required. Allow microphone access for BurnedCord in Windows and try again.', SERVICE_CAPACITY: 'The service is at its current room limit. Try again later.', ROOM_BUSY: 'This room has too many pending join requests. Try again shortly.', JOIN_TIMEOUT: 'The host did not answer the join request in time.', ROOM_MUST_BE_CLOSED: 'Close the room before deleting it permanently.',
  };
  return map[code] || code || 'Something went wrong.';
}

async function boot() {
  bindStaticEvents();
  try {
    const { user } = await api('/api/auth/me');
    await enterDashboard(user);
  } catch (err) {
    authView.classList.remove('hidden');
    if (err?.status && err.status !== 401) {
      $('#authError').textContent = 'Could not restore the session because the server did not answer correctly. Refresh once or try again in a moment.';
    }
  }
}

async function enterDashboard(user) {
  state.me = user;
  authView.classList.add('hidden');
  dashboardView.classList.remove('hidden');
  $('#selfName').textContent = user.displayName;
  $('#selfUsername').textContent = `@${user.username}`;
  $('#selfAvatar').textContent = initials(user);
  $('#selfAvatar').style.cssText = avatarStyle(user);
  state.socket = new WhySocket();
  state.audio = new AudioEngine();
  state.audio.rnnoiseEnabled = state.voicePrefs.noiseEnabled !== false;
  state.audio.noiseProfile = state.voicePrefs.noiseProfile || 'strong';
  state.audio.setVoiceMode(state.voicePrefs.voiceMode);
  state.audio.setPushToTalkReleaseDelay(state.voicePrefs.pttReleaseDelay);
  state.audio.inputDeviceId = state.voicePrefs.inputDeviceId || '';
  bindGlobalPttBridge();
  configureGlobalPtt().catch(() => {});
  bindSocketEvents();
  bindAudioEvents();
  state.socket.connect();
  state.deviceProbePromise = primeAudioDevices().catch(() => null);
  navigator.mediaDevices?.addEventListener?.('devicechange', () => {
    state.deviceProbePromise = primeAudioDevices({ requestPermission: false }).catch(() => null);
  });
  await Promise.all([refreshFriends().catch(() => {}), refreshRooms().catch(() => {})]);
  setInterval(() => refreshFriends().catch(() => {}), 20000);
  setInterval(() => refreshRooms().catch(() => {}), 15000);
  if (new URLSearchParams(location.search).get('invite')) await maybeHandleInviteUrl();
  else await maybeResumeHostedRoom();
}

function bindStaticEvents() {
  document.querySelectorAll('[data-window-action]').forEach((button) => button.addEventListener('click', () => {
    window.burnedCord?.windowAction?.(button.dataset.windowAction);
  }));
  $('#inviteHelpBtn')?.addEventListener('click', openInviteHelp);
  document.querySelectorAll('[data-auth-tab]').forEach((button) => button.addEventListener('click', () => {
    document.querySelectorAll('[data-auth-tab]').forEach((b) => b.classList.toggle('active', b === button));
    $('#loginForm').classList.toggle('hidden', button.dataset.authTab !== 'login');
    $('#registerForm').classList.toggle('hidden', button.dataset.authTab !== 'register');
    $('#authError').textContent = '';
  }));
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    try { const { user } = await api('/api/auth/login', { method: 'POST', body: { username: f.get('username'), password: f.get('password') } }); await enterDashboard(user); }
    catch (err) { $('#authError').textContent = errorText(err.code); }
  });
  $('#registerForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    try { const { user } = await api('/api/auth/register', { method: 'POST', body: { username: f.get('username'), displayName: f.get('displayName'), inviteCode: f.get('inviteCode'), password: f.get('password') } }); await enterDashboard(user); }
    catch (err) { $('#authError').textContent = errorText(err.code); }
  });
  $('#logoutBtn').addEventListener('click', async () => {
    const room = state.room;
    if (room) {
      state.socket?.leaveRoom();
      if (room.hostUserId === state.me?.id) {
        await api(`/api/rooms/${room.id}/close`, { method: 'POST' }).catch(() => {});
      }
    }
    await cleanupRoom();
    try { await window.burnedCord?.setGlobalPtt?.(state.voicePrefs.pttKeyCode, false); } catch {}
    state.socket?.close();
    try { await api('/api/auth/logout', { method: 'POST' }); } finally { setAuthToken(''); }
    location.reload();
  });
  $('#createRoomBtn').addEventListener('click', openCreateRoom);
  $('#heroCreateBtn').addEventListener('click', openCreateRoom);
  $('#refreshRoomsBtn').addEventListener('click', () => refreshRooms().catch(() => {}));
  $('#joinByCodeBtn').addEventListener('click', openJoinByCode);
  $('#addFriendBtn').addEventListener('click', openAddFriend);
  $('#leaveRoomBtn').addEventListener('click', leaveRoom);
  $('#inviteBtn').addEventListener('click', openInviteModal);
  $('#micBtn').addEventListener('click', toggleMic);
  $('#cameraBtn').addEventListener('click', toggleCamera);
  $('#screenBtn').addEventListener('click', toggleScreen);
  $('#noiseBtn').addEventListener('click', toggleNoise);
  $('#voiceModeBtn').addEventListener('click', toggleVoiceMode);
  $('#deafenBtn').addEventListener('click', toggleDeafen);
  $('#deviceBtn').addEventListener('click', openAudioSettings);
  $('#settingsBtn').addEventListener('click', openAudioSettings);
  $('#accountInvitesBtn').addEventListener('click', openAccountInvites);

  window.addEventListener('keydown', (e) => {
    if (!state.room || !state.audio || state.audio.voiceMode !== 'push-to-talk') return;
    if (isTypingTarget(e.target) || e.repeat || e.code !== state.voicePrefs.pttKeyCode) return;
    if (!state.globalPtt.active) e.preventDefault();
    state.audio.setPushToTalkPressed(true);
  }, true);
  window.addEventListener('keyup', (e) => {
    if (!state.room || !state.audio || state.audio.voiceMode !== 'push-to-talk') return;
    if (e.code !== state.voicePrefs.pttKeyCode) return;
    if (!state.globalPtt.active) e.preventDefault();
    state.audio.setPushToTalkPressed(false);
  }, true);
  window.addEventListener('focus', () => updateControls());
  window.addEventListener('blur', () => { if (!state.globalPtt.active) state.audio?.setPushToTalkPressed(false); updateControls(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && !state.globalPtt.active) state.audio?.setPushToTalkPressed(false); updateControls(); });
  document.addEventListener('pointerdown', () => resumeAllRemoteAudio().catch(() => {}), { passive: true });
}

function bindAudioEvents() {
  state.audio.addEventListener('tracks-changed', () => {
    state.voice?.syncAll();
    sendMediaState();
    renderLocalVideo();
    updateControls();
  });
  state.audio.addEventListener('state-changed', () => {
    sendMediaState();
    updateControls();
  });
  state.audio.addEventListener('announce', (e) => state.socket.send('media:announce', e.detail));
  state.audio.addEventListener('denoiser', (e) => { state.denoiserMode = e.detail.mode; updateControls(); });
  state.audio.addEventListener('speaking', () => sendMediaState());
}

function bindSocketEvents() {
  const s = state.socket;
  s.addEventListener('ready', (e) => {
    state.online = new Set(e.detail.onlineFriendIds || []);
    renderFriends();
  });
  s.addEventListener('friends:presence', (e) => {
    const { userId, online } = e.detail;
    online ? state.online.add(userId) : state.online.delete(userId);
    const friend = state.friends.find((f) => f.id === userId);
    if (friend) { friend.online = !!online; if (!online) { friend.inVoice = false; friend.hostedRoom = null; } }
    renderFriends();
    setTimeout(() => refreshFriends().catch(() => {}), 350);
  });
  s.addEventListener('room:joined', async (e) => {
    closeModal();
    const msg = e.detail;
    state.room = msg.room;
    state.members = new Map(msg.members.map((m) => [m.user.id, m]));
    // Render immediately, but DO NOT wait for microphone permission before bringing
    // up WebRTC. A host can send an offer as soon as this member joins; dropping that
    // offer while getUserMedia/RNNoise is still starting can deadlock the whole call.
    showRoom();
    // Build/resume the playback graph before remote tracks arrive. In Electron the
    // WebRTC track event often fires after the original click gesture has ended.
    await ensureRemoteAudioOutput().catch(() => null);

    let iceServers = [];
    try { ({ iceServers } = await api('/api/ice')); } catch {
      // Keep a direct-P2P fallback even if the ICE endpoint is momentarily unavailable.
      iceServers = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
    }

    state.voice?.close();
    state.voice = new VoiceEngine({ socket: s, audio: state.audio, selfUserId: state.me.id, hostUserId: state.room.hostUserId, iceServers });
    bindVoiceEvents();

    // Metadata/signals can arrive while room bootstrap is still running. Apply all
    // buffered metadata before peers are created, then flush signaling in arrival order.
    for (const meta of msg.trackMeta || []) state.voice.setTrackMeta(meta.sourceUserId, meta.trackId, meta.mediaType);
    for (const meta of state.pendingTrackMeta.values()) state.voice.setTrackMeta(meta.sourceUserId, meta.trackId, meta.mediaType);
    state.pendingTrackMeta.clear();
    for (const m of msg.members) {
      state.voice.setModeration(m.user.id, { forcedMuted: m.forcedMuted, permissions: m.permissions });
      state.voice.setMediaState(m.user.id, m.media || {});
    }
    state.voice.bootstrapMembers(msg.members);

    const queuedSignals = state.pendingSignals.splice(0);
    for (const sig of queuedSignals) await state.voice.handleSignal(sig.from, sig.data);

    // Microphone startup is intentionally asynchronous now. Once it becomes live,
    // tracks-changed will renegotiate the already-established peer connection.
    state.audio.ensureMic().then((audioTrack) => {
      if (!state.room || state.room.id !== msg.room.id) return;
      if (audioTrack) state.socket.send('media:announce', { trackId: audioTrack.id, mediaType: 'audio' });
      state.voice?.syncAll();
      sendMediaState();
    }).catch(() => {
      if (state.room?.id === msg.room.id) showHostNotice('Room opened, but microphone access is unavailable. Open Audio settings and allow a microphone to speak.');
    });

    showRoom();
    if (msg.hostOffline) showHostNotice('Host connection is recovering…');
    sendMediaState();
    refreshRooms().catch(() => {});
    refreshFriends().catch(() => {});
  });
  s.addEventListener('signal', (e) => {
    const sig = { from: e.detail.from, data: e.detail.data };
    if (state.voice) state.voice.handleSignal(sig.from, sig.data);
    else state.pendingSignals.push(sig);
  });
  s.addEventListener('room:member-joined', (e) => {
    const member = e.detail.member;
    state.members.set(member.user.id, member);
    state.voice?.setModeration(member.user.id, { forcedMuted: member.forcedMuted, permissions: member.permissions });
    state.voice?.setMediaState(member.user.id, member.media || {});
    state.voice?.onMemberJoined(member);
    renderParticipants();
    refreshRooms().catch(() => {});
    refreshFriends().catch(() => {});
  });
  s.addEventListener('room:member-left', (e) => {
    const { userId } = e.detail;
    state.members.delete(userId);
    state.voice?.onMemberLeft(userId);
    removeMediaForUser(userId);
    renderParticipants();
    refreshRooms().catch(() => {});
    refreshFriends().catch(() => {});
  });
  s.addEventListener('media:state', (e) => {
    const member = state.members.get(e.detail.userId); if (member) member.media = e.detail.media;
    state.voice?.setMediaState(e.detail.userId, e.detail.media || {});
    applyRemoteMediaPolicy(e.detail.userId);
    renderParticipants();
  });
  const applyTrackMeta = (detail) => {
    const meta = { sourceUserId: detail.sourceUserId, trackId: detail.trackId, mediaType: detail.mediaType };
    if (state.voice) state.voice.setTrackMeta(meta.sourceUserId, meta.trackId, meta.mediaType);
    else state.pendingTrackMeta.set(meta.trackId, meta);
  };
  s.addEventListener('media:track-meta', (e) => applyTrackMeta(e.detail));
  s.addEventListener('relay:track-meta', (e) => applyTrackMeta(e.detail));
  s.addEventListener('room:moderation', (e) => {
    const m = state.members.get(e.detail.userId);
    if (m) { m.forcedMuted = e.detail.forcedMuted; m.permissions = e.detail.permissions; m.media = e.detail.media; }
    state.voice?.setModeration(e.detail.userId, { forcedMuted: e.detail.forcedMuted, permissions: e.detail.permissions });
    state.voice?.setMediaState(e.detail.userId, e.detail.media || {});
    if (e.detail.userId === state.me.id) enforceSelfModeration(e.detail);
    applyRemoteMediaPolicy(e.detail.userId);
    renderParticipants();
  });
  s.addEventListener('media:rejected', async (e) => {
    if (e.detail.mediaType === 'camera' && state.audio.cameraTrack) state.audio.stopCamera();
    if (e.detail.mediaType === 'screen' && state.audio.screenTrack) state.audio.stopScreen();
    toast(e.detail.error === 'CAMERA_LIMIT' ? 'The room camera limit has been reached.' : 'Someone is already sharing their screen.', 'error');
  });
  s.addEventListener('room:join-request', (e) => openApproval(e.detail.user));
  s.addEventListener('room:waiting-approval', (e) => openWaitingForApproval(e.detail?.room));
  s.addEventListener('room:host-offline', (e) => showHostNotice(`Host disconnected. Room will close in ${e.detail.graceSeconds}s unless they reconnect.`));
  s.addEventListener('room:host-returned', () => hideHostNotice());
  s.addEventListener('room:closed', async () => { if (state.room) toast('The host closed the room.', 'error'); await cleanupRoom(); showHome(); refreshRooms().catch(() => {}); refreshFriends().catch(() => {}); });
  s.addEventListener('room:kicked', async () => { toast('You were removed from the room.', 'error'); await cleanupRoom(); showHome(); refreshRooms().catch(() => {}); });
  s.addEventListener('room:banned', async () => { toast('You were banned from the room.', 'error'); await cleanupRoom(); showHome(); refreshRooms().catch(() => {}); });
  s.addEventListener('room:error', async (e) => {
    closeModal();
    toast(errorText(e.detail.error), 'error');
    state.socket.currentRoomJoin = null;
    await cleanupRoom();
    showHome();
    refreshRooms().catch(() => {});
    refreshFriends().catch(() => {});
  });
  s.addEventListener('room:friend-invite', (e) => openIncomingInvite(e.detail));
  s.addEventListener('room:friend-invite-sent', () => toast('Invite sent.', 'success'));
  s.addEventListener('error', (e) => {
    if (e.detail.error === 'FRIEND_OFFLINE') toast('That friend is offline. Copy the invite link instead.', 'error');
    else if (e.detail.error) toast(errorText(e.detail.error), 'error');
  });
  s.addEventListener('session:replaced', async () => {
    toast('This room session moved to another tab.', 'error');
    state.socket.currentRoomJoin = null;
    await cleanupRoom();
    showHome();
  });
  s.addEventListener('close', () => { if (state.room) showHostNotice('Connection interrupted. Reconnecting…'); });
}

function bindVoiceEvents() {
  state.voice.addEventListener('remote-track', (e) => addRemoteTrack(e.detail).catch((err) => console.warn('remote track setup failed', err)));
  state.voice.addEventListener('remote-track-ended', (e) => removeRemoteTrack(e.detail.trackId));
  state.voice.addEventListener('remote-track-meta', (e) => updateRemoteTrackMeta(e.detail));
  state.voice.addEventListener('peer-state', () => { /* ICE restart / TURN fallback is automatic. */ });
}

async function refreshFriends() {
  const data = await api('/api/friends');
  state.friends = data.friends;
  state.incoming = data.incoming;
  renderFriends();
}

async function microphonePermissionState() {
  try {
    if (!navigator.permissions?.query) return 'unknown';
    const status = await navigator.permissions.query({ name: 'microphone' });
    return status?.state || 'unknown';
  } catch {
    return 'unknown';
  }
}

async function primeAudioDevices({ requestPermission = true, forcePermissionProbe = false } = {}) {
  if (!navigator.mediaDevices?.enumerateDevices) {
    state.devices = { microphones: [], outputs: [], micLabel: state.voicePrefs.inputDeviceLabel || 'unsupported', outputLabel: state.voicePrefs.outputDeviceLabel || 'system output', permission: 'unsupported' };
    renderDeviceStatus();
    return state.devices;
  }

  let probe = null;
  const micAlreadyLive = state.audio?.rawMicStream?.getAudioTracks?.().some((t) => t.readyState === 'live') || state.audio?.processedAudioTrack?.readyState === 'live';
  let permission = micAlreadyLive ? 'granted' : await microphonePermissionState();

  // On first use we ask once so Chromium can reveal real device names. After a
  // successful grant the app remembers the chosen IDs/labels. If the runtime
  // itself only granted "Allow once", we do not force a fresh prompt on every
  // page refresh; the next room join/settings action will request it again.
  const desktopRuntime = !!window.burnedCord;
  const mayProbe = requestPermission && !micAlreadyLive && (desktopRuntime || (permission !== 'denied' && (forcePermissionProbe || permission === 'granted' || !state.voicePrefs.micPermissionSeen)));
  if (mayProbe) {
    try {
      const constraints = state.voicePrefs.inputDeviceId
        ? { audio: { deviceId: { exact: state.voicePrefs.inputDeviceId } }, video: false }
        : { audio: true, video: false };
      probe = await navigator.mediaDevices.getUserMedia(constraints);
      permission = 'granted';
      state.voicePrefs.micPermissionSeen = true;
      const probeTrack = probe.getAudioTracks?.()[0];
      const settings = probeTrack?.getSettings?.() || {};
      if (settings.deviceId) state.voicePrefs.inputDeviceId = String(settings.deviceId);
      if (probeTrack?.label) state.voicePrefs.inputDeviceLabel = probeTrack.label;
    } catch (err) {
      permission = err?.name === 'NotAllowedError' ? 'denied' : 'unavailable';
    }
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const microphones = devices.filter((d) => d.kind === 'audioinput');
    const outputs = devices.filter((d) => d.kind === 'audiooutput');
    const wantedMicId = state.audio?.inputDeviceId || state.voicePrefs.inputDeviceId;
    const selectedMic = microphones.find((d) => d.deviceId === wantedMicId);
    const selectedOutput = outputs.find((d) => d.deviceId === state.voicePrefs.outputDeviceId);
    const preferredMic = selectedMic || microphones.find((d) => d.deviceId === 'default') || microphones[0];
    const preferredOutput = selectedOutput || outputs.find((d) => d.deviceId === 'default') || outputs[0];

    if (preferredMic?.deviceId && preferredMic.deviceId !== 'default') state.voicePrefs.inputDeviceId = preferredMic.deviceId;
    if (preferredMic?.label) state.voicePrefs.inputDeviceLabel = preferredMic.label;
    if (preferredOutput?.deviceId && preferredOutput.deviceId !== 'default') state.voicePrefs.outputDeviceId = preferredOutput.deviceId;
    if (preferredOutput?.label) state.voicePrefs.outputDeviceLabel = preferredOutput.label;
    saveVoicePrefs();

    state.devices = {
      microphones,
      outputs,
      micLabel: preferredMic?.label || state.voicePrefs.inputDeviceLabel || (microphones.length ? 'Microphone' : 'no microphone'),
      outputLabel: preferredOutput?.label || state.voicePrefs.outputDeviceLabel || (outputs.length ? 'System output' : 'system output'),
      permission
    };
  } finally {
    probe?.getTracks?.().forEach((t) => t.stop());
  }
  renderDeviceStatus();
  return state.devices;
}

function renderDeviceStatus() {
  const root = $('#deviceStatusBar');
  if (!root) return;
  const micBad = state.devices.permission === 'denied' || !state.devices.microphones.length;
  root.innerHTML = `<span class="${micBad ? 'bad' : 'ok'}">MIC · ${esc(state.devices.micLabel)}</span><span class="${state.devices.outputs.length ? 'ok' : ''}">OUTPUT · ${esc(state.devices.outputLabel)}</span>`;
}

async function ensureRoomAudioReady() {
  if (state.deviceProbePromise) await state.deviceProbePromise.catch(() => {});
  try {
    const track = await state.audio.ensureMic();
    state.devices.permission = 'granted';
    state.voicePrefs.micPermissionSeen = true;
    const rawTrack = state.audio.rawMicStream?.getAudioTracks?.()[0];
    const settings = rawTrack?.getSettings?.() || {};
    if (settings.deviceId) { state.voicePrefs.inputDeviceId = String(settings.deviceId); state.audio.inputDeviceId = String(settings.deviceId); }
    if (rawTrack?.label) state.voicePrefs.inputDeviceLabel = rawTrack.label;
    saveVoicePrefs();
    // Enumerate while the mic is live; Firefox/Chromium can reveal the real labels here.
    state.deviceProbePromise = primeAudioDevices({ requestPermission: false }).catch(() => null);
    return track;
  } catch (cause) {
    state.deviceProbePromise = primeAudioDevices({ requestPermission: false }).catch(() => null);
    const err = new Error('MIC_PERMISSION'); err.code = 'MIC_PERMISSION'; err.cause = cause; throw err;
  }
}

async function joinRoomReliably(roomId, inviteCode = '', options = {}) {
  if (!state.socket) { const err = new Error('CONNECTION_TIMEOUT'); err.code = 'CONNECTION_TIMEOUT'; throw err; }
  await state.socket.waitUntilConnected(10000);
  return state.socket.joinRoomAndWait(roomId, inviteCode, options, 12000);
}

async function refreshRooms() {
  const data = await api('/api/rooms/history');
  state.rooms = data.rooms || [];
  renderRooms();
}

function roomStatusText(item) {
  if (item.isOpen) {
    if (item.role === 'host') return `HOST · OPEN · ${item.activeCount}/${item.room.maxUsers}`;
    return `${item.hostOnline ? 'OPEN' : 'HOST OFFLINE'} · ${item.activeCount}/${item.room.maxUsers}`;
  }
  return item.role === 'host' ? 'HOST · CLOSED' : 'CLOSED';
}

function roomActionLabel(item) {
  if (state.room?.id === item.room.id) return 'Open';
  if (item.role === 'host') return item.isOpen ? 'Resume' : 'Reopen';
  if (item.canRejoin) return 'Rejoin';
  return '';
}

async function activateRoomItem(item) {
  if (!item?.room) return;
  if (state.room?.id === item.room.id) { showRoom(); return; }
  if (state.room) return toast('Leave your current room before switching rooms.', 'error');
  try {
    await ensureRoomAudioReady();
    if (item.role === 'host') {
      if (!item.isOpen) {
        const result = await api(`/api/rooms/${item.room.id}/reopen`, { method: 'POST' });
        state.currentInvite = result.invite || null;
        await joinRoomReliably(result.room.id, '');
      } else {
        await joinRoomReliably(item.room.id, '');
      }
      return;
    }
    if (item.canRejoin) await joinRoomReliably(item.room.id, '', { rejoin: true });
    else toast(item.isOpen ? 'The host is not available for rejoin yet.' : 'This room is closed.', 'error');
  } catch (err) {
    toast(errorText(err.code || 'MIC_PERMISSION'), 'error');
  }
}

async function deleteSavedRoom(item) {
  if (!item?.room || item.role !== 'host' || item.isOpen) return;
  showModal(`<h3>Delete saved room?</h3><p><strong>${esc(item.room.name)}</strong> will be removed permanently from your room history. It cannot be reopened after deletion.</p><div class="modal-actions"><button class="secondary" data-close type="button">Cancel</button><button id="confirmDeleteSavedRoom" class="danger-soft" type="button">Delete room</button></div>`);
  $('[data-close]').onclick = closeModal;
  $('#confirmDeleteSavedRoom').onclick = async () => {
    const button = $('#confirmDeleteSavedRoom');
    button.disabled = true;
    try {
      await api(`/api/rooms/${item.room.id}`, { method: 'DELETE' });
      closeModal();
      toast('Saved room deleted.', 'success');
      await refreshRooms();
      await refreshFriends().catch(() => {});
    } catch (err) {
      toast(errorText(err.code), 'error');
      button.disabled = false;
    }
  };
}

function renderRooms() {
  const side = $('#roomList');
  const recent = $('#recentRooms');
  if (side) {
    side.innerHTML = '';
    for (const item of state.rooms.slice(0, 8)) {
      const row = document.createElement('div'); row.className = 'room-row';
      const label = roomActionLabel(item);
      row.innerHTML = `<div class="room-copy"><strong>${esc(item.room.name)}</strong><span>${esc(roomStatusText(item))}</span></div><div class="room-row-actions"></div>`;
      if (label) {
        const b = document.createElement('button'); b.className = `room-mini-btn ${label === 'Open' || label === 'Resume' || label === 'Reopen' || label === 'Rejoin' ? 'primary-mini' : ''}`; b.textContent = label; b.onclick = () => activateRoomItem(item); row.querySelector('.room-row-actions').appendChild(b);
      }
      if (item.role === 'host' && item.isOpen && state.room?.id !== item.room.id) {
        const close = document.createElement('button'); close.className = 'room-mini-btn danger-mini'; close.textContent = '×'; close.title = 'Close room'; close.onclick = async () => { await api(`/api/rooms/${item.room.id}/close`, { method: 'POST' }).catch(() => {}); await refreshRooms(); await refreshFriends().catch(() => {}); }; row.querySelector('.room-row-actions').appendChild(close);
      }
      if (item.role === 'host' && !item.isOpen) {
        const del = document.createElement('button'); del.className = 'room-mini-btn danger-mini'; del.textContent = 'Delete'; del.title = 'Delete saved room permanently'; del.onclick = () => deleteSavedRoom(item); row.querySelector('.room-row-actions').appendChild(del);
      }
      side.appendChild(row);
    }
    if (!state.rooms.length) side.innerHTML = '<div style="color:#50545b;font-size:9px;padding:8px 6px">No rooms yet.</div>';
  }
  if (recent) {
    recent.innerHTML = '';
    const visible = state.rooms.slice(0, 5);
    if (visible.length) {
      const title = document.createElement('div'); title.className = 'recent-title'; title.textContent = 'YOUR ROOMS'; recent.appendChild(title);
      for (const item of visible) {
        const row = document.createElement('div'); row.className = 'recent-room';
        const label = roomActionLabel(item);
        row.innerHTML = `<div class="recent-room-copy"><strong>${esc(item.room.name)}</strong><span>${esc(item.role === 'host' ? roomStatusText(item) : `${item.host.displayName} · ${roomStatusText(item)}`)}</span></div><div class="recent-room-actions"></div>`;
        if (label) { const b=document.createElement('button'); b.className='room-mini-btn primary-mini'; b.textContent=label; b.onclick=()=>activateRoomItem(item); row.querySelector('.recent-room-actions').appendChild(b); }
        if (item.role === 'host' && !item.isOpen) { const d=document.createElement('button'); d.className='room-mini-btn danger-mini'; d.textContent='Delete'; d.onclick=()=>deleteSavedRoom(item); row.querySelector('.recent-room-actions').appendChild(d); }
        recent.appendChild(row);
      }
    }
  }
}

function renderFriends() {
  const root = $('#friendList');
  root.innerHTML = '';
  for (const req of state.incoming) {
    const row = document.createElement('div'); row.className = 'friend';
    row.innerHTML = `<div class="avatar" style="${avatarStyle(req.user)}">${initials(req.user)}</div><div class="friend-copy"><strong>${esc(req.user.displayName)}</strong><span>Friend request</span></div><button class="icon-btn">✓</button>`;
    row.querySelector('button').onclick = async () => { await api(`/api/friends/request/${req.requestId}/accept`, { method: 'POST' }); await refreshFriends(); };
    root.appendChild(row);
  }
  for (const friend of state.friends) {
    const online = state.online.has(friend.id) || friend.online === true;
    const hosting = online && friend.hostedRoom;
    const statusText = hosting ? `Hosting · ${friend.hostedRoom.name}` : (online ? (friend.inVoice ? 'Online · In voice' : 'Online') : 'Offline');
    const row = document.createElement('div'); row.className = 'friend';
    row.innerHTML = `<div class="avatar" style="${avatarStyle(friend)}">${initials(friend)}</div><div class="friend-copy"><strong>${esc(friend.displayName)}</strong><span class="friend-status ${online ? 'online' : ''}"><i class="status-dot"></i>${esc(statusText)}</span></div><div class="friend-actions"></div>`;
    const actions = row.querySelector('.friend-actions');
    if (state.room?.hostUserId === state.me.id && online && friend.id !== state.me.id) {
      const invite = document.createElement('button'); invite.className = 'friend-action primary-mini'; invite.textContent = 'Invite'; invite.onclick = () => inviteFriendDirect(friend); actions.appendChild(invite);
    } else if (hosting && state.room?.id !== friend.hostedRoom.id) {
      const join = document.createElement('button'); join.className = 'friend-action primary-mini'; join.textContent = 'Join'; join.onclick = () => joinFriendHostedRoom(friend); actions.appendChild(join);
    }
    root.appendChild(row);
  }
  if (!state.friends.length && !state.incoming.length) root.innerHTML = '<div style="color:#6f7888;font-size:12px;padding:10px">No friends yet.</div>';
}

async function ensureCurrentInvite() {
  if (!state.room || state.room.hostUserId !== state.me.id) return null;
  if (state.currentInvite?.code) return state.currentInvite;
  const inv = await api(`/api/rooms/${state.room.id}/invites`, { method: 'POST', body: { expiresHours: 12 } });
  state.currentInvite = inv;
  return inv;
}

async function inviteFriendDirect(friend) {
  if (!state.room || state.room.hostUserId !== state.me.id) return toast('Open your room first.', 'error');
  if (!(state.online.has(friend.id) || friend.online === true)) return toast('That friend is offline.', 'error');
  try {
    const inv = await ensureCurrentInvite();
    state.socket.send('room:invite-friend', { userId: friend.id, code: inv.code });
  } catch (err) { toast(errorText(err.code), 'error'); }
}

async function joinFriendHostedRoom(friend) {
  if (!friend.hostedRoom) return;
  if (state.room) return toast('Leave your current room before joining another.', 'error');
  try {
    await ensureRoomAudioReady();
    await joinRoomReliably(friend.hostedRoom.id, '', { friendJoin: true });
  } catch (err) { toast(errorText(err.code || 'MIC_PERMISSION'), 'error'); }
}

function openAddFriend() {
  showModal(`<h3>Add a friend</h3><p>Use their BurnedCord username. There is no text messaging system.</p><form id="friendForm" class="modal-form"><label>Username<input name="username" placeholder="username" required maxlength="24"></label><div class="modal-actions"><button type="button" class="secondary" data-close>Cancel</button><button class="primary">Send request</button></div></form>`);
  $('[data-close]').onclick = closeModal;
  $('#friendForm').onsubmit = async (e) => { e.preventDefault(); const username = new FormData(e.currentTarget).get('username'); try { await api('/api/friends/request', { method: 'POST', body: { username } }); closeModal(); toast('Friend request sent.', 'success'); } catch (err) { toast(errorText(err.code), 'error'); } };
}

function openCreateRoom(options = {}) {
  if (state.room) return toast('Leave the current room first.', 'error');
  const ignoreExisting = options?.ignoreExisting === true;
  const openOwned = !ignoreExisting ? state.rooms.find((item) => item.role === 'host' && item.isOpen) : null;
  if (openOwned) {
    showModal(`<h3>You already have an open room</h3><p><strong>${esc(openOwned.room.name)}</strong> is saved and still open. Resume that room, or close it first if you want to create a different one.</p><div class="modal-actions"><button class="danger-soft" id="closeAndCreateRoom">Close & create new</button><button class="primary" id="resumeExistingRoom">Resume room</button></div>`);
    $('#resumeExistingRoom').onclick = async () => {
      try { await ensureRoomAudioReady(); await joinRoomReliably(openOwned.room.id, ''); closeModal(); }
      catch (err) { toast(errorText(err.code || 'MIC_PERMISSION'), 'error'); }
    };
    $('#closeAndCreateRoom').onclick = async () => {
      await api(`/api/rooms/${openOwned.room.id}/close`, { method: 'POST' }).catch(() => {});
      await refreshRooms().catch(() => {});
      await refreshFriends().catch(() => {});
      closeModal();
      openCreateRoom({ ignoreExisting: true });
    };
    return;
  }
  showModal(`<h3>Start a private room</h3><p>Your PC becomes the media host. WhyScripts handles accounts and signaling; TURN is used only when direct WebRTC cannot connect.</p><form id="roomForm" class="modal-form">
    <label>Room name<input name="name" value="Private Room" maxlength="48" required></label>
    <label>Maximum people<select name="maxUsers"><option>4</option><option selected>6</option><option>8</option></select></label>
    <label>Maximum cameras<select name="maxCameras"><option>2</option><option selected>4</option></select></label>
    <label class="check-row"><input type="checkbox" name="allowCamera" checked> Allow cameras</label>
    <label class="check-row"><input type="checkbox" name="allowScreen" checked> Allow screen sharing</label>
    <label class="check-row"><input type="checkbox" name="requireApproval"> Host approves every join</label>
    <div class="modal-actions"><button type="button" class="secondary" data-close>Cancel</button><button class="primary">Open room</button></div>
  </form>`);
  $('[data-close]').onclick = closeModal;
  $('#roomForm').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    try {
      await ensureRoomAudioReady();
      await state.socket.waitUntilConnected(10000);
      const result = await api('/api/rooms', { method: 'POST', body: { name: f.get('name'), maxUsers: Number(f.get('maxUsers')), maxCameras: Number(f.get('maxCameras')), allowCamera: !!f.get('allowCamera'), allowScreen: !!f.get('allowScreen'), requireApproval: !!f.get('requireApproval') } });
      state.currentInvite = result.invite;
      state.inviteCodeUsed = '';
      closeModal();
      if (result.reused) toast('Your existing open room was resumed instead of creating a duplicate.', 'success');
      try {
        await joinRoomReliably(result.room.id, '');
      } catch (joinErr) {
        // Never leave a newly-created invisible/zombie room behind if the realtime
        // join failed. Existing saved rooms are preserved so they can be resumed.
        if (!result.reused) await api(`/api/rooms/${result.room.id}/close`, { method: 'POST' }).catch(() => {});
        await refreshRooms().catch(() => {});
        throw joinErr;
      }
      refreshRooms().catch(() => {});
    } catch (err) { toast(errorText(err.code), 'error'); }
  };
}

function openJoinByCode() {
  if (state.room) return toast('Leave the current room first.', 'error');
  showModal(`<h3>Join with invite</h3><p>Paste the invite link or invite code.</p><form id="joinCodeForm" class="modal-form"><label>Invite<input name="code" placeholder="Invite code or URL" required></label><div class="modal-actions"><button type="button" class="secondary" data-close>Cancel</button><button class="primary">Continue</button></div></form>`);
  $('[data-close]').onclick = closeModal;
  $('#joinCodeForm').onsubmit = async (e) => { e.preventDefault(); let code = String(new FormData(e.currentTarget).get('code')).trim(); try { if (code.includes('://')) code = new URL(code).searchParams.get('invite') || ''; await showInvitePreview(code); } catch { toast('Invalid invite.', 'error'); } };
}

async function showInvitePreview(code) {
  const { room, host } = await api(`/api/invites/${encodeURIComponent(code)}`);
  showModal(`<h3>${esc(room.name)}</h3><p>Hosted by <strong>${esc(host.displayName)}</strong> · up to ${room.maxUsers} people. Your media connects to the host, not to a central media server when direct WebRTC succeeds.</p><div class="modal-actions"><button class="secondary" data-close>Cancel</button><button class="primary" id="joinInviteNow">Join voice</button></div>`);
  $('[data-close]').onclick = closeModal;
  $('#joinInviteNow').onclick = async () => { try { await ensureRoomAudioReady(); state.inviteCodeUsed = code; state.currentInvite = { code, url: inviteUrlFor(code) }; await joinRoomReliably(room.id, code); closeModal(); } catch (err) { toast(errorText(err.code || 'MIC_PERMISSION'), 'error'); } };
}

async function maybeResumeHostedRoom() {
  try {
    const { rooms } = await api('/api/rooms/mine');
    const room = rooms?.[0];
    if (!room) return;
    showModal(`<h3>Your room is still open</h3><p><strong>${esc(room.name)}</strong> already exists. Resume it instead of creating a duplicate, or close it and choose another saved room.</p><div class="modal-actions"><button class="danger-soft" id="closeRecoveredRoom">Close room</button><button class="primary" id="resumeRecoveredRoom">Resume</button></div>`);
    $('#closeRecoveredRoom').onclick = async () => { await api(`/api/rooms/${room.id}/close`, { method: 'POST' }).catch(() => {}); closeModal(); await refreshRooms().catch(() => {}); await refreshFriends().catch(() => {}); };
    $('#resumeRecoveredRoom').onclick = async () => {
      try { await ensureRoomAudioReady(); await joinRoomReliably(room.id, ''); closeModal(); }
      catch { toast('Microphone permission is required to resume hosting.', 'error'); }
    };
  } catch {}
}

async function maybeHandleInviteUrl() {
  const code = new URLSearchParams(location.search).get('invite');
  if (!code) return;
  try { await showInvitePreview(code); } catch (err) { toast(errorText(err.code), 'error'); }
}

function openInviteModal() {
  if (!state.room || state.room.hostUserId !== state.me.id) return toast('Only the host can issue live friend invites.', 'error');
  const friendRows = state.friends.map((f) => {
    const online = state.online.has(f.id) || f.online === true;
    return `<div class="pending-row"><div class="avatar" style="${avatarStyle(f)}">${initials(f)}</div><div class="friend-copy"><strong>${esc(f.displayName)}</strong><span>${online ? 'Online' : 'Offline'}</span></div><button class="secondary send-friend" data-id="${f.id}" ${online ? '' : 'disabled'}>${online ? 'Invite' : 'Offline'}</button></div>`;
  }).join('') || '<p>No friends to invite yet.</p>';
  const url = state.currentInvite?.url || '';
  showModal(`<h3>Invite friends</h3><p>Online friends receive a live invite card immediately. The link remains available for manual invites.</p><div class="invite-box"><input id="inviteUrl" readonly value="${escAttr(url)}"><button id="copyInvite" class="secondary">Copy</button></div><div class="pending-list" style="margin-top:14px">${friendRows}</div><div class="modal-actions"><button class="secondary" data-close>Close</button><button id="newInvite" class="primary">New invite</button></div>`);
  $('[data-close]').onclick = closeModal;
  $('#copyInvite').onclick = async () => { if (!$('#inviteUrl').value) { const inv=await ensureCurrentInvite(); $('#inviteUrl').value=inv.url; } await copyText($('#inviteUrl').value); toast('Invite copied.', 'success'); };
  $('#newInvite').onclick = async () => { const inv = await api(`/api/rooms/${state.room.id}/invites`, { method: 'POST', body: { expiresHours: 12 } }); state.currentInvite = inv; $('#inviteUrl').value = inv.url; toast('New invite created.', 'success'); };
  document.querySelectorAll('.send-friend').forEach((b) => b.onclick = async () => { const friend=state.friends.find((f)=>f.id===b.dataset.id); if(friend) await inviteFriendDirect(friend); });
}

function openIncomingInvite(detail) {
  const tray = $('#inviteTray');
  if (!tray || !detail?.room || !detail?.from) return;
  if (state.room?.id === detail.room.id) return;
  const existing = tray.querySelector(`[data-invite-room="${CSS.escape(detail.room.id)}"]`);
  existing?.remove();
  const card = document.createElement('div');
  card.className = 'voice-invite-card';
  card.dataset.inviteRoom = detail.room.id;
  card.innerHTML = `<div class="invite-kicker">VOICE INVITE</div><strong>${esc(detail.from.displayName)}</strong><p>invited you to <b>${esc(detail.room.name)}</b>.</p><div class="invite-card-actions"><button class="secondary decline-live">Dismiss</button><button class="primary accept-live">Join</button></div>`;
  card.querySelector('.decline-live').onclick = () => card.remove();
  card.querySelector('.accept-live').onclick = async () => {
    if (state.room && state.room.id !== detail.room.id) return toast('Leave your current room before accepting this invite.', 'error');
    try {
      await ensureRoomAudioReady();
      state.inviteCodeUsed = detail.code;
      state.currentInvite = { code: detail.code, url: inviteUrlFor(detail.code) };
      card.remove();
      await joinRoomReliably(detail.room.id, detail.code);
    } catch (err) { toast(errorText(err.code || 'MIC_PERMISSION'), 'error'); }
  };
  tray.prepend(card);
  if (desktop?.notify) {
    try { desktop.notify({ title: 'BurnedCord', body: `${detail.from.displayName} invited you to ${detail.room.name}` }); } catch {}
  }
  setTimeout(() => card.remove(), 300000);
}

function openWaitingForApproval(room) {
  showModal(`<h3>Waiting for host</h3><p>${room?.name ? `<strong>${esc(room.name)}</strong> requires host approval. ` : ''}Your request is active. You will enter automatically if the host accepts it.</p><div class="modal-actions"><button class="danger-soft" id="cancelJoinRequest">Cancel request</button></div>`);
  $('#cancelJoinRequest').onclick = () => {
    state.socket?.leaveRoom();
    state.socket.currentRoomJoin = null;
    closeModal();
    showHome();
    refreshRooms().catch(() => {});
  };
}

function openApproval(user) {
  showModal(`<h3>Join request</h3><div class="pending-row"><div class="avatar" style="${avatarStyle(user)}">${initials(user)}</div><div class="friend-copy"><strong>${esc(user.displayName)}</strong><span>@${esc(user.username)}</span></div></div><div class="modal-actions"><button class="danger-soft" id="denyJoin">Decline</button><button class="primary" id="approveJoin">Allow</button></div>`);
  $('#denyJoin').onclick = () => { state.socket.send('host:approve', { userId: user.id, approve: false }); closeModal(); };
  $('#approveJoin').onclick = () => { state.socket.send('host:approve', { userId: user.id, approve: true }); closeModal(); };
}

function showRoom() {
  homePanel.classList.add('hidden'); roomPanel.classList.remove('hidden');
  $('#roomName').textContent = state.room.name;
  $('#roomMeta').textContent = `${state.room.slug} · ${state.members.size}/${state.room.maxUsers} · ${state.room.hostUserId === state.me.id ? 'You are host' : 'Host relay'}`;
  $('#inviteBtn').classList.toggle('hidden', state.room.hostUserId !== state.me.id);
  renderParticipants(); renderLocalVideo(); updateControls();
}
function showHome() { roomPanel.classList.add('hidden'); homePanel.classList.remove('hidden'); hideHostNotice(); }
function showHostNotice(text) { $('#hostNotice').textContent = text; $('#hostNotice').classList.remove('hidden'); }
function hideHostNotice() { $('#hostNotice').classList.add('hidden'); }

async function toggleMic() {
  if (!state.room) return;
  const me = state.members.get(state.me.id); if (me?.forcedMuted) return toast('The host muted your relay.', 'error');
  if (state.deafened) {
    state.deafened = false;
    state.audio.setDeafened(false);
    applyAllRemoteAudioPolicies();
    state.audio.setMicEnabled(true);
    return;
  }
  state.audio.setMicEnabled(!state.audio.micEnabled);
}

async function toggleVoiceMode() {
  if (!state.audio) return;
  const next = state.audio.voiceMode === 'push-to-talk' ? 'voice-activity' : 'push-to-talk';
  state.voicePrefs.voiceMode = next;
  state.audio.setVoiceMode(next);
  if (next === 'push-to-talk' && !state.audio.micEnabled) state.audio.setMicEnabled(true);
  saveVoicePrefs();
  await configureGlobalPtt().catch(() => {});
  updateControls();
  const pttMsg = state.globalPtt.active
    ? `Push-to-Talk enabled · hold ${state.voicePrefs.pttKeyLabel} anywhere, including games.`
    : `Push-to-Talk enabled · hold ${state.voicePrefs.pttKeyLabel}.`;
  toast(next === 'push-to-talk' ? pttMsg : 'Voice Activity enabled.', 'success');
}

function toggleDeafen() {
  if (!state.room || !state.audio) return;
  state.deafened = !state.deafened;
  state.audio.setDeafened(state.deafened);
  applyAllRemoteAudioPolicies();
  updateControls();
  toast(state.deafened ? 'Deafened. Incoming audio and your microphone are off.' : 'Undeafened.', 'success');
}
async function toggleCamera() {
  if (!state.room?.allowCamera) return toast('Cameras are disabled in this room.', 'error');
  const me = state.members.get(state.me.id); if (me?.permissions?.camera === false) return toast('The host disabled your camera.', 'error');
  try { await state.audio.setCameraEnabled(!state.audio.cameraTrack); } catch { toast('Camera permission was denied or unavailable.', 'error'); }
}
async function toggleScreen() {
  if (!state.room?.allowScreen) return toast('Screen sharing is disabled in this room.', 'error');
  const me = state.members.get(state.me.id); if (me?.permissions?.screen === false) return toast('The host disabled your screen sharing.', 'error');
  try {
    await state.audio.setScreenEnabled(!state.audio.screenTrack);
  } catch (err) {
    if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') toast('Screen sharing was cancelled.', 'error');
    else if (err?.name === 'NotFoundError') toast('No shareable screen or window was found.', 'error');
    else toast('Screen sharing could not start. Check Windows capture permissions and try again.', 'error');
    console.warn('screen sharing failed', err);
  }
}
async function toggleNoise() {
  if (!state.room) return;
  $('#noiseBtn').disabled = true;
  try {
    await state.audio.setNoiseEnabled(!state.audio.rnnoiseEnabled);
    state.voicePrefs.noiseEnabled = state.audio.rnnoiseEnabled;
    saveVoicePrefs();
    toast(state.audio.rnnoiseEnabled ? `Noise suppression enabled · ${state.audio.noiseProfile.replace('-', ' ')}.` : 'Noise suppression disabled.', 'success');
  }
  finally { $('#noiseBtn').disabled = false; }
}

function updateControls() {
  const a = state.audio?.state() || {};
  $('#micBtn').classList.toggle('off', !a.mic); $('#micBtn').classList.toggle('active', !!a.mic);
  $('#micBtn small').textContent = a.deafened ? 'Muted' : (a.mic ? (a.voiceMode === 'push-to-talk' ? (a.transmitting ? 'Talking' : 'Mic') : 'Mic') : 'Muted');
  $('#cameraBtn').classList.toggle('active', !!a.camera);
  $('#screenBtn').classList.toggle('active', !!a.screen);
  $('#noiseBtn').classList.toggle('active', !!a.noise);
  $('#noiseBtn small').textContent = a.noise ? (a.noiseProfile === 'very-strong' ? 'Noise ++' : a.noiseProfile === 'strong' ? 'Noise +' : 'Noise') : 'Noise off';
  $('#voiceModeBtn').classList.toggle('active', a.voiceMode === 'push-to-talk');
  $('#voiceModeBtn').classList.toggle('ptt-live', a.voiceMode === 'push-to-talk' && !!a.transmitting);
  $('#voiceModeBtn span').textContent = a.voiceMode === 'push-to-talk' ? 'P' : 'V';
  $('#voiceModeBtn small').textContent = a.voiceMode === 'push-to-talk' ? `PTT ${state.voicePrefs.pttKeyLabel}` : 'Voice';
  $('#deafenBtn').classList.toggle('off', !!state.deafened);
  $('#deafenBtn').classList.toggle('active', !state.deafened);
  $('#deafenBtn small').textContent = state.deafened ? 'Deafened' : 'Sound';
  const pttNotice = $('#pttNotice');
  if (pttNotice) {
    const active = !!state.room && a.voiceMode === 'push-to-talk';
    pttNotice.classList.toggle('hidden', !active);
    if (active) {
      if (state.globalPtt.active) {
        pttNotice.textContent = `Push-to-Talk · hold ${state.voicePrefs.pttKeyLabel} · GLOBAL. The key still reaches the focused game while BurnedCord listens in the background.`;
      } else {
        const focusText = document.hasFocus() && !document.hidden ? 'Ready' : 'Not focused';
        pttNotice.textContent = `Push-to-Talk · hold ${state.voicePrefs.pttKeyLabel} · ${focusText}. Browser fallback is focus-bound.`;
      }
    }
  }
}

function sendMediaState() {
  if (!state.room) return;
  const a = state.audio.state();
  state.socket.send('media:state', { media: { mic: a.mic, camera: a.camera, screen: a.screen, speaking: !!a.speaking } });
  const me = state.members.get(state.me.id); if (me) me.media = { ...me.media, mic: a.mic, camera: a.camera, screen: a.screen, speaking: !!a.speaking };
  renderParticipants();
}

function enforceSelfModeration(detail) {
  if (detail.forcedMuted) state.audio.setMicEnabled(false);
  if (detail.permissions?.camera === false && state.audio.cameraTrack) state.audio.setCameraEnabled(false);
  if (detail.permissions?.screen === false && state.audio.screenTrack) state.audio.setScreenEnabled(false);
}

function renderParticipants() {
  if (!state.room) return;
  $('#roomMeta').textContent = `${state.room.slug} · ${state.members.size}/${state.room.maxUsers} · ${state.room.hostUserId === state.me.id ? 'You are host' : 'Host relay'}`;
  const root = $('#participantStrip'); root.innerHTML = '';
  for (const m of state.members.values()) {
    const chip = document.createElement('div');
    chip.className = `participant-chip ${m.media?.speaking ? 'speaking' : ''}`;
    const status = [m.media?.mic ? 'MIC' : 'MUTED', m.media?.camera ? 'CAM' : '', m.media?.screen ? 'SCREEN' : ''].filter(Boolean).join(' · ');
    chip.innerHTML = `<div class="avatar" style="${avatarStyle(m.user)}">${initials(m.user)}</div><div class="participant-copy"><strong>${esc(m.user.displayName)}${m.isHost ? ' · HOST' : ''}</strong><small>${status}</small></div>`;

    if (m.user.id !== state.me.id) {
      chip.oncontextmenu = (e) => { e.preventDefault(); openParticipantAudio(m.user.id); };
      const localAudio = document.createElement('button');
      localAudio.className = `local-volume-btn ${isUserLocallyMuted(m.user.id) ? 'muted' : ''}`;
      localAudio.type = 'button';
      localAudio.title = 'Your local volume for this person';
      localAudio.textContent = isUserLocallyMuted(m.user.id) ? 'MUTE' : `${getUserVolume(m.user.id)}%`;
      localAudio.onclick = () => openParticipantAudio(m.user.id);
      chip.appendChild(localAudio);
    }

    if (state.room.hostUserId === state.me.id && m.user.id !== state.me.id) {
      const tools = document.createElement('div'); tools.className = 'host-tools';
      const buttons = [
        [m.forcedMuted ? 'UM' : 'M','Host mute / unmute relay',() => state.socket.send('host:moderate',{ userId:m.user.id, forcedMuted:!m.forcedMuted })],
        [m.permissions?.camera === false ? 'C+' : 'C','Camera permission',() => state.socket.send('host:moderate',{ userId:m.user.id, cameraAllowed:m.permissions?.camera===false })],
        [m.permissions?.screen === false ? 'S+' : 'S','Screen permission',() => state.socket.send('host:moderate',{ userId:m.user.id, screenAllowed:m.permissions?.screen===false })],
        ['K','Kick',() => state.socket.send('host:kick',{ userId:m.user.id })],
        ['B','Ban',() => { if(confirm(`Ban ${m.user.displayName} from this room?`)) state.socket.send('host:ban',{ userId:m.user.id }); }]
      ];
      for (const [label,title,fn] of buttons) { const b=document.createElement('button');b.textContent=label;b.title=title;b.onclick=fn;tools.appendChild(b); }
      chip.appendChild(tools);
    }
    root.appendChild(chip);
  }
}

function getUserVolume(userId) {
  const value = Number(state.voicePrefs.userVolumes?.[userId] ?? 100);
  return Math.max(0, Math.min(200, Math.round(value)));
}

function isUserLocallyMuted(userId) {
  return state.voicePrefs.localMutes?.[userId] === true;
}

function setUserVolume(userId, value) {
  state.voicePrefs.userVolumes[userId] = Math.max(0, Math.min(200, Number(value) || 0));
  saveVoicePrefs();
  applyRemoteMediaPolicy(userId);
  renderParticipants();
}

function setUserLocalMute(userId, muted) {
  state.voicePrefs.localMutes[userId] = !!muted;
  saveVoicePrefs();
  applyRemoteMediaPolicy(userId);
  renderParticipants();
}

function getScreenVolume(userId) {
  const value = Number(state.voicePrefs.screenVolumes?.[userId] ?? 100);
  return Math.max(0, Math.min(200, Math.round(value)));
}

function isScreenLocallyMuted(userId) {
  return state.voicePrefs.screenMutes?.[userId] === true;
}

function setScreenVolume(userId, value) {
  state.voicePrefs.screenVolumes[userId] = Math.max(0, Math.min(200, Number(value) || 0));
  saveVoicePrefs();
  applyRemoteMediaPolicy(userId);
}

function setScreenLocalMute(userId, muted) {
  state.voicePrefs.screenMutes[userId] = !!muted;
  saveVoicePrefs();
  applyRemoteMediaPolicy(userId);
}

function openScreenAudio(userId) {
  const member = state.members.get(userId);
  if (!member || userId === state.me?.id) return;
  const volume = getScreenVolume(userId);
  const muted = isScreenLocallyMuted(userId);
  const hasAudio = [...state.remoteMedia.values()].some((item) => item.sourceUserId === userId && item.mediaType === 'screen-audio');
  showModal(`<h3>${esc(member.user.displayName)} · Screen audio</h3><p>${hasAudio ? 'Adjust the audio carried with this screen share.' : 'This share is not currently sending computer audio. These settings will apply automatically if it starts.'}</p>
    <div class="local-audio-panel">
      <label class="range-label"><span>Screen volume</span><output id="screenVolumeValue">${volume}%</output><input id="screenVolumeRange" type="range" min="0" max="200" step="1" value="${volume}"></label>
      <label class="check-row"><input id="screenMuteCheck" type="checkbox" ${muted ? 'checked' : ''}> Mute this shared screen locally</label>
    </div>
    <div class="modal-actions"><button id="resetScreenAudio" class="secondary" type="button">Reset</button><button class="primary" type="button" data-close>Done</button></div>`);
  $('[data-close]').onclick = closeModal;
  $('#screenVolumeRange').oninput = (e) => {
    $('#screenVolumeValue').textContent = `${e.target.value}%`;
    setScreenVolume(userId, Number(e.target.value));
  };
  $('#screenMuteCheck').onchange = (e) => setScreenLocalMute(userId, e.target.checked);
  $('#resetScreenAudio').onclick = () => {
    state.voicePrefs.screenVolumes[userId] = 100;
    state.voicePrefs.screenMutes[userId] = false;
    saveVoicePrefs();
    applyRemoteMediaPolicy(userId);
    closeModal();
  };
}

function openParticipantAudio(userId) {
  const member = state.members.get(userId);
  if (!member || userId === state.me?.id) return;
  const volume = getUserVolume(userId);
  const muted = isUserLocallyMuted(userId);
  showModal(`<h3>${esc(member.user.displayName)}</h3><p>These controls only change what <strong>you</strong> hear. They do not affect the host relay or anyone else in the room.</p>
    <div class="local-audio-panel">
      <label class="range-label"><span>User volume</span><output id="userVolumeValue">${volume}%</output><input id="userVolumeRange" type="range" min="0" max="200" step="1" value="${volume}"></label>
      <label class="check-row"><input id="localMuteCheck" type="checkbox" ${muted ? 'checked' : ''}> Mute this person locally</label>
    </div>
    <div class="modal-actions"><button id="resetUserAudio" class="secondary" type="button">Reset</button><button class="primary" type="button" data-close>Done</button></div>`);
  $('[data-close]').onclick = closeModal;
  $('#userVolumeRange').oninput = (e) => {
    $('#userVolumeValue').textContent = `${e.target.value}%`;
    setUserVolume(userId, Number(e.target.value));
  };
  $('#localMuteCheck').onchange = (e) => setUserLocalMute(userId, e.target.checked);
  $('#resetUserAudio').onclick = () => {
    state.voicePrefs.userVolumes[userId] = 100;
    state.voicePrefs.localMutes[userId] = false;
    saveVoicePrefs();
    applyRemoteMediaPolicy(userId);
    closeModal();
    renderParticipants();
  };
}

async function ensureRemoteAudioOutput() {
  // BurnedCord 4.5 uses native HTMLMediaElement playback for each remote audio
  // track. This is the same primitive used by the browser version and avoids a
  // WebAudio -> MediaStreamDestination -> hidden <audio> chain that proved
  // fragile inside Electron.
  if (!state.audioOutput) state.audioOutput = { direct: true };
  return state.audioOutput;
}

async function resumeRemoteAudio() {
  let ok = true;
  for (const item of state.remoteMedia.values()) {
    if (!item.fallbackEl) continue;
    try { await item.fallbackEl.play(); } catch { ok = false; }
  }
  return ok;
}

async function resumeAllRemoteAudio() {
  return resumeRemoteAudio();
}

async function setOutputDevice(deviceId, { persist = true, quiet = false } = {}) {
  const id = String(deviceId || '');
  if (persist) {
    state.voicePrefs.outputDeviceId = id;
    saveVoicePrefs();
  }
  for (const item of state.remoteMedia.values()) {
    if ((item.mediaType === 'audio' || item.mediaType === 'screen-audio') && item.fallbackEl && typeof item.fallbackEl.setSinkId === 'function') {
      try { await item.fallbackEl.setSinkId(id); }
      catch (err) { if (!quiet) throw err; }
    }
  }
}

function setGlobalOutputVolume(value) {
  state.voicePrefs.outputVolume = Math.max(0, Math.min(100, Number(value) || 0));
  saveVoicePrefs();
  applyAllRemoteAudioPolicies();
}

async function destroyRemoteAudioOutput() {
  state.audioOutput = null;
}

function applyAllRemoteAudioPolicies() {
  for (const member of state.members.values()) applyRemoteMediaPolicy(member.user.id);
}

async function addRemoteTrack({ sourceUserId, track, stream, mediaType }) {
  if (track.kind === 'audio') {
    const audioStream = new MediaStream([track]);
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.playsInline = true;
    audio.preload = 'auto';
    audio.srcObject = audioStream;
    audio.dataset.trackId = track.id;
    audio.style.display = 'none';
    roomPanel.appendChild(audio);
    if (state.voicePrefs.outputDeviceId && typeof audio.setSinkId === 'function') {
      await audio.setSinkId(state.voicePrefs.outputDeviceId).catch(() => {});
    }
    const item = { el: audio, sourceUserId, mediaType, stream: audioStream, sourceNode: null, gainNode: null, fallbackEl: audio };
    state.remoteMedia.set(track.id, item);
    applyRemoteMediaPolicy(sourceUserId);
    await audio.play().catch(() => {});
    return;
  }
  const user = state.members.get(sourceUserId)?.user || { displayName: 'Participant', avatarSeed: 'x' };
  const tile = document.createElement('div'); tile.className = `media-tile ${mediaType === 'screen' ? 'screen' : ''}`; tile.dataset.trackId = track.id;
  const video = document.createElement('video'); video.autoplay = true; video.playsInline = true; video.srcObject = new MediaStream([track]);
  const overlay = document.createElement('div'); overlay.className = 'tile-overlay'; overlay.innerHTML = `<span class="tile-name">${esc(user.displayName)} · ${mediaType === 'screen' ? 'Screen' : 'Camera'}</span>`;
  tile.append(video, overlay); $('#mediaGrid').appendChild(tile); video.play().catch(() => {});
  if (mediaType === 'screen') {
    tile.title = 'Right-click to adjust screen audio';
    tile.oncontextmenu = (e) => { e.preventDefault(); openScreenAudio(sourceUserId); };
  }
  state.remoteMedia.set(track.id, { el: tile, sourceUserId, mediaType });
  applyRemoteMediaPolicy(sourceUserId);
}

function applyRemoteMediaPolicy(userId) {
  const member = state.members.get(userId);
  if (!member) return;
  for (const item of state.remoteMedia.values()) {
    if (item.sourceUserId !== userId) continue;
    if (item.mediaType === 'audio' || item.mediaType === 'screen-audio') {
      const isScreenAudio = item.mediaType === 'screen-audio';
      const blocked = isScreenAudio
        ? (state.deafened || member.permissions?.screen === false || member.media?.screen !== true || isScreenLocallyMuted(userId))
        : (state.deafened || !!member.forcedMuted || member.media?.mic !== true || isUserLocallyMuted(userId));
      const localGain = (isScreenAudio ? getScreenVolume(userId) : getUserVolume(userId)) / 100;
      if (item.gainNode && state.audioOutput?.ctx) {
        const target = blocked ? 0 : localGain;
        try { item.gainNode.gain.setTargetAtTime(target, state.audioOutput.ctx.currentTime, 0.012); }
        catch { item.gainNode.gain.value = target; }
      }
      if (item.fallbackEl) {
        item.fallbackEl.muted = blocked;
        item.fallbackEl.volume = Math.max(0, Math.min(1, localGain * (state.voicePrefs.outputVolume / 100)));
      }
      continue;
    }
    if (item.mediaType === 'camera') {
      const blocked = member.permissions?.camera === false || member.media?.camera !== true;
      item.el.classList?.toggle('hidden', blocked);
      continue;
    }
    if (item.mediaType === 'screen') {
      const blocked = member.permissions?.screen === false || member.media?.screen !== true;
      item.el.classList?.toggle('hidden', blocked);
    }
  }
}

function renderLocalVideo() {
  if (!state.room) return;
  document.querySelectorAll('[data-local-media]').forEach((x) => x.remove());
  const add = (track, mediaType) => {
    if (!track) return;
    const tile = document.createElement('div'); tile.className = `media-tile ${mediaType === 'screen' ? 'screen' : ''}`; tile.dataset.localMedia = mediaType;
    const video = document.createElement('video'); video.autoplay = true; video.muted = true; video.playsInline = true; video.srcObject = new MediaStream([track]);
    const overlay = document.createElement('div'); overlay.className = 'tile-overlay'; overlay.innerHTML = `<span class="tile-name">You · ${mediaType === 'screen' ? `Screen${state.audio.screenAudioTrack ? ' · system audio' : ''}` : 'Camera'}</span>`;
    tile.append(video, overlay); $('#mediaGrid').prepend(tile); video.play().catch(() => {});
  };
  add(state.audio.cameraTrack, 'camera'); add(state.audio.screenTrack, 'screen');
}

function updateRemoteTrackMeta({ sourceUserId, trackId, mediaType }) {
  const item = state.remoteMedia.get(trackId);
  if (!item) return;
  item.sourceUserId = sourceUserId || item.sourceUserId;
  if (!mediaType || item.mediaType === mediaType) {
    applyRemoteMediaPolicy(item.sourceUserId);
    return;
  }
  item.mediaType = mediaType;
  if (item.el?.classList) {
    item.el.classList.toggle('screen', mediaType === 'screen');
    const user = state.members.get(item.sourceUserId)?.user || { displayName: 'Participant' };
    const label = item.el.querySelector?.('.tile-name');
    if (label) label.textContent = `${user.displayName} · ${mediaType === 'screen' ? 'Screen' : 'Camera'}`;
    if (mediaType === 'screen') {
      item.el.title = 'Right-click to adjust screen audio';
      item.el.oncontextmenu = (e) => { e.preventDefault(); openScreenAudio(item.sourceUserId); };
    }
  }
  applyRemoteMediaPolicy(item.sourceUserId);
}

function removeRemoteTrack(trackId) {
  const item = state.remoteMedia.get(trackId); if (!item) return;
  try { item.sourceNode?.disconnect?.(); } catch {}
  try { item.gainNode?.disconnect?.(); } catch {}
  try { item.fallbackEl?.pause?.(); } catch {}
  item.el?.remove?.();
  item.fallbackEl?.remove?.();
  state.remoteMedia.delete(trackId);
}
function removeMediaForUser(userId) { for (const [id,item] of [...state.remoteMedia]) if (item.sourceUserId === userId) removeRemoteTrack(id); }
function clearRemoteMedia() { for (const [id] of [...state.remoteMedia]) removeRemoteTrack(id); }

async function leaveRoom() {
  if (!state.room) return;
  const wasHost = state.room.hostUserId === state.me.id; const id = state.room.id;
  state.socket.leaveRoom();
  if (wasHost) await api(`/api/rooms/${id}/close`, { method: 'POST' }).catch(() => {});
  await cleanupRoom(); showHome();
  setTimeout(() => { refreshRooms().catch(() => {}); refreshFriends().catch(() => {}); }, 450);
}

async function cleanupRoom() {
  state.voice?.close(); state.voice = null; clearRemoteMedia();
  await destroyRemoteAudioOutput();
  state.deafened = false;
  if (state.audio) {
    state.audio.setDeafened(false);
    state.audio.setPushToTalkPressed(false);
    state.audio.stopCamera(); state.audio.stopScreen(); await state.audio.releaseMic().catch(() => {});
  }
  state.room = null; state.members.clear(); state.currentInvite = null; state.inviteCodeUsed = '';
  state.pendingSignals.length = 0; state.pendingTrackMeta.clear();
  if (state.socket) state.socket.currentRoomJoin = null;
}



async function openInviteHelp() {
  showModal(`<h3>How to get an invite key</h3><p>BurnedCord registration is invite-only. Ask an existing BurnedCord member for a registration key.</p>
    <div class="invite-help-card"><strong>Member invitations</strong><p>Each BurnedCord account can create up to two lifetime single-use registration keys from the account invite menu.</p></div>
    <div class="modal-actions"><button class="secondary" data-close type="button">Close</button></div>`);
  $('[data-close]').onclick = closeModal;
}

async function chooseDesktopSource() {
  if (!window.burnedCord?.getScreenSources) return null;
  const sources = await window.burnedCord.getScreenSources();
  if (!Array.isArray(sources) || !sources.length) throw Object.assign(new Error('NO_SCREEN_SOURCE'), { name: 'NotFoundError' });
  let caps = { systemAudio: true };
  try { if (window.burnedCord?.getMediaCapabilities) caps = await window.burnedCord.getMediaCapabilities(); } catch {}
  return new Promise((resolve) => {
    const cards = sources.map((source, index) => `<button type="button" class="screen-source" data-source-index="${index}">${source.thumbnail ? `<img src="${escAttr(source.thumbnail)}" alt="">` : '<div class="screen-source-placeholder"></div>'}<span>${esc(source.name)}</span></button>`).join('');
    showModal(`<div class="screen-picker"><h3>Share your screen</h3><p>Choose a display or application window. BurnedCord captures the selected source directly from the desktop.</p>
      <div class="screen-picker-toolbar"><span class="eyebrow">SOURCE</span><div class="screen-share-options"><label>Quality<select id="screenQuality"><option value="1080p30" selected>1080p · 30 FPS</option><option value="720p60">720p · 60 FPS</option><option value="1440p30">1440p · 30 FPS</option></select></label>${caps.systemAudio ? '<label class="check-row share-audio-check"><input id="shareSystemAudio" type="checkbox" checked> Share computer audio</label>' : ''}</div></div>
      <div class="screen-source-grid">${cards}</div><div class="modal-actions"><span class="screen-share-hint">Viewers can right-click the shared screen to adjust its audio locally.</span><button class="secondary" data-close type="button">Cancel</button></div></div>`, 'modal-screen-share');
    const cancel = () => { closeModal(); resolve(null); };
    $('[data-close]').onclick = cancel;
    document.querySelectorAll('.screen-source').forEach((button) => button.onclick = () => {
      const source = sources[Number(button.dataset.sourceIndex)];
      const quality = $('#screenQuality')?.value || '1080p30';
      const includeAudio = $('#shareSystemAudio') ? $('#shareSystemAudio').checked : false;
      closeModal(); resolve({ id: source.id, name: source.name, quality, includeAudio });
    });
  });
}
window.__burnedCordChooseScreenSource = chooseDesktopSource;


async function openAccountInvites() {
  try {
    const data = await api('/api/account/invites');
    const invites = data.invites || [];
    const rows = invites.map((inv) => {
      const used = inv.status === 'used';
      const status = used ? `Used by ${esc(inv.usedBy?.displayName || inv.usedBy?.username || 'a member')}` : 'Unused · one registration';
      return `<div class="account-invite-row"><div><strong>${esc(inv.code)}</strong><span>${esc(status)}</span></div>${used ? '' : `<button class="secondary copy-account-invite" data-code="${escAttr(inv.code)}" type="button">Copy</button>`}</div>`;
    }).join('');
    const remaining = Number(data.remaining || 0);
    showModal(`<h3>Registration invites</h3><p>BurnedCord is invite-only. Your account can create at most <strong>two</strong> single-use registration codes. Used codes still count toward the two-code lifetime limit.</p>
      <div class="account-invite-list">${rows || '<div class="empty-invites">You have not created a registration invite yet.</div>'}</div>
      <div class="settings-note">${remaining > 0 ? `${remaining} code${remaining === 1 ? '' : 's'} remaining.` : 'You have used both invite-code slots.'}</div>
      <div class="modal-actions"><button class="secondary" data-close type="button">Close</button>${remaining > 0 ? '<button id="generateAccountInvite" class="primary" type="button">Generate invite code</button>' : ''}</div>`);
    $('[data-close]').onclick = closeModal;
    document.querySelectorAll('.copy-account-invite').forEach((button) => button.onclick = async () => {
      await copyText(button.dataset.code || '');
      toast('Registration invite copied.', 'success');
    });
    const generate = $('#generateAccountInvite');
    if (generate) generate.onclick = async () => {
      generate.disabled = true;
      try {
        const created = await api('/api/account/invites', { method: 'POST', body: {} });
        await copyText(created.invite.code);
        toast('Registration invite created and copied.', 'success');
        await openAccountInvites();
      } catch (err) {
        toast(errorText(err.code), 'error');
        generate.disabled = false;
      }
    };
  } catch (err) {
    toast(errorText(err.code), 'error');
  }
}

async function openAudioSettings() {
  state.deviceProbePromise = primeAudioDevices({ requestPermission: true, forcePermissionProbe: true }).catch(() => null);
  await state.deviceProbePromise;
  const mics = state.devices.microphones || [];
  const outputs = state.devices.outputs || [];
  const micOptions = mics.map((d, i) => `<option value="${escAttr(d.deviceId)}" ${(state.audio?.inputDeviceId || state.voicePrefs.inputDeviceId) === d.deviceId ? 'selected' : ''}>${esc(d.label || (d.deviceId === state.voicePrefs.inputDeviceId ? state.voicePrefs.inputDeviceLabel : '') || `Microphone ${i + 1}`)}</option>`).join('');
  const outputOptions = outputs.map((d, i) => `<option value="${escAttr(d.deviceId)}" ${state.voicePrefs.outputDeviceId === d.deviceId ? 'selected' : ''}>${esc(d.label || (d.deviceId === state.voicePrefs.outputDeviceId ? state.voicePrefs.outputDeviceLabel : '') || `Output ${i + 1}`)}</option>`).join('');
  const sinkSupported = typeof HTMLMediaElement !== 'undefined' && typeof HTMLMediaElement.prototype.setSinkId === 'function';
  let pendingKeyCode = state.voicePrefs.pttKeyCode;
  let pendingKeyLabel = state.voicePrefs.pttKeyLabel;

  showModal(`<h3>Voice & audio</h3><p>Input/output devices are detected by BurnedCord and kept on this PC.</p>
    <form id="audioSettingsForm" class="modal-form voice-settings-form">
      <label>Input mode<select name="voiceMode"><option value="voice-activity" ${state.voicePrefs.voiceMode === 'voice-activity' ? 'selected' : ''}>Voice Activity</option><option value="push-to-talk" ${state.voicePrefs.voiceMode === 'push-to-talk' ? 'selected' : ''}>Push-to-Talk</option></select></label>
      <div class="settings-row"><span>Push-to-Talk key</span><button id="pttKeyCapture" class="secondary key-capture" type="button">${esc(pendingKeyLabel)}</button></div>
      <label class="range-label"><span>PTT release delay</span><output id="pttDelayValue">${state.voicePrefs.pttReleaseDelay} ms</output><input name="pttReleaseDelay" id="pttDelayRange" type="range" min="0" max="500" step="10" value="${state.voicePrefs.pttReleaseDelay}"></label>
      <div class="ptt-browser-warning"><strong>Push-to-Talk:</strong> ${window.burnedCord?.setGlobalPtt ? 'global on Windows. It keeps working while a game is focused and does not reserve/steal the selected key.' : 'browser fallback is focus-bound.'}</div>
      <label>Noise suppression<select name="noiseProfile"><option value="normal" ${state.voicePrefs.noiseProfile === 'normal' ? 'selected' : ''}>Normal · natural voice</option><option value="strong" ${state.voicePrefs.noiseProfile === 'strong' ? 'selected' : ''}>Strong · recommended</option><option value="very-strong" ${state.voicePrefs.noiseProfile === 'very-strong' ? 'selected' : ''}>Very Strong · noisy room</option></select></label>
      <label>Microphone<select name="mic"><option value="">System default</option>${micOptions}</select></label>
      <label>Output device<select name="output" ${sinkSupported ? '' : 'disabled'}><option value="">System default</option>${outputOptions}</select></label>
      <label class="range-label"><span>Master output volume</span><output id="masterVolumeValue">${state.voicePrefs.outputVolume}%</output><input name="outputVolume" id="masterVolumeRange" type="range" min="0" max="100" step="1" value="${state.voicePrefs.outputVolume}"></label>
      <div class="settings-note">Noise processing: <strong>${state.audio?.rnnoiseEnabled ? (state.denoiserMode.startsWith('rnnoise') ? 'WebRTC + RNNoise + adaptive gate' : 'WebRTC + adaptive gate') : 'Off'}</strong>. ${sinkSupported ? 'Output device selection is supported by this desktop runtime.' : 'This desktop runtime does not expose output-device selection here; Windows system output will be used.'}</div>
      <div class="modal-actions"><button type="button" class="secondary" data-close>Cancel</button><button class="primary">Apply</button></div>
    </form>`);

  $('[data-close]').onclick = closeModal;
  $('#pttDelayRange').oninput = (e) => { $('#pttDelayValue').textContent = `${e.target.value} ms`; };
  $('#masterVolumeRange').oninput = (e) => { $('#masterVolumeValue').textContent = `${e.target.value}%`; };

  const captureButton = $('#pttKeyCapture');
  captureButton.onclick = () => {
    captureButton.textContent = 'Press a key or mouse side button…';
    captureButton.classList.add('capturing');
    const finish = () => {
      captureButton.classList.remove('capturing');
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
    };
    const onKey = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (['Escape', 'Tab'].includes(e.code)) captureButton.textContent = pendingKeyLabel;
      else {
        pendingKeyCode = e.code;
        pendingKeyLabel = prettyKey(e);
        captureButton.textContent = pendingKeyLabel;
      }
      finish();
    };
    const onMouse = (e) => {
      if (!window.burnedCord?.setGlobalPtt) return;
      const picked = prettyMouseButton(e.button);
      if (!picked) return;
      e.preventDefault(); e.stopPropagation();
      pendingKeyCode = picked.code;
      pendingKeyLabel = picked.label;
      captureButton.textContent = pendingKeyLabel;
      finish();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
  };

  $('#audioSettingsForm').onsubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const micId = String(form.get('mic') || '');
    const outputId = String(form.get('output') || '');
    const voiceMode = form.get('voiceMode') === 'push-to-talk' ? 'push-to-talk' : 'voice-activity';
    const noiseProfile = ['normal', 'strong', 'very-strong'].includes(String(form.get('noiseProfile'))) ? String(form.get('noiseProfile')) : 'strong';
    const releaseDelay = Math.max(0, Math.min(500, Number(form.get('pttReleaseDelay')) || 0));
    const outputVolume = Math.max(0, Math.min(100, Number(form.get('outputVolume')) || 0));

    try {
      state.voicePrefs.voiceMode = voiceMode;
      state.voicePrefs.pttKeyCode = pendingKeyCode;
      state.voicePrefs.pttKeyLabel = pendingKeyLabel;
      state.voicePrefs.pttReleaseDelay = releaseDelay;
      state.voicePrefs.noiseProfile = noiseProfile;
      state.voicePrefs.inputDeviceId = micId;
      state.voicePrefs.inputDeviceLabel = mics.find((d) => d.deviceId === micId)?.label || state.voicePrefs.inputDeviceLabel;
      state.voicePrefs.outputDeviceId = outputId;
      state.voicePrefs.outputDeviceLabel = outputs.find((d) => d.deviceId === outputId)?.label || state.voicePrefs.outputDeviceLabel;
      state.voicePrefs.outputVolume = outputVolume;
      saveVoicePrefs();

      state.audio.setVoiceMode(voiceMode);
      if (voiceMode === 'push-to-talk' && !state.audio.micEnabled) state.audio.setMicEnabled(true);
      state.audio.setPushToTalkReleaseDelay(releaseDelay);
      await state.audio.setNoiseProfile(noiseProfile);
      await configureGlobalPtt().catch(() => {});
      if (state.audio.inputDeviceId !== micId) {
        if (state.audio.processedAudioTrack?.readyState === 'live') await state.audio.setInputDevice(micId);
        else state.audio.inputDeviceId = micId;
      }
      setGlobalOutputVolume(outputVolume);
      if (sinkSupported) await setOutputDevice(outputId, { persist: false });
      state.deviceProbePromise = primeAudioDevices({ requestPermission: false }).catch(() => null);
      closeModal();
      updateControls();
      toast('Voice settings updated.', 'success');
    } catch {
      toast('Could not apply one of the selected audio devices.', 'error');
    }
  };
}


async function copyText(value) {
  const text = String(value ?? '');
  if (window.burnedCord?.copyText) {
    try { if (await window.burnedCord.copyText(text)) return true; } catch {}
  }
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch {}
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return !!ok;
  } catch { return false; }
}

function esc(v) { return String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function escAttr(v) { return esc(v).replace(/`/g, '&#096;'); }

boot();
