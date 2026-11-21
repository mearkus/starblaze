/**
 * Procedural audio: every sound effect and the synthwave soundtrack are synthesised live with
 * WebAudio, so the game ships with zero audio files.
 */
import type { Settings } from './Save';

const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

interface ToneOpts {
  type?: OscillatorType;
  f0: number;
  f1?: number;
  dur: number;
  gain: number;
  attack?: number;
  at?: number;
  detune?: number;
  filter?: number;
  dest?: AudioNode;
}

interface NoiseOpts {
  dur: number;
  gain: number;
  type?: BiquadFilterType;
  f0: number;
  f1?: number;
  q?: number;
  at?: number;
  attack?: number;
  dest?: AudioNode;
}

// i - VI - III - VII in A minor.
const CHORDS: number[][] = [
  [57, 60, 64],
  [53, 57, 60],
  [48, 52, 55],
  [55, 59, 62],
];
const BOSS_CHORDS: number[][] = [
  [57, 60, 64],
  [58, 62, 65],
  [57, 60, 64],
  [56, 59, 64],
];

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private delay!: DelayNode;
  private noiseBuf!: AudioBuffer;
  private last = new Map<string, number>();
  private settings: Settings = { music: true, sfx: true, shake: true, volume: 0.7 };

  /** 0 = menu (pads + arp), 1 = combat, 2 = boss, -1 = silent. */
  intensity = 0;
  private step = 0;
  private nextStepTime = 0;
  private startTime = 0;
  private readonly bpm = 128;
  private readonly stepDur = 60 / 128 / 4;

  get ready(): boolean {
    return this.ctx !== null;
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.connect(this.master);

    // Dotted-eighth echo for the arp.
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = this.stepDur * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    this.delay.connect(fb).connect(this.delay);
    this.delay.connect(wet).connect(this.music);

    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.applySettings(this.settings);
    this.startTime = ctx.currentTime + 0.1;
    this.nextStepTime = this.startTime;
    window.setInterval(() => this.schedule(), 25);
  }

  applySettings(s: Settings): void {
    this.settings = s;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.volume, t, 0.05);
    this.sfx.gain.setTargetAtTime(s.sfx ? 0.75 : 0, t, 0.05);
    this.music.gain.setTargetAtTime(s.music ? 0.42 : 0, t, 0.05);
  }

  /** 0..1 pulse on every kick drum, for syncing visuals. */
  beat(): number {
    if (!this.ctx || this.intensity < 1 || !this.settings.music) return 0;
    const beatLen = 60 / this.bpm;
    const phase = ((this.ctx.currentTime - this.startTime) % beatLen) / beatLen;
    return Math.pow(1 - phase, 4);
  }

  private throttle(key: string, gap: number): boolean {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    const prev = this.last.get(key) ?? -1;
    if (now - prev < gap) return false;
    this.last.set(key, now);
    return true;
  }

  private tone(o: ToneOpts): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = o.at ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + o.dur);
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    const a = o.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    let node: AudioNode = osc;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.filter;
      node.connect(f);
      node = f;
    }
    node.connect(g).connect(o.dest ?? this.sfx);
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  }

  private noise(o: NoiseOpts): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = o.at ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? 'lowpass';
    f.frequency.setValueAtTime(o.f0, t);
    if (o.f1 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + o.dur);
    f.Q.value = o.q ?? 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain, t + (o.attack ?? 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f).connect(g).connect(o.dest ?? this.sfx);
    src.start(t, Math.random() * 0.5);
    src.stop(t + o.dur + 0.05);
  }

  // ---------------------------------------------------------------- SFX

  shoot(pitch = 1): void {
    if (!this.throttle('shoot', 0.055)) return;
    this.tone({ type: 'square', f0: 1250 * pitch, f1: 260 * pitch, dur: 0.07, gain: 0.05, filter: 3500 });
    this.tone({ type: 'sine', f0: 180, f1: 60, dur: 0.05, gain: 0.05 });
  }

  enemyShoot(): void {
    if (!this.throttle('eshoot', 0.09)) return;
    this.tone({ type: 'triangle', f0: 520, f1: 900, dur: 0.09, gain: 0.04 });
  }

  hit(): void {
    if (!this.throttle('hit', 0.035)) return;
    this.noise({ dur: 0.05, gain: 0.08, type: 'bandpass', f0: 2600, q: 1.5 });
  }

  explode(size = 1): void {
    if (!this.throttle(size > 2 ? 'boomL' : 'boom', size > 2 ? 0.08 : 0.045)) return;
    const s = Math.min(4, size);
    this.noise({ dur: 0.25 + 0.18 * s, gain: 0.16 + 0.05 * s, f0: 2400, f1: 120, q: 0.7 });
    this.tone({ type: 'sine', f0: 140, f1: 32, dur: 0.22 + 0.1 * s, gain: 0.2 + 0.05 * s });
    if (s >= 2.5) this.noise({ dur: 1.2, gain: 0.12, f0: 600, f1: 60, attack: 0.05 });
  }

  bigBoom(): void {
    this.noise({ dur: 2.2, gain: 0.45, f0: 3000, f1: 50, q: 0.5 });
    this.tone({ type: 'sine', f0: 110, f1: 22, dur: 1.8, gain: 0.5 });
    this.tone({ type: 'sawtooth', f0: 80, f1: 25, dur: 1.2, gain: 0.12, filter: 400 });
  }

  pickup(chain: number): void {
    if (!this.throttle('xp', 0.03)) return;
    const notes = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
    const n = 76 + notes[Math.min(notes.length - 1, chain)];
    this.tone({ type: 'sine', f0: midi(n), dur: 0.09, gain: 0.06 });
    this.tone({ type: 'triangle', f0: midi(n + 12), dur: 0.05, gain: 0.02 });
  }

  powerup(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    [72, 76, 79, 84, 88].forEach((n, i) =>
      this.tone({ type: 'square', f0: midi(n), dur: 0.12, gain: 0.05, at: t + i * 0.05, filter: 5000 }),
    );
  }

  levelUp(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone({ type: 'sawtooth', f0: 200, f1: 1600, dur: 0.5, gain: 0.07, filter: 3000 });
    [69, 73, 76, 81].forEach((n, i) => {
      this.tone({ type: 'square', f0: midi(n), dur: 0.5, gain: 0.05, at: t + 0.12 + i * 0.07, filter: 4000 });
      this.tone({ type: 'sine', f0: midi(n + 12), dur: 0.6, gain: 0.04, at: t + 0.12 + i * 0.07 });
    });
  }

  bomb(): void {
    this.noise({ dur: 1.4, gain: 0.4, f0: 5000, f1: 80, q: 0.6 });
    this.tone({ type: 'sine', f0: 90, f1: 25, dur: 1.2, gain: 0.45 });
    this.tone({ type: 'sawtooth', f0: 1600, f1: 40, dur: 0.8, gain: 0.08, filter: 2500 });
  }

  nova(): void {
    this.tone({ type: 'sine', f0: 300, f1: 70, dur: 0.35, gain: 0.16 });
    this.noise({ dur: 0.3, gain: 0.08, type: 'bandpass', f0: 1500, f1: 300, q: 1 });
  }

  zap(): void {
    if (!this.throttle('zap', 0.06)) return;
    this.tone({ type: 'sawtooth', f0: 2200, f1: 400, dur: 0.08, gain: 0.04, filter: 6000 });
  }

  missile(): void {
    if (!this.throttle('missile', 0.12)) return;
    this.noise({ dur: 0.25, gain: 0.07, type: 'bandpass', f0: 800, f1: 3000, q: 2 });
  }

  playerHit(): void {
    this.tone({ type: 'sawtooth', f0: 420, f1: 60, dur: 0.35, gain: 0.16, filter: 1600 });
    this.noise({ dur: 0.25, gain: 0.18, f0: 1800, f1: 200 });
  }

  shieldHit(): void {
    this.tone({ type: 'sine', f0: 1200, f1: 500, dur: 0.18, gain: 0.08 });
  }

  dash(): void {
    this.noise({ dur: 0.3, gain: 0.14, type: 'bandpass', f0: 400, f1: 4000, q: 1.2 });
  }

  warn(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      this.tone({ type: 'sawtooth', f0: 440, f1: 330, dur: 0.38, gain: 0.08, at: t + i * 0.45, filter: 2000 });
    }
  }

  combo(level: number): void {
    this.tone({ type: 'square', f0: midi(72 + Math.min(24, level * 2)), dur: 0.15, gain: 0.04, filter: 4000 });
    this.tone({ type: 'square', f0: midi(79 + Math.min(24, level * 2)), dur: 0.2, gain: 0.04, at: (this.ctx?.currentTime ?? 0) + 0.06, filter: 4000 });
  }

  ui(): void {
    if (!this.throttle('ui', 0.04)) return;
    this.tone({ type: 'triangle', f0: 880, f1: 1320, dur: 0.06, gain: 0.05 });
  }

  buy(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    [84, 88, 91, 96].forEach((n, i) => this.tone({ type: 'triangle', f0: midi(n), dur: 0.15, gain: 0.06, at: t + i * 0.045 }));
  }

  denied(): void {
    this.tone({ type: 'square', f0: 160, f1: 120, dur: 0.18, gain: 0.05, filter: 900 });
  }

  // ---------------------------------------------------------------- Music

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    while (this.nextStepTime < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextStepTime);
      this.step = (this.step + 1) % 64;
      this.nextStepTime += this.stepDur;
    }
  }

  private playStep(step: number, t: number): void {
    if (this.intensity < 0) return;
    const boss = this.intensity >= 2;
    const chords = boss ? BOSS_CHORDS : CHORDS;
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const chord = chords[bar];
    const root = chord[0] - 24;
    const m = this.music;

    if (s === 0) {
      // Pad.
      for (const n of chord) {
        for (const det of [-9, 9]) {
          this.tone({ type: 'sawtooth', f0: midi(n), dur: this.stepDur * 16, gain: 0.018, attack: 0.4, detune: det, filter: boss ? 1400 : 900, at: t, dest: m });
        }
      }
    }

    // Arpeggio.
    const arpOrder = [0, 1, 2, 1, 0, 2, 1, 2];
    const arpNote = chord[arpOrder[s % 8]] + 12 + (s >= 8 && boss ? 12 : 0);
    if (this.intensity === 0 ? s % 2 === 0 : true) {
      this.tone({ type: 'square', f0: midi(arpNote), dur: this.stepDur * 0.9, gain: 0.022, filter: 2400, at: t, dest: this.delay });
      this.tone({ type: 'square', f0: midi(arpNote), dur: this.stepDur * 0.9, gain: 0.018, filter: 2400, at: t, dest: m });
    }

    if (this.intensity < 1) return;

    // Kick on every beat.
    if (s % 4 === 0) {
      this.tone({ type: 'sine', f0: 150, f1: 42, dur: 0.24, gain: 0.5, at: t, dest: m });
      this.noise({ dur: 0.02, gain: 0.08, type: 'highpass', f0: 3000, at: t, dest: m });
    }
    // Clap / snare on 2 and 4.
    if (s === 4 || s === 12) {
      this.noise({ dur: 0.18, gain: 0.2, type: 'bandpass', f0: 1800, q: 0.9, at: t, dest: m });
      this.tone({ type: 'triangle', f0: 220, f1: 140, dur: 0.1, gain: 0.08, at: t, dest: m });
    }
    // Hats.
    if (s % 2 === 1 || boss) {
      this.noise({ dur: s % 4 === 2 ? 0.08 : 0.035, gain: s % 4 === 2 ? 0.06 : 0.03, type: 'highpass', f0: 8000, at: t, dest: m });
    }
    // Rolling bass with sidechain-style offbeat pump.
    if (s % 2 === 0 || boss) {
      const oct = s % 4 === 2 ? 12 : 0;
      this.tone({ type: 'sawtooth', f0: midi(root + oct), dur: this.stepDur * 0.95, gain: s % 4 === 0 ? 0.05 : 0.11, filter: boss ? 900 : 650, at: t, dest: m });
    }
  }
}
