/** Local audio analysis only: no audio or metering data is uploaded to Battly. */
export class WorldsVoiceMeter {
  #context: AudioContext | undefined;
  #silent: GainNode | undefined;
  #sources = new Map<
    string,
    {
      source: MediaStreamAudioSourceNode;
      analyser: AnalyserNode;
      data: Uint8Array<ArrayBuffer>;
      until: number;
    }
  >();
  #timer: ReturnType<typeof setInterval> | undefined;
  #last = '';
  add(id: string, stream: MediaStream): void {
    this.remove(id);
    try {
      const context = (this.#context ??= new AudioContext());
      if (!this.#silent) {
        this.#silent = context.createGain();
        this.#silent.gain.value = 0;
        this.#silent.connect(context.destination);
      }
      void context
        .resume()
        .then(() => {
          console.warn('[Battly Worlds] Voice meter ' + JSON.stringify({ state: context.state }));
        })
        .catch((error: unknown) => {
          console.warn(
            '[Battly Worlds] Voice meter resume failed ' +
              JSON.stringify({
                name: error instanceof Error ? error.name : 'Error',
                state: context.state,
              }),
          );
        });
      const source = context.createMediaStreamSource(stream),
        analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyser.connect(this.#silent);
      this.#sources.set(id, { source, analyser, data: new Uint8Array(512), until: 0 });
      this.#timer ??= setInterval(() => this.#sample(), 160);
    } catch {
      this.remove(id); /* Metering must never interrupt the call. */
    }
  }
  remove(id: string): void {
    const item = this.#sources.get(id);
    item?.source.disconnect();
    item?.analyser.disconnect();
    this.#sources.delete(id);
  }
  #sample(): void {
    const speakers: { userId: string; level: number }[] = [];
    for (const [userId, item] of this.#sources) {
      item.analyser.getByteTimeDomainData(item.data);
      let energy = 0;
      for (const value of item.data) {
        energy += ((value - 128) / 128) ** 2;
      }
      const level = Math.sqrt(energy / item.data.length);
      if (level > 0.012) {
        item.until = Date.now() + 450;
      }
      if (item.until > Date.now()) {
        speakers.push({ userId, level: Math.min(1, Math.round(level * 500) / 100) });
      }
    }
    const signature = JSON.stringify(speakers);
    if (signature === this.#last) {
      return;
    }
    this.#last = signature;
    void window.battly.worldsVoiceActivity(speakers).catch(() => undefined);
  }
  close(): void {
    clearInterval(this.#timer);
    this.#timer = undefined;
    for (const id of this.#sources.keys()) {
      this.remove(id);
    }
    this.#silent?.disconnect();
    this.#silent = undefined;
    void this.#context?.close().catch(() => undefined);
    this.#context = undefined;
    this.#last = '';
    void window.battly.worldsVoiceActivity([]).catch(() => undefined);
  }
}
