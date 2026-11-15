import fuseUrl from '../assets/audio/plus/creeper-fuse.ogg';
import explosionUrl from '../assets/audio/plus/creeper-explosion.ogg';
import levelUpUrl from '../assets/audio/plus/level-up.ogg';

/** Local, preloaded cues; cancelling the welcome also stops every sound. */
export class PremiumWelcomeAudio {
  private readonly tracks: Record<'fuse' | 'explosion' | 'upgrade', HTMLAudioElement>;
  muted = false;

  constructor() {
    const track = (source: string, volume: number): HTMLAudioElement => {
      const audio = new Audio(source);
      audio.preload = 'auto';
      audio.volume = volume;
      return audio;
    };
    this.tracks = {
      fuse: track(fuseUrl, 0.32),
      explosion: track(explosionUrl, 0.45),
      upgrade: track(levelUpUrl, 0.28),
    };
  }

  play(cue: keyof PremiumWelcomeAudio['tracks']): void {
    const track = this.tracks[cue];
    for (const previous of Object.values(this.tracks)) {
      if (previous !== track) {
        previous.pause();
      }
    }
    if (this.muted) {
      return;
    }
    track.currentTime = 0;
    void track.play().catch(() => undefined);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    for (const track of Object.values(this.tracks)) {
      track.muted = this.muted;
    }
    return this.muted;
  }

  dispose(): void {
    for (const track of Object.values(this.tracks)) {
      track.pause();
      track.removeAttribute('src');
      track.load();
    }
  }
}
