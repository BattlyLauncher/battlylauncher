import steveUrl from '../assets/steve-loading.gif';

type GifDecoder = {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
  decode(options: { frameIndex: number }): Promise<{ image: VideoFrame }>;
  close(): void;
};

/** Decode each GIF frame explicitly: drawImage(HTMLImageElement) freezes GIFs in Chromium. */
export function steveLoader(label: string): HTMLElement {
  const container = document.createElement('div');
  container.className = 'steve-loader';
  container.setAttribute('role', 'status');
  const canvas = document.createElement('canvas');
  canvas.width = 220;
  canvas.height = 220;
  canvas.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.textContent = label;
  container.append(canvas, text);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const start = async (): Promise<void> => {
    const Decoder = (
      globalThis as unknown as {
        ImageDecoder?: new (options: { data: ArrayBuffer; type: string }) => GifDecoder;
      }
    ).ImageDecoder;
    if (!context || !Decoder) {
      return;
    }
    let decoder: GifDecoder | null = null;
    try {
      decoder = new Decoder({
        data: await (await fetch(steveUrl)).arrayBuffer(),
        type: 'image/gif',
      });
      await decoder.tracks.ready;
      const count = decoder.tracks.selectedTrack?.frameCount ?? 1;
      let index = 0;
      const next = async (): Promise<void> => {
        if (!container.isConnected) {
          decoder?.close();
          return;
        }
        try {
          const { image } = await decoder!.decode({ frameIndex: index });
          const duration = Math.max(20, (image.duration ?? 100000) / 1000);
          context.clearRect(0, 0, 220, 220);
          context.drawImage(image, 0, 0, 220, 220);
          image.close();
          const frame = context.getImageData(0, 0, 220, 220);
          for (let i = 0; i < frame.data.length; i += 4) {
            const r = frame.data[i],
              g = frame.data[i + 1],
              b = frame.data[i + 2];
            if (Math.min(r, g, b) > 110 && Math.max(r, g, b) - Math.min(r, g, b) < 16) {
              frame.data[i + 3] = 0;
            }
          }
          context.putImageData(frame, 0, 0);
          index = (index + 1) % count;
          setTimeout(() => {
            void next();
          }, duration);
        } catch {
          decoder?.close();
        }
      };
      await next();
    } catch {
      decoder?.close();
    }
  };
  requestAnimationFrame(() => {
    void start();
  });
  return container;
}
