export interface TutorialRectangle {
  readonly bottom: number;
  readonly height: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly width: number;
}

export interface TutorialCardPosition {
  readonly left: number;
  readonly top: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function positionTutorialCard(
  target: TutorialRectangle,
  card: { readonly height: number; readonly width: number },
  viewport: { readonly height: number; readonly width: number },
  margin = 16,
): TutorialCardPosition {
  const candidates = [
    {
      left: target.left + (target.width - card.width) / 2,
      top: target.bottom + margin,
      available: viewport.height - target.bottom,
      required: card.height + margin,
    },
    {
      left: target.left + (target.width - card.width) / 2,
      top: target.top - card.height - margin,
      available: target.top,
      required: card.height + margin,
    },
    {
      left: target.right + margin,
      top: target.top + (target.height - card.height) / 2,
      available: viewport.width - target.right,
      required: card.width + margin,
    },
    {
      left: target.left - card.width - margin,
      top: target.top + (target.height - card.height) / 2,
      available: target.left,
      required: card.width + margin,
    },
  ];
  const candidate =
    candidates.find((entry) => entry.available >= entry.required) ??
    [...candidates].sort(
      (left, right) => right.available - right.required - (left.available - left.required),
    )[0];
  return {
    left: clamp(candidate?.left ?? margin, margin, viewport.width - card.width - margin),
    top: clamp(candidate?.top ?? margin, margin, viewport.height - card.height - margin),
  };
}
