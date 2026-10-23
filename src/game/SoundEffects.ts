/** Short, bright synthesised sounds (Web Audio API, no audio files). */
export class SoundEffects {
  private ctx: AudioContext | null = null;
  public enabled = true;

  /** Must be called from a user gesture at least once so iOS unlocks audio. */
  public unlock(): void {
    if (!this.enabled) return;
    this.init();
  }

  private init(): AudioContext | null {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** One enveloped oscillator note. */
  private note(freq: number, start: number, duration: number, volume: number, type: OscillatorType = 'triangle', slideTo?: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  private play(fn: (now: number) => void): void {
    if (!this.enabled) return;
    const ctx = this.init();
    if (ctx) fn(ctx.currentTime);
  }

  /** A line is drawn: quick rising "pop". */
  public playStroke(): void {
    this.play((t) => this.note(520, t, 0.09, 0.16, 'sine', 820));
  }

  public playBoxCaptured(count = 1): void {
    const notes = count > 1 ? [784, 988, 1175, 1568] : [784, 1175];
    this.play((t) => notes.forEach((f, i) => this.note(f, t + i * 0.06, 0.22, 0.13)));
  }

  public playVictory(): void {
    this.play((t) => [523, 659, 784, 1047, 1319].forEach((f, i) => this.note(f, t + i * 0.1, 0.4, 0.12)));
  }

  /** Last seconds of the turn timer. */
  public playTick(urgent = false): void {
    this.play((t) => this.note(urgent ? 1320 : 990, t, 0.06, 0.1, 'square'));
  }

  /** Time is up. */
  public playTimeout(): void {
    this.play((t) => {
      this.note(330, t, 0.16, 0.12, 'sawtooth', 220);
      this.note(262, t + 0.14, 0.22, 0.12, 'sawtooth', 160);
    });
  }
}
