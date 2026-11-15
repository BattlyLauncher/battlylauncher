/** Suppress quiet idle audio without routing the microphone to the speakers. */
export class WorldsVoicePlayback {
  #context: AudioContext | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;
  #entries = new Map<
    string,
    {
      source: MediaStreamAudioSourceNode;
      analyser: AnalyserNode;
      delay: DelayNode;
      gain: GainNode;
      output: MediaStreamAudioDestinationNode;
      data: Float32Array<ArrayBuffer>;
      until: number;
      open: boolean;
    }
  >();

  async add(id: string, stream: MediaStream): Promise<MediaStream | undefined> {
    this.remove(id);
    let installed: object | undefined;
    try {
      const context = (this.#context ??= new AudioContext());
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      const delay = context.createDelay(0.1);
      // Analyse before playback so the opening gate preserves the start of words.
      delay.delayTime.value = 0.04;
      const gain = context.createGain();
      gain.gain.value = 0;
      const output = context.createMediaStreamDestination();
      source.connect(analyser);
      analyser.connect(delay);
      delay.connect(gain);
      gain.connect(output);
      const entry = {
        source,
        analyser,
        delay,
        gain,
        output,
        data: new Float32Array(512),
        until: 0,
        open: false,
      };
      this.#entries.set(id, entry);
      installed = entry;
      this.#timer ??= setInterval(() => this.#sample(), 20);
      await context.resume();
      return this.#entries.get(id) === entry ? output.stream : undefined;
    } catch {
      if (installed && this.#entries.get(id) !== installed) {
        return undefined;
      }
      this.remove(id);
      // Unsupported audio processing must not prevent listening to the call.
      return stream;
    }
  }

  #sample(): void {
    const context = this.#context;
    if (!context) {
      return;
    }
    for (const entry of this.#entries.values()) {
      entry.analyser.getFloatTimeDomainData(entry.data);
      let energy = 0;
      for (const sample of entry.data) {
        energy += sample * sample;
      }
      if (Math.sqrt(energy / entry.data.length) >= 0.004) {
        entry.until = context.currentTime + 0.35;
      }
      const open = entry.until > context.currentTime;
      if (open === entry.open) {
        continue;
      }
      entry.open = open;
      entry.gain.gain.cancelScheduledValues(context.currentTime);
      entry.gain.gain.setTargetAtTime(open ? 1 : 0, context.currentTime, open ? 0.003 : 0.015);
    }
  }

  remove(id: string): void {
    const entry = this.#entries.get(id);
    if (!entry) {
      return;
    }
    entry.source.disconnect();
    entry.analyser.disconnect();
    entry.delay.disconnect();
    entry.gain.disconnect();
    entry.output.stream.getTracks().forEach((track) => track.stop());
    this.#entries.delete(id);
    if (!this.#entries.size) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  close(): void {
    for (const id of this.#entries.keys()) {
      this.remove(id);
    }
    void this.#context?.close().catch(() => undefined);
    this.#context = undefined;
  }
}
