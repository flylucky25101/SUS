import type { GameSettings } from '../ui/settings';

export type AudioCue = 'move' | 'select' | 'jump' | 'swing' | 'hit' | 'heavy' | 'dodge' | 'special' | 'ringout' | 'victory' | 'countdown';

interface ToneShape {
  frequency: number;
  endFrequency: number;
  duration: number;
  type: OscillatorType;
  gain: number;
}

const TONES: Readonly<Record<AudioCue, ToneShape>> = Object.freeze({
  move: { frequency: 280, endFrequency: 330, duration: 0.045, type: 'sine', gain: 0.16 },
  select: { frequency: 420, endFrequency: 680, duration: 0.09, type: 'triangle', gain: 0.2 },
  jump: { frequency: 260, endFrequency: 520, duration: 0.12, type: 'sine', gain: 0.18 },
  swing: { frequency: 190, endFrequency: 95, duration: 0.08, type: 'sawtooth', gain: 0.11 },
  hit: { frequency: 118, endFrequency: 76, duration: 0.08, type: 'square', gain: 0.2 },
  heavy: { frequency: 92, endFrequency: 42, duration: 0.16, type: 'sawtooth', gain: 0.24 },
  dodge: { frequency: 620, endFrequency: 250, duration: 0.1, type: 'sine', gain: 0.14 },
  special: { frequency: 330, endFrequency: 920, duration: 0.16, type: 'triangle', gain: 0.18 },
  ringout: { frequency: 180, endFrequency: 980, duration: 0.42, type: 'sawtooth', gain: 0.22 },
  victory: { frequency: 392, endFrequency: 784, duration: 0.55, type: 'triangle', gain: 0.2 },
  countdown: { frequency: 520, endFrequency: 470, duration: 0.11, type: 'square', gain: 0.12 },
});

export class AudioSystem {
  private context: AudioContext | null = null;
  private settings: GameSettings;
  private musicTimer: number | null = null;
  private beat = 0;

  constructor(settings: GameSettings) {
    this.settings = settings;
  }

  async unlock(): Promise<void> {
    if (this.context === null) this.context = new AudioContext({ latencyHint: 'interactive' });
    if (this.context.state === 'suspended') await this.context.resume();
    this.startMusic();
  }

  updateSettings(settings: GameSettings): void {
    this.settings = settings;
    if (settings.musicVolume <= 0) this.stopMusic();
    else if (this.context !== null) this.startMusic();
  }

  getContextState(): AudioContextState | 'uninitialized' {
    return this.context?.state ?? 'uninitialized';
  }

  play(cue: AudioCue, strength = 1): void {
    const context = this.context;
    if (context === null || context.state !== 'running' || this.settings.sfxVolume <= 0) return;
    const shape = TONES[cue];
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = shape.type;
    oscillator.frequency.setValueAtTime(shape.frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, shape.endFrequency), now + shape.duration);
    const peak = shape.gain * this.settings.sfxVolume * Math.min(1.35, Math.max(0.25, strength));
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + shape.duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + shape.duration + 0.01);
    oscillator.addEventListener('ended', () => {
      oscillator.disconnect();
      gain.disconnect();
    }, { once: true });
    if (cue === 'hit' || cue === 'heavy') this.playImpactLayer(context, now, cue, strength);
  }

  vibrate(pattern: number | readonly number[]): void {
    if (!this.settings.haptics || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    navigator.vibrate(typeof pattern === 'number' ? pattern : Array.from(pattern));
  }

  async suspend(): Promise<void> {
    this.stopMusic();
    if (this.context?.state === 'running') await this.context.suspend();
  }

  async resume(): Promise<void> {
    if (this.context?.state === 'suspended') await this.context.resume();
    this.startMusic();
  }

  destroy(): void {
    this.stopMusic();
    if (this.context !== null) void this.context.close();
    this.context = null;
  }

  private startMusic(): void {
    if (this.musicTimer !== null || this.context === null || this.settings.musicVolume <= 0) return;
    this.musicTimer = window.setInterval(() => this.musicPulse(), 420);
    this.musicPulse();
  }

  private stopMusic(): void {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  private musicPulse(): void {
    const context = this.context;
    if (context === null || context.state !== 'running' || this.settings.musicVolume <= 0) return;
    const scale = [110, 138.59, 164.81, 207.65] as const;
    const frequency = scale[this.beat % scale.length] ?? 110;
    this.beat += 1;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = this.beat % 4 === 0 ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.055 * this.settings.musicVolume, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.34);
    oscillator.addEventListener('ended', () => {
      oscillator.disconnect();
      gain.disconnect();
    }, { once: true });
  }

  private playImpactLayer(context: AudioContext, now: number, cue: 'hit' | 'heavy', strength: number): void {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const heavy = cue === 'heavy';
    const duration = heavy ? 0.2 : 0.055;
    oscillator.type = heavy ? 'sine' : 'triangle';
    oscillator.frequency.setValueAtTime(heavy ? 58 : 680, now);
    oscillator.frequency.exponentialRampToValueAtTime(heavy ? 29 : 170, now + duration);
    const peak = (heavy ? 0.26 : 0.12)
      * this.settings.sfxVolume
      * Math.min(1.35, Math.max(0.25, strength));
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + (heavy ? 0.012 : 0.003));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.01);
    oscillator.addEventListener('ended', () => {
      oscillator.disconnect();
      gain.disconnect();
    }, { once: true });
  }
}
