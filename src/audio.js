// Audio cues, voice and AirPods (Media Session) — see .claude/skills/ios-pwa-rules.
// Cues are scheduled ahead on the AudioContext clock because iOS throttles
// timers to ~2 s while the screen is locked.

const MEDIA_ACTIONS = ['play', 'pause', 'stop', 'nexttrack', 'previoustrack', 'seekforward', 'seekbackward', 'seekto'];

function silentWavUrl() {
  const rate = 8000;
  const n = rate; // 1 s of silence, looped
  const buf = new ArrayBuffer(44 + n * 2);
  const d = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
  d.setUint32(24, rate, true); d.setUint32(28, rate * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true);
  str(36, 'data'); d.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

export class AudioCues {
  constructor() {
    this.ac = null;
    this.master = null;
    this.loop = null;
    this.mode = null;
    this.scheduled = new Map(); // cue id -> { when, nodes }
    this.handlers = {};
    this.voice = null;
  }

  get ready() {
    return !!this.ac && this.ac.state !== 'closed';
  }

  /** Must run inside the user's Start / Resume tap. */
  async start(mode, { onDone, onUndo } = {}) {
    this.stop();
    this.mode = mode;
    this.handlers = { onDone, onUndo };
    try {
      if ('audioSession' in navigator) navigator.audioSession.type = mode === 'airpods' ? 'playback' : 'ambient';
    } catch { /* not supported */ }

    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ac = new Ctx();
    this.master = this.ac.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ac.destination);
    try { await this.ac.resume(); } catch { /* resumes on next gesture */ }

    this.primeVoice();
    if (mode === 'airpods') await this.startNowPlaying();
  }

  /** Re-arm after the page was hidden, or on a Resume tap. */
  async wake() {
    if (!this.ready) return;
    try { if (this.ac.state !== 'running') await this.ac.resume(); } catch { /* ignore */ }
    if (this.loop && this.loop.paused) {
      try { await this.loop.play(); navigator.mediaSession.playbackState = 'playing'; } catch { /* ignore */ }
    }
  }

  async startNowPlaying() {
    this.loop = new Audio(silentWavUrl());
    this.loop.loop = true;
    this.loop.setAttribute('playsinline', '');
    try { await this.loop.play(); } catch { /* will retry on wake() */ }
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.playbackState = 'playing';
    const keepPlaying = async () => {
      try { await this.loop.play(); ms.playbackState = 'playing'; } catch { ms.playbackState = 'paused'; }
    };
    const set = (action, fn) => { try { ms.setActionHandler(action, fn); } catch { /* unsupported */ } };
    // Single press arrives as pause (or play); double press as nexttrack.
    set('pause', () => { this.handlers.onDone?.(); keepPlaying(); });
    set('play', () => { this.handlers.onDone?.(); keepPlaying(); });
    set('nexttrack', () => { this.handlers.onUndo?.(); keepPlaying(); });
    for (const a of ['stop', 'previoustrack', 'seekforward', 'seekbackward', 'seekto']) set(a, null);
  }

  setNowPlaying(title) {
    if (this.mode !== 'airpods' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist: 'Minute Mark',
        artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
      });
    } catch { /* ignore */ }
  }

  stop() {
    this.cancelAll();
    if (this.loop) { try { this.loop.pause(); URL.revokeObjectURL(this.loop.src); } catch { /* ignore */ } this.loop = null; }
    if ('mediaSession' in navigator) {
      for (const a of MEDIA_ACTIONS) { try { navigator.mediaSession.setActionHandler(a, null); } catch { /* ignore */ } }
      try { navigator.mediaSession.playbackState = 'none'; navigator.mediaSession.metadata = null; } catch { /* ignore */ }
    }
    if (this.ac) { try { this.ac.close(); } catch { /* ignore */ } }
    this.ac = null;
    this.mode = null;
  }

  /** Stop sounds after a short tail (lets the final chord ring out). */
  stopSoon(ms = 2500) {
    const ac = this.ac;
    setTimeout(() => { if (this.ac === ac) this.stop(); }, ms);
  }

  // ---- scheduled cues -------------------------------------------------------

  /** cues: [{ id, at, kind }] in session ms; sessionNow: current session ms. */
  schedule(cues, sessionNow) {
    if (!this.ready) return;
    const now = this.ac.currentTime;
    for (const [id, c] of this.scheduled) if (c.when < now - 2) this.scheduled.delete(id);
    for (const cue of cues) {
      if (this.scheduled.has(cue.id)) continue;
      let when = now + (cue.at - sessionNow) / 1000;
      if (when < now - 0.25) continue; // too late to be useful
      when = Math.max(when, now + 0.01);
      const nodes = this.sound(cue.kind, when);
      this.scheduled.set(cue.id, { when, nodes });
    }
  }

  /** Cancel everything not yet played (pause, restart). */
  cancelAll() {
    for (const { nodes } of this.scheduled.values()) {
      for (const n of nodes) { try { n.stop(); n.disconnect(); } catch { /* already stopped */ } }
    }
    this.scheduled.clear();
  }

  tone(freq, dur, when, vol = 0.32, type = 'square') {
    const o = this.ac.createOscillator();
    const g = this.ac.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g).connect(this.master);
    o.start(when);
    o.stop(when + dur + 0.03);
    return o;
  }

  sound(kind, when) {
    switch (kind) {
      case 'tick': return [this.tone(880, 0.12, when)];
      case 'go': return [this.tone(1320, 0.6, when, 0.38)];
      case 'target': return this.chord(when);
      default: return [];
    }
  }

  chord(when) {
    return [this.tone(660, 0.16, when), this.tone(880, 0.16, when + 0.17), this.tone(1320, 0.5, when + 0.34, 0.38)];
  }

  now(fn) {
    if (!this.ready) return;
    fn(this.ac.currentTime + 0.01);
  }

  confirm() { this.now((t) => { this.tone(990, 0.08, t); this.tone(660, 0.11, t + 0.1); }); }
  undo() { this.now((t) => { this.tone(660, 0.08, t); this.tone(990, 0.11, t + 0.1); }); }
  pauseTone() { this.now((t) => this.tone(520, 0.14, t)); }
  resumeTone() { this.now((t) => this.tone(780, 0.14, t)); }
  final() { this.now((t) => this.chord(t)); }

  // ---- voice ------------------------------------------------------------------

  primeVoice() {
    if (!('speechSynthesis' in window)) return;
    const pick = () => {
      const voices = speechSynthesis.getVoices();
      this.voice = voices.find((v) => /^en[-_]US$/i.test(v.lang) && v.localService)
        || voices.find((v) => /^en[-_]US/i.test(v.lang)) || null;
    };
    pick();
    speechSynthesis.onvoiceschanged = pick;
  }

  say(text, { interrupt = true } = {}) {
    if (!('speechSynthesis' in window)) return;
    try {
      if (interrupt) speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      if (this.voice) u.voice = this.voice;
      u.rate = 1.05;
      speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }
}
