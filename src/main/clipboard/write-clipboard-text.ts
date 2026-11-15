import { clipboard } from 'electron';
import { setTimeout as delay } from 'node:timers/promises';

interface TextClipboard {
  writeText(value: string): void;
  readText(): string;
}

/** Confirm the OS accepted the text and tolerate temporary clipboard contention. */
export async function writeVerifiedClipboardText(
  value: string,
  target: TextClipboard = clipboard,
  wait: () => Promise<unknown> = () => delay(60),
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      target.writeText(value);
      if (target.readText() === value) {
        return;
      }
    } catch {
      // Another application may be holding the OS clipboard. Retry briefly.
    }
    if (attempt < 4) {
      await wait();
    }
  }
  throw new Error('Clipboard write failed');
}
