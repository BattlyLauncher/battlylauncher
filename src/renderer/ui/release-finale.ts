import { ReleaseFinaleAudio } from './release-finale-audio';

/** A single finite cut from the old interface to the new release. */
export class ReleaseFinale {
  private readonly decorations: HTMLElement[] = [];
  private readonly animations: Animation[] = [];
  private sound?: ReleaseFinaleAudio;

  constructor(
    stage: HTMLElement,
    logo: HTMLElement,
    title: HTMLElement,
    reducedMotion: boolean,
    previousImage: string,
    volume: number,
    muted: boolean,
  ) {
    const version = document.createElement('div');
    version.className = 'release-finale__version';
    version.setAttribute('aria-hidden', 'true');
    version.translate = false;
    for (const character of '3.1') {
      const digit = document.createElement('span');
      digit.textContent = character;
      version.append(digit);
    }
    const wordmark = document.createElement('div');
    wordmark.className = 'release-finale__wordmark';
    wordmark.textContent = 'BATTLY LAUNCHER';
    wordmark.translate = false;
    wordmark.setAttribute('aria-hidden', 'true');
    const transition = document.createElement('div');
    transition.className = 'release-finale__transition';
    transition.setAttribute('aria-hidden', 'true');
    this.decorations.push(version, wordmark, transition);
    stage.append(...this.decorations);
    if (reducedMotion) {
      return;
    }
    this.sound = new ReleaseFinaleAudio(volume, muted);

    const animate = (
      element: HTMLElement,
      frames: Keyframe[],
      delay: number,
      duration: number,
      easing = 'cubic-bezier(.2,.85,.25,1)',
    ) => {
      this.animations.push(element.animate(frames, { delay, duration, easing, fill: 'backwards' }));
    };
    // The actual outgoing screenshot splits into five strips. No generic particles or diamond.
    const bounds = stage.getBoundingClientRect();
    for (let i = 0; i < 5; i++) {
      const strip = document.createElement('div');
      strip.className = 'release-finale__strip';
      strip.style.top = `${i * 20}%`;
      strip.style.backgroundImage = `url(${JSON.stringify(previousImage)})`;
      strip.style.backgroundSize = `${bounds.width}px ${bounds.height}px`;
      strip.style.backgroundPosition = `0 ${(-i * bounds.height) / 5}px`;
      transition.append(strip);
      animate(
        strip,
        [
          { opacity: 1, transform: 'translateX(0)' },
          { opacity: 1, offset: 0.25 },
          { opacity: 0, transform: `translateX(${i % 2 ? '-' : ''}110%)` },
        ],
        i * 65,
        950,
        'cubic-bezier(.75,0,.2,1)',
      );
    }
    animate(
      logo,
      [
        { opacity: 0, transform: 'scale(2.8) translateX(45px)' },
        { opacity: 1, transform: 'scale(1.04) translateX(0)', offset: 0.7 },
        { opacity: 1, transform: 'scale(1)' },
      ],
      800,
      750,
    );
    animate(
      wordmark,
      [
        { opacity: 0, transform: 'translateX(-65px)' },
        { opacity: 1, transform: 'translateX(0)' },
      ],
      1200,
      650,
    );
    Array.from(version.children).forEach((digit, index) =>
      animate(
        digit as HTMLElement,
        [
          { opacity: 0, transform: `translateY(${index === 2 ? '-' : ''}120%)` },
          { opacity: 1, transform: 'translateY(-3%)', offset: 0.8 },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        1850 + index * 180,
        550,
      ),
    );
    animate(
      title,
      [
        { opacity: 0, transform: 'translateY(16px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      3100,
      1100,
    );
    const rule = document.createElement('div');
    rule.className = 'release-finale__rule';
    rule.setAttribute('aria-hidden', 'true');
    this.decorations.push(rule);
    stage.append(rule);
    animate(
      rule,
      [
        { opacity: 0, transform: 'scaleX(0)' },
        { opacity: 1, transform: 'scaleX(1)' },
      ],
      2750,
      1450,
    );
    void Promise.all(this.animations.map((animation) => animation.finished))
      .then(() => {
        this.animations.forEach((animation) => animation.cancel());
        this.animations.length = 0;
        transition.remove();
        this.sound?.dispose();
      })
      .catch(() => undefined);
  }

  setMuted(muted: boolean): void {
    this.sound?.setMuted(muted);
  }

  setPaused(paused: boolean, reducedMotion: boolean): void {
    for (const animation of this.animations) {
      if (reducedMotion) {
        animation.cancel();
      } else if (paused && animation.playState !== 'finished') {
        animation.pause();
      } else if (!paused && animation.playState === 'paused') {
        animation.play();
      }
    }
    if (reducedMotion) {
      this.animations.length = 0;
      this.decorations
        .find((element) => element.className === 'release-finale__transition')
        ?.remove();
      this.sound?.dispose();
    } else {
      this.sound?.setPaused(paused);
    }
  }

  dispose(): void {
    this.sound?.dispose();
    this.animations.forEach((animation) => animation.cancel());
    this.animations.length = 0;
    this.decorations.forEach((element) => element.remove());
  }
}
