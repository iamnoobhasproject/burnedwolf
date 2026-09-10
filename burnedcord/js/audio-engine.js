export class AudioEngine extends EventTarget {
  constructor() {
    super();
    this.audioContext = null;
    this.rawMicStream = null;
    this.processedAudioTrack = null;
    this.rnnoiseNode = null;
    this.rnnoiseEnabled = true;
    this.noiseProfile = 'strong';

    this.highpassNode = null;
    this.lowpassNode = null;
    this.gateGainNode = null;
    this.compressorNode = null;
    this.gateAnalyser = null;
    this.gateTimer = null;
    this.gateOpen = true;
    this.gateHangUntil = 0;
    this.noiseFloor = 0.003;

    // micEnabled is the user's mute preference. The actual MediaStreamTrack may
    // still be disabled while deafened or while Push-to-Talk is not pressed.
    this.micEnabled = true;
    this.deafened = false;
    this.voiceMode = 'voice-activity';
    this.pttPressed = false;
    this.pttReleaseDelay = 120;
    this.pttReleaseTimer = null;

    this.cameraTrack = null;
    this.screenTrack = null;
    this.screenAudioTrack = null;
    this.cameraStream = null;
    this.screenStream = null;
    this.inputDeviceId = '';

    this.speaking = false;
    this.meterContext = null;
    this.meterSource = null;
    this.meterAnalyser = null;
    this.meterTimer = null;
    this.speechHangUntil = 0;
  }

  profileConfig() {
    const profiles = {
      normal: {
        highpass: 75,
        lowpass: 14500,
        minOpen: 0.006,
        openFactor: 2.0,
        closeFactor: 1.45,
        floorGain: 0.10,
        hangMs: 260,
        attack: 0.006,
        release: 0.11,
      },
      strong: {
        highpass: 90,
        lowpass: 12500,
        minOpen: 0.0085,
        openFactor: 2.45,
        closeFactor: 1.72,
        floorGain: 0.012,
        hangMs: 210,
        attack: 0.004,
        release: 0.085,
      },
      'very-strong': {
        highpass: 105,
        lowpass: 10500,
        minOpen: 0.0115,
        openFactor: 2.9,
        closeFactor: 1.95,
        floorGain: 0.0,
        hangMs: 165,
        attack: 0.003,
        release: 0.065,
      },
    };
    return profiles[this.noiseProfile] || profiles.strong;
  }

  async acquireRawMic(nativeNoiseSuppression) {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: !!nativeNoiseSuppression,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48000,
        ...(this.inputDeviceId ? { deviceId: { exact: this.inputDeviceId } } : {})
      },
      video: false
    });
  }

  shouldTransmit() {
    if (!this.micEnabled || this.deafened) return false;
    if (this.voiceMode === 'push-to-talk') return this.pttPressed;
    return true;
  }

  applyTransmitState({ notify = true } = {}) {
    const enabled = this.shouldTransmit();
    if (this.processedAudioTrack) this.processedAudioTrack.enabled = enabled;
    if (this.rawMicStream) this.rawMicStream.getAudioTracks().forEach((t) => { t.enabled = enabled; });
    if (this.gateGainNode && this.voiceMode === 'push-to-talk') {
      const target = enabled ? 1 : 0;
      try { this.gateGainNode.gain.setTargetAtTime(target, this.audioContext?.currentTime || 0, enabled ? 0.002 : 0.015); } catch {}
    }
    if (!enabled) this.setSpeaking(false);
    if (notify) this.dispatchStateChanged();
  }

  async ensureMic() {
    if (this.processedAudioTrack?.readyState === 'live') return this.processedAudioTrack;

    // When the BurnedCord noise switch is on, Chromium's built-in WebRTC
    // suppression remains enabled as the first layer. RNNoise and the adaptive
    // gate below are additional layers rather than an all-or-nothing fallback.
    this.rawMicStream = await this.acquireRawMic(this.rnnoiseEnabled);
    const rawTrack = this.rawMicStream.getAudioTracks()[0];
    rawTrack.enabled = this.shouldTransmit();

    if (this.rnnoiseEnabled) {
      await this.buildNoisePipeline();
    } else {
      this.processedAudioTrack = rawTrack;
      this.dispatchEvent(new CustomEvent('denoiser', { detail: { mode: 'off', profile: this.noiseProfile } }));
    }

    if (this.processedAudioTrack) {
      this.processedAudioTrack.enabled = this.shouldTransmit();
      this.dispatchEvent(new CustomEvent('announce', { detail: { trackId: this.processedAudioTrack.id, mediaType: 'audio' } }));
    }
    await this.setupMeter();
    this.dispatchTracksChanged();
    return this.processedAudioTrack;
  }

  async buildNoisePipeline() {
    const cfg = this.profileConfig();
    this.audioContext = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    await this.audioContext.resume();
    const source = this.audioContext.createMediaStreamSource(this.rawMicStream);
    const destination = this.audioContext.createMediaStreamDestination();
    let current = source;
    let denoiserMode = 'webrtc+gate';

    try {
      const { RNNoiseNode } = await import('https://cdn.jsdelivr.net/npm/simple-rnnoise-wasm@1.1.0/dist/rnnoise.mjs');
      await RNNoiseNode.register(this.audioContext);
      this.rnnoiseNode = new RNNoiseNode(this.audioContext);
      current.connect(this.rnnoiseNode);
      current = this.rnnoiseNode;
      this.rnnoiseNode.update?.();
      denoiserMode = 'rnnoise+webrtc+gate';
    } catch (err) {
      // The microphone was acquired with native WebRTC suppression enabled, so
      // a CDN/WASM failure still leaves a working local denoiser + adaptive gate.
      console.warn('RNNoise unavailable; continuing with WebRTC suppression + adaptive gate', err);
      this.rnnoiseNode = null;
    }

    this.highpassNode = this.audioContext.createBiquadFilter();
    this.highpassNode.type = 'highpass';
    this.highpassNode.frequency.value = cfg.highpass;
    this.highpassNode.Q.value = 0.707;
    current.connect(this.highpassNode);

    this.lowpassNode = this.audioContext.createBiquadFilter();
    this.lowpassNode.type = 'lowpass';
    this.lowpassNode.frequency.value = cfg.lowpass;
    this.lowpassNode.Q.value = 0.707;
    this.highpassNode.connect(this.lowpassNode);

    this.gateAnalyser = this.audioContext.createAnalyser();
    this.gateAnalyser.fftSize = 512;
    this.gateAnalyser.smoothingTimeConstant = 0.20;
    this.lowpassNode.connect(this.gateAnalyser);

    this.gateGainNode = this.audioContext.createGain();
    this.gateGainNode.gain.value = 1;
    this.lowpassNode.connect(this.gateGainNode);

    this.compressorNode = this.audioContext.createDynamicsCompressor();
    this.compressorNode.threshold.value = -24;
    this.compressorNode.knee.value = 18;
    this.compressorNode.ratio.value = 3.0;
    this.compressorNode.attack.value = 0.004;
    this.compressorNode.release.value = 0.16;
    this.gateGainNode.connect(this.compressorNode);
    this.compressorNode.connect(destination);

    this.processedAudioTrack = destination.stream.getAudioTracks()[0];
    this.startAdaptiveGate();
    this.dispatchEvent(new CustomEvent('denoiser', { detail: { mode: denoiserMode, profile: this.noiseProfile } }));
  }

  startAdaptiveGate() {
    this.stopAdaptiveGate();
    if (!this.gateAnalyser || !this.gateGainNode || !this.audioContext) return;
    const samples = new Float32Array(this.gateAnalyser.fftSize);
    this.gateOpen = true;
    this.gateHangUntil = performance.now() + 700;
    this.noiseFloor = 0.003;

    this.gateTimer = setInterval(() => {
      if (!this.gateAnalyser || !this.gateGainNode || !this.audioContext) return;
      const now = performance.now();
      const cfg = this.profileConfig();

      if (!this.shouldTransmit()) {
        try { this.gateGainNode.gain.setTargetAtTime(0, this.audioContext.currentTime, 0.012); } catch {}
        return;
      }
      if (this.voiceMode === 'push-to-talk') {
        // Push-to-Talk is already a hard gate. Keep the DSP denoiser active but
        // do not clip quiet syllables with an additional voice-activity gate.
        try { this.gateGainNode.gain.setTargetAtTime(1, this.audioContext.currentTime, 0.002); } catch {}
        return;
      }

      this.gateAnalyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
      const rms = Math.sqrt(sum / samples.length);

      const openThreshold = Math.max(cfg.minOpen, this.noiseFloor * cfg.openFactor);
      const closeThreshold = Math.max(cfg.minOpen * 0.70, this.noiseFloor * cfg.closeFactor);

      if (this.gateOpen) {
        if (rms >= closeThreshold) this.gateHangUntil = now + cfg.hangMs;
        else if (now >= this.gateHangUntil) this.gateOpen = false;
      } else if (rms >= openThreshold) {
        this.gateOpen = true;
        this.gateHangUntil = now + cfg.hangMs;
      }

      // Learn the local room/fan floor only while the gate is closed or the
      // signal is close to the current floor. Keep it bounded so speech never
      // teaches the gate to suppress the speaker.
      if (!this.gateOpen || rms < openThreshold * 0.85) {
        const candidate = Math.max(0.00035, Math.min(0.025, rms));
        this.noiseFloor = (this.noiseFloor * 0.965) + (candidate * 0.035);
      }

      const target = this.gateOpen ? 1 : cfg.floorGain;
      const smoothing = this.gateOpen ? cfg.attack : cfg.release;
      try { this.gateGainNode.gain.setTargetAtTime(target, this.audioContext.currentTime, smoothing); } catch {}
    }, 22);
  }

  stopAdaptiveGate() {
    if (this.gateTimer) clearInterval(this.gateTimer);
    this.gateTimer = null;
    this.gateOpen = true;
    this.gateHangUntil = 0;
    this.noiseFloor = 0.003;
  }

  async setupMeter() {
    await this.stopMeter();
    if (!this.processedAudioTrack?.readyState || this.processedAudioTrack.readyState !== 'live') return;
    try {
      this.meterContext = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      await this.meterContext.resume();
      this.meterSource = this.meterContext.createMediaStreamSource(new MediaStream([this.processedAudioTrack]));
      this.meterAnalyser = this.meterContext.createAnalyser();
      this.meterAnalyser.fftSize = 512;
      this.meterAnalyser.smoothingTimeConstant = 0.45;
      this.meterSource.connect(this.meterAnalyser);
      const samples = new Float32Array(this.meterAnalyser.fftSize);
      this.meterTimer = setInterval(() => {
        if (!this.meterAnalyser || !this.shouldTransmit() || !this.processedAudioTrack?.enabled) {
          this.setSpeaking(false);
          return;
        }
        this.meterAnalyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
        const rms = Math.sqrt(sum / samples.length);
        const now = performance.now();
        if (rms >= 0.020) this.speechHangUntil = now + 220;
        this.setSpeaking(rms >= 0.020 || now < this.speechHangUntil);
      }, 90);
    } catch (err) {
      console.warn('voice meter unavailable', err);
      await this.stopMeter();
    }
  }

  setSpeaking(value) {
    const next = !!value && this.shouldTransmit();
    if (next === this.speaking) return;
    this.speaking = next;
    this.dispatchEvent(new CustomEvent('speaking', { detail: { speaking: next } }));
  }

  async stopMeter() {
    if (this.meterTimer) clearInterval(this.meterTimer);
    this.meterTimer = null;
    try { this.meterSource?.disconnect(); } catch {}
    this.meterSource = null;
    this.meterAnalyser = null;
    if (this.meterContext) await this.meterContext.close().catch(() => {});
    this.meterContext = null;
    this.speechHangUntil = 0;
    this.setSpeaking(false);
  }

  async setInputDevice(deviceId) {
    this.inputDeviceId = String(deviceId || '');
    await this.rebuildMic();
  }

  async setNoiseEnabled(enabled) {
    const next = !!enabled;
    if (this.rnnoiseEnabled === next) return;
    this.rnnoiseEnabled = next;
    await this.rebuildMic();
  }

  async setNoiseProfile(profile) {
    const next = ['normal', 'strong', 'very-strong'].includes(profile) ? profile : 'strong';
    if (this.noiseProfile === next) return;
    this.noiseProfile = next;
    if (this.processedAudioTrack?.readyState === 'live' && this.rnnoiseEnabled) await this.rebuildMic();
  }

  setVoiceMode(mode) {
    const next = mode === 'push-to-talk' ? 'push-to-talk' : 'voice-activity';
    if (this.voiceMode === next) return;
    this.voiceMode = next;
    this.pttPressed = false;
    if (this.gateGainNode && this.audioContext && next === 'voice-activity') {
      this.gateOpen = true;
      this.gateHangUntil = performance.now() + 500;
      try { this.gateGainNode.gain.setTargetAtTime(1, this.audioContext.currentTime, 0.003); } catch {}
    }
    this.applyTransmitState();
  }

  setPushToTalkReleaseDelay(ms) {
    const next = Math.max(0, Math.min(1000, Number(ms) || 0));
    this.pttReleaseDelay = next;
  }

  setPushToTalkPressed(pressed) {
    if (this.voiceMode !== 'push-to-talk') return;
    if (pressed) {
      if (this.pttReleaseTimer) clearTimeout(this.pttReleaseTimer);
      this.pttReleaseTimer = null;
      if (this.pttPressed) return;
      this.pttPressed = true;
      this.applyTransmitState();
      return;
    }
    if (this.pttReleaseTimer) clearTimeout(this.pttReleaseTimer);
    const finish = () => {
      this.pttReleaseTimer = null;
      if (!this.pttPressed) return;
      this.pttPressed = false;
      this.applyTransmitState();
    };
    if (this.pttReleaseDelay > 0) this.pttReleaseTimer = setTimeout(finish, this.pttReleaseDelay);
    else finish();
  }

  setDeafened(enabled) {
    const next = !!enabled;
    if (this.deafened === next) return;
    this.deafened = next;
    if (next) this.setPushToTalkPressed(false);
    this.applyTransmitState();
  }

  async cleanupMicProcessing() {
    this.stopAdaptiveGate();
    this.rnnoiseNode = null;
    this.highpassNode = null;
    this.lowpassNode = null;
    this.gateGainNode = null;
    this.compressorNode = null;
    this.gateAnalyser = null;
    if (this.audioContext) await this.audioContext.close().catch(() => {});
    this.audioContext = null;
  }

  async rebuildMic() {
    await this.stopMeter();
    this.stopAdaptiveGate();
    this.processedAudioTrack?.stop?.();
    this.rawMicStream?.getTracks().forEach((t) => t.stop());
    await this.cleanupMicProcessing();
    this.rawMicStream = null;
    this.processedAudioTrack = null;
    await this.ensureMic();
  }

  setMicEnabled(enabled) {
    this.micEnabled = !!enabled;
    if (!this.micEnabled) this.setPushToTalkPressed(false);
    this.applyTransmitState();
  }

  async setCameraEnabled(enabled) {
    if (enabled && !this.cameraTrack) {
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } },
        audio: false
      });
      this.cameraTrack = this.cameraStream.getVideoTracks()[0];
      this.cameraTrack.contentHint = 'motion';
      this.cameraTrack.addEventListener('ended', () => this.stopCamera());
      this.dispatchEvent(new CustomEvent('announce', { detail: { trackId: this.cameraTrack.id, mediaType: 'camera' } }));
    } else if (!enabled) {
      this.stopCamera();
      return;
    }
    this.dispatchTracksChanged();
  }

  stopCamera() {
    this.cameraTrack?.stop();
    this.cameraTrack = null;
    this.cameraStream = null;
    this.dispatchTracksChanged();
  }

  async setScreenEnabled(enabled) {
    if (enabled && !this.screenTrack) {
      let chosen = null;
      if (typeof window.__burnedCordChooseScreenSource === 'function') {
        chosen = await window.__burnedCordChooseScreenSource();
        if (!chosen) { const err = new Error('Screen sharing cancelled'); err.name = 'AbortError'; throw err; }
      }

      const preset = {
        '720p60': { width: 1280, height: 720, fps: 60 },
        '1440p30': { width: 2560, height: 1440, fps: 30 },
        '1080p30': { width: 1920, height: 1080, fps: 30 },
      }[chosen?.quality] || { width: 1920, height: 1080, fps: 30 };

      if (chosen?.id && window.burnedCord?.prepareScreenCapture) {
        const prepared = await window.burnedCord.prepareScreenCapture(chosen.id, chosen.includeAudio !== false);
        if (!prepared) { const err = new Error('Screen source could not be prepared'); err.name = 'NotAllowedError'; throw err; }
        this.screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: preset.width, max: preset.width },
            height: { ideal: preset.height, max: preset.height },
            frameRate: { ideal: preset.fps, max: preset.fps },
          },
          audio: chosen.includeAudio !== false,
        });
      } else if (chosen?.id) {
        // Compatibility path for older/non-Electron runtimes.
        this.screenStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: chosen.id, maxWidth: preset.width, maxHeight: preset.height, maxFrameRate: preset.fps } }
        });
      } else {
        this.screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 30, max: 30 } },
          audio: true
        });
      }

      this.screenTrack = this.screenStream.getVideoTracks()[0] || null;
      this.screenAudioTrack = this.screenStream.getAudioTracks()[0] || null;
      if (!this.screenTrack) {
        this.screenStream?.getTracks?.().forEach((t) => t.stop());
        this.screenStream = null;
        this.screenAudioTrack = null;
        const err = new Error('No screen track'); err.name = 'NotFoundError'; throw err;
      }
      this.screenTrack.contentHint = chosen?.quality === '720p60' ? 'motion' : 'detail';
      if (this.screenAudioTrack && 'contentHint' in this.screenAudioTrack) {
        try { this.screenAudioTrack.contentHint = 'music'; } catch {}
      }
      this.screenTrack.addEventListener('ended', () => this.stopScreen());
      this.screenAudioTrack?.addEventListener?.('ended', () => { this.screenAudioTrack = null; this.dispatchTracksChanged(); });
      this.dispatchEvent(new CustomEvent('announce', { detail: { trackId: this.screenTrack.id, mediaType: 'screen' } }));
      if (this.screenAudioTrack) this.dispatchEvent(new CustomEvent('announce', { detail: { trackId: this.screenAudioTrack.id, mediaType: 'screen-audio' } }));
    } else if (!enabled) {
      this.stopScreen();
      return;
    }
    this.dispatchTracksChanged();
  }

  stopScreen() {
    const stream = this.screenStream;
    this.screenTrack = null;
    this.screenAudioTrack = null;
    this.screenStream = null;
    try { stream?.getTracks?.().forEach((t) => t.stop()); } catch {}
    this.dispatchTracksChanged();
  }

  getLocalTrackEntries() {
    const out = [];
    if (this.processedAudioTrack) out.push({ key: 'local:audio', track: this.processedAudioTrack, mediaType: 'audio', stream: new MediaStream([this.processedAudioTrack]) });
    if (this.cameraTrack) out.push({ key: 'local:camera', track: this.cameraTrack, mediaType: 'camera', stream: new MediaStream([this.cameraTrack]) });
    if (this.screenTrack) out.push({ key: 'local:screen', track: this.screenTrack, mediaType: 'screen', stream: new MediaStream([this.screenTrack]) });
    if (this.screenAudioTrack) out.push({ key: 'local:screen-audio', track: this.screenAudioTrack, mediaType: 'screen-audio', stream: new MediaStream([this.screenAudioTrack]) });
    return out;
  }

  state() {
    return {
      mic: !!this.processedAudioTrack && this.micEnabled && !this.deafened,
      transmitting: !!this.processedAudioTrack && this.shouldTransmit(),
      camera: !!this.cameraTrack,
      screen: !!this.screenTrack,
      screenAudio: !!this.screenAudioTrack,
      noise: this.rnnoiseEnabled,
      noiseProfile: this.noiseProfile,
      speaking: this.speaking,
      deafened: this.deafened,
      voiceMode: this.voiceMode,
      pttPressed: this.pttPressed
    };
  }

  dispatchTracksChanged() {
    this.dispatchEvent(new CustomEvent('tracks-changed', { detail: this.state() }));
  }

  dispatchStateChanged() {
    this.dispatchEvent(new CustomEvent('state-changed', { detail: this.state() }));
  }

  async releaseMic() {
    if (this.pttReleaseTimer) clearTimeout(this.pttReleaseTimer);
    this.pttReleaseTimer = null;
    this.pttPressed = false;
    await this.stopMeter();
    this.stopAdaptiveGate();
    this.processedAudioTrack?.stop?.();
    this.rawMicStream?.getTracks().forEach((t) => t.stop());
    await this.cleanupMicProcessing();
    this.rawMicStream = null;
    this.processedAudioTrack = null;
    this.dispatchTracksChanged();
  }

  async destroy() {
    this.stopCamera();
    this.stopScreen();
    await this.releaseMic();
  }
}
