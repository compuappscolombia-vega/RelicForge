/**
 * 100% procedural Web Audio API sound effects (zero external assets / zero 404s).
 */
class SoundFXManager {
  private ctx: AudioContext | null = null;
  public enabled = true;

  private ensureContext(): AudioContext | null {
    if (!this.enabled || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private playTone(
    freqStart: number,
    freqEnd: number,
    duration: number,
    type: OscillatorType = 'sine',
    gainPeak = 0.14,
    delay = 0
  ): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, now);
    if (freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + duration);
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(gainPeak, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  playGrab(): void {
    this.playTone(220, 310, 0.08, 'triangle', 0.12);
  }

  playRotateClick(): void {
    this.playTone(540, 420, 0.045, 'sine', 0.08);
  }

  playSnapSuccess(comboIndex = 0): void {
    const base = 440 * Math.pow(1.06, Math.min(8, comboIndex));
    this.playTone(base, base * 1.02, 0.16, 'triangle', 0.16, 0);
    this.playTone(base * 1.5, base * 1.52, 0.24, 'sine', 0.14, 0.06);
  }

  playWrongDrop(): void {
    this.playTone(170, 95, 0.14, 'sawtooth', 0.07);
  }

  playVoiceChirp(): void {
    this.playTone(660, 880, 0.09, 'sine', 0.09, 0);
    this.playTone(880, 1046, 0.1, 'sine', 0.08, 0.07);
  }

  playCountdownTick(go = false): void {
    if (go) {
      this.playTone(880, 1175, 0.28, 'triangle', 0.18);
    } else {
      this.playTone(440, 440, 0.11, 'sine', 0.12);
    }
  }

  playVictoryFanfare(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, idx) => {
      this.playTone(n, n * 1.01, 0.28, 'triangle', 0.15, idx * 0.09);
    });
  }
}

export const soundFX = new SoundFXManager();
