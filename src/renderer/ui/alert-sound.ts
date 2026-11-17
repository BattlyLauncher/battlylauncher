import alertSoundUrl from '../assets/audio/alert.mp3?url';

let alertAudio: HTMLAudioElement | undefined;

export function playAlertSound(): void {
  try {
    // Keep the player alive and reuse it when several notifications arrive together.
    const audio = (alertAudio ??= new Audio(alertSoundUrl));
    audio.volume = 0.8;
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
  } catch {
    // An unavailable audio device must not prevent the notification from appearing.
  }
}
