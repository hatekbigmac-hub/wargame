// Procedural WebAudio sound effects and generative ambient music.
// Real audio files can be plugged in with registerSample(); failures fall back to synthesis,
// and a missing/blocked AudioContext simply makes every call a no-op.

export type SfxId =
  | 'click' | 'select' | 'move' | 'attack' | 'rifle' | 'cannon' | 'shell' | 'explosion' | 'bigExplosion'
  | 'missile' | 'torpedo' | 'capture' | 'lost' | 'alert' | 'build' | 'research' | 'splash' | 'jet' | 'error' | 'intercept' | 'flak';

const THROTTLE: Partial<Record<SfxId, number>> = {
  rifle: 45, cannon: 70, shell: 90, explosion: 70, bigExplosion: 150, flak: 50, splash: 80, torpedo: 200, missile: 120, jet: 200,
};

interface PlayOpts {
  volume?: number;
  pan?: number;
  rate?: number;
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private noiseBuf!: AudioBuffer;
  private last = new Map<SfxId, number>();
  private samples = new Map<SfxId, AudioBuffer>();
  private voices = 0;
  private musicMode: 'menu' | 'game' | null = null;
  private musicTimer: number | null = null;
  private bar = 0;
  private vol = { master: 0.8, music: 0.45, sfx: 0.7 };
  /** Listener position for spatial attenuation (set by the game camera). */
  listener = { x: 0, y: 0, w: 1920, h: 1080 };

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 4;
        comp.connect(this.master);
        this.musicBus = this.ctx.createGain();
        this.sfxBus = this.ctx.createGain();
        this.musicBus.connect(this.master);
        this.sfxBus.connect(comp);
        const len = this.ctx.sampleRate * 2;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        this.applyVolumes();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      if (this.musicMode && this.musicTimer === null) this.startMusic(this.musicMode);
    } catch (err) {
      console.warn('[Audio] unavailable', err);
      this.ctx = null;
    }
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.vol = { master, music, sfx };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vol.music * 0.5, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
  }

  /** Optional real sample for a sound id; silently ignored on failure. */
  async registerSample(id: SfxId, url: string): Promise<void> {
    try {
      if (!this.ctx) return;
      const res = await fetch(url);
      if (!res.ok) return;
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
      this.samples.set(id, buf);
    } catch {
      /* keep synthesized fallback */
    }
  }

  /** Spatialised playback relative to the camera view. */
  playAt(id: SfxId, x: number, y: number, volume = 1): void {
    const l = this.listener;
    const dx = x - l.x;
    const dy = y - l.y;
    const reach = Math.max(l.w, l.h) * 0.75;
    const d = Math.hypot(dx, dy);
    if (d > reach * 1.4) return;
    const att = Math.max(0, 1 - d / (reach * 1.4));
    const zoomAtt = Math.min(1, 2200 / Math.max(l.w, 1));
    this.play(id, { volume: volume * att * (0.35 + 0.65 * zoomAtt), pan: Math.max(-1, Math.min(1, dx / reach)) });
  }

  play(id: SfxId, opts: PlayOpts = {}): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = performance.now();
    const thr = THROTTLE[id];
    if (thr && now - (this.last.get(id) ?? 0) < thr) return;
    this.last.set(id, now);
    if (this.voices > 28) return;
    const vol = opts.volume ?? 1;
    if (vol < 0.02) return;
    let out: AudioNode = this.sfxBus;
    if (opts.pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = opts.pan;
      p.connect(this.sfxBus);
      out = p;
    }
    const sample = this.samples.get(id);
    if (sample) {
      const src = ctx.createBufferSource();
      src.buffer = sample;
      src.playbackRate.value = opts.rate ?? 1;
      const g = ctx.createGain();
      g.gain.value = vol;
      src.connect(g).connect(out);
      this.track(src, sample.duration);
      src.start();
      return;
    }
    try {
      this.synth(id, vol, out);
    } catch {
      /* ignore synthesis errors */
    }
  }

  private track(node: AudioScheduledSourceNode, dur: number): void {
    this.voices++;
    node.onended = () => this.voices--;
    setTimeout(() => (node.onended = null), (dur + 1) * 1000);
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, peak: number, out: AudioNode, delay = 0, attack = 0.005): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, peak, attack, dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
    this.track(o, dur + delay);
  }

  private noise(dur: number, peak: number, out: AudioNode, filter: BiquadFilterType, f0: number, f1: number, q = 1, delay = 0, attack = 0.004): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bf = ctx.createBiquadFilter();
    bf.type = filter;
    bf.Q.value = q;
    bf.frequency.setValueAtTime(f0, t);
    bf.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, peak, attack, dur);
    src.connect(bf).connect(g).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + attack + dur + 0.05);
    this.track(src, dur + delay);
  }

  private synth(id: SfxId, v: number, out: AudioNode): void {
    switch (id) {
      case 'click': this.tone('square', 1400, 1100, 0.04, 0.06 * v, out); break;
      case 'select': this.tone('sine', 620, 620, 0.06, 0.18 * v, out); this.tone('sine', 930, 930, 0.08, 0.14 * v, out, 0.06); break;
      case 'move': this.tone('triangle', 420, 700, 0.09, 0.16 * v, out); break;
      case 'attack': this.tone('sawtooth', 260, 120, 0.14, 0.1 * v, out); this.noise(0.1, 0.12 * v, out, 'bandpass', 1400, 600, 2); break;
      case 'rifle': this.noise(0.06, 0.22 * v, out, 'bandpass', 2600, 1200, 1.5); break;
      case 'flak': this.noise(0.05, 0.2 * v, out, 'highpass', 1800, 900, 1); break;
      case 'cannon': this.noise(0.22, 0.4 * v, out, 'lowpass', 1400, 300, 1); this.tone('sine', 110, 45, 0.22, 0.4 * v, out); break;
      case 'shell': this.noise(0.3, 0.3 * v, out, 'lowpass', 700, 150, 1); this.tone('sine', 80, 38, 0.3, 0.35 * v, out); break;
      case 'explosion': this.noise(0.7, 0.55 * v, out, 'lowpass', 1600, 120, 0.8); this.tone('sine', 70, 30, 0.55, 0.5 * v, out); break;
      case 'bigExplosion':
        this.noise(1.4, 0.75 * v, out, 'lowpass', 2200, 80, 0.7);
        this.tone('sine', 55, 22, 1.1, 0.7 * v, out);
        this.noise(0.9, 0.25 * v, out, 'bandpass', 500, 120, 0.8, 0.15);
        break;
      case 'missile':
        this.noise(1.1, 0.35 * v, out, 'bandpass', 300, 3200, 3, 0, 0.12);
        this.tone('sawtooth', 90, 180, 0.9, 0.08 * v, out, 0, 0.1);
        break;
      case 'torpedo': this.noise(0.6, 0.25 * v, out, 'lowpass', 400, 150, 2, 0, 0.05); this.tone('sine', 140, 90, 0.5, 0.12 * v, out); break;
      case 'splash': this.noise(0.35, 0.25 * v, out, 'highpass', 900, 3000, 0.7); break;
      case 'jet': this.noise(1.3, 0.2 * v, out, 'bandpass', 800, 2200, 2, 0, 0.3); break;
      case 'intercept': this.tone('square', 1800, 600, 0.12, 0.08 * v, out); this.noise(0.25, 0.3 * v, out, 'lowpass', 2500, 400, 1, 0.08); break;
      case 'capture':
        [523, 659, 784, 1046].forEach((f, i) => this.tone('triangle', f, f, 0.22, 0.2 * v, out, i * 0.12));
        this.tone('sine', 261, 261, 0.7, 0.12 * v, out, 0.36);
        break;
      case 'lost': [466, 392, 311].forEach((f, i) => this.tone('sawtooth', f, f * 0.98, 0.3, 0.07 * v, out, i * 0.18, 0.02)); break;
      case 'alert': this.tone('square', 880, 880, 0.09, 0.07 * v, out); this.tone('square', 660, 660, 0.09, 0.07 * v, out, 0.12); break;
      case 'build': this.tone('sine', 880, 880, 0.1, 0.12 * v, out); this.tone('sine', 1320, 1320, 0.16, 0.1 * v, out, 0.08); break;
      case 'research': [660, 880, 990, 1320].forEach((f, i) => this.tone('sine', f, f, 0.25, 0.1 * v, out, i * 0.08)); break;
      case 'error': this.tone('square', 160, 140, 0.14, 0.08 * v, out); break;
    }
  }

  // ------------------------------------------------------------------ music

  startMusic(mode: 'menu' | 'game'): void {
    this.musicMode = mode;
    if (!this.ctx) return;
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.bar = 0;
    this.playBar();
    this.musicTimer = window.setInterval(() => this.playBar(), mode === 'menu' ? 6000 : 5000);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
    this.musicMode = null;
  }

  private playBar(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const menu = this.musicMode === 'menu';
    // D minor-ish progression: Dm – Bb – F – C / Gm – A
    const prog = menu ? [[146.8, 174.6, 220], [116.5, 146.8, 174.6], [174.6, 220, 261.6], [130.8, 164.8, 196]] : [[146.8, 174.6, 220], [98, 146.8, 174.6], [116.5, 146.8, 174.6], [110, 138.6, 164.8]];
    const chord = prog[this.bar % prog.length];
    const dur = menu ? 6.4 : 5.4;
    const t = ctx.currentTime;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(menu ? 700 : 520, t);
    filter.frequency.linearRampToValueAtTime(menu ? 1100 : 800, t + dur / 2);
    filter.frequency.linearRampToValueAtTime(menu ? 600 : 450, t + dur);
    filter.Q.value = 0.7;
    filter.connect(this.musicBus);
    for (const f of chord) {
      for (const det of [-5, 5]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.028, t + 1.4);
        g.gain.setValueAtTime(0.028, t + dur - 1.6);
        g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.4);
        o.connect(g).connect(filter);
        o.start(t);
        o.stop(t + dur + 0.5);
      }
    }
    // Sub bass
    const b = ctx.createOscillator();
    b.type = 'sine';
    b.frequency.value = chord[0] / 2;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t);
    bg.gain.linearRampToValueAtTime(0.08, t + 1);
    bg.gain.linearRampToValueAtTime(0.0001, t + dur + 0.3);
    b.connect(bg).connect(this.musicBus);
    b.start(t);
    b.stop(t + dur + 0.4);
    // Distant war drums in game mode.
    if (!menu) {
      for (let i = 0; i < 4; i++) {
        const tt = t + i * (dur / 4) + (i % 2 ? 0.2 : 0);
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(90, tt);
        o.frequency.exponentialRampToValueAtTime(40, tt + 0.35);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, tt);
        g.gain.exponentialRampToValueAtTime(i % 2 ? 0.05 : 0.09, tt + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.4);
        o.connect(g).connect(this.musicBus);
        o.start(tt);
        o.stop(tt + 0.45);
      }
    }
    // Occasional high motif.
    if (this.bar % 2 === 1) {
      const notes = [chord[2] * 2, chord[1] * 2, chord[2] * 2, chord[0] * 4];
      notes.forEach((f, i) => {
        const tt = t + 1 + i * 0.9;
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, tt);
        g.gain.linearRampToValueAtTime(0.02, tt + 0.1);
        g.gain.exponentialRampToValueAtTime(0.0001, tt + 1.2);
        o.connect(g).connect(this.musicBus);
        o.start(tt);
        o.stop(tt + 1.3);
      });
    }
    this.bar++;
  }
}
