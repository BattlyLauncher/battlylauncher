/** Original local sonic signature. All nodes have a stop time and share one pauseable clock. */
export class ReleaseFinaleAudio {
  private context?: AudioContext;
  private gain?: GainNode;
  private readonly volume: number;

  constructor(volume: number, muted: boolean) {
    this.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) * 0.42 : 0.25;
    try {
      const context = new AudioContext();
      this.context = context;
      const master = context.createGain();
      this.gain = master;
      master.gain.value = muted ? 0 : this.volume;
      master.connect(context.destination);
      const base = context.currentTime + 0.025;
      const tone = (
        frequency: number,
        endFrequency: number,
        at: number,
        duration: number,
        level: number,
        type: OscillatorType = 'sine',
      ) => {
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, base + at);
        oscillator.frequency.exponentialRampToValueAtTime(endFrequency, base + at + duration);
        envelope.gain.setValueAtTime(0, base + at);
        envelope.gain.linearRampToValueAtTime(level, base + at + 0.018);
        envelope.gain.exponentialRampToValueAtTime(0.0001, base + at + duration);
        oscillator.connect(envelope).connect(master);
        oscillator.start(base + at);
        oscillator.stop(base + at + duration + 0.02);
      };
      // Airy build-up, a low impact, then a short resolving arpeggio (D–A–D–F#).
      const buffer = context.createBuffer(
        1,
        Math.ceil(context.sampleRate * 1.2),
        context.sampleRate,
      );
      const samples = buffer.getChannelData(0);
      let seed = 31;
      for (let i = 0; i < samples.length; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        samples[i] = ((seed / 4294967296) * 2 - 1) * Math.sin((Math.PI * i) / samples.length) ** 2;
      }
      const noise = context.createBufferSource();
      noise.buffer = buffer;
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 0.65;
      filter.frequency.setValueAtTime(180, base);
      filter.frequency.exponentialRampToValueAtTime(2200, base + 1.2);
      const noiseGain = context.createGain();
      noiseGain.gain.value = 0.22;
      noise.connect(filter).connect(noiseGain).connect(master);
      noise.start(base);
      noise.stop(base + 1.2);
      tone(120, 43, 1.25, 0.8, 0.65);
      tone(73.42, 73.42, 1.3, 1.4, 0.13, 'triangle');
      tone(146.83, 146.83, 2.25, 0.65, 0.22, 'triangle');
      tone(220, 220, 2.43, 0.7, 0.18, 'triangle');
      tone(293.66, 293.66, 2.61, 1.15, 0.16);
      tone(369.99, 369.99, 2.79, 1.25, 0.12);
      void context.resume().catch(() => undefined);
    } catch {
      this.dispose();
    }
  }

  setMuted(muted: boolean): void {
    if (this.gain && this.context) {
      this.gain.gain.setTargetAtTime(muted ? 0 : this.volume, this.context.currentTime, 0.015);
    }
  }

  setPaused(paused: boolean): void {
    if (!this.context || this.context.state === 'closed') {
      return;
    }
    void (paused ? this.context.suspend() : this.context.resume()).catch(() => undefined);
  }

  dispose(): void {
    if (this.context && this.context.state !== 'closed') {
      void this.context.close().catch(() => undefined);
    }
    this.context = undefined;
    this.gain = undefined;
  }
}
