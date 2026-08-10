/** Axis-aligned playable rectangle. */
export interface RectBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface CircleBlocker {
  x: number;
  y: number;
  radius: number;
}

/** Slide: full → X-only → Y-only against circles, then clamp to bounds. */
export function resolveCircleMove(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  bodyRadius: number,
  blockers: readonly CircleBlocker[],
  bounds?: RectBounds,
): { x: number; y: number } {
  let x = toX;
  let y = toY;

  if (overlaps(x, y, bodyRadius, blockers)) {
    if (!overlaps(toX, fromY, bodyRadius, blockers)) {
      x = toX;
      y = fromY;
    } else if (!overlaps(fromX, toY, bodyRadius, blockers)) {
      x = fromX;
      y = toY;
    } else {
      x = fromX;
      y = fromY;
    }
  }

  if (bounds) {
    x = Math.min(bounds.maxX, Math.max(bounds.minX, x));
    y = Math.min(bounds.maxY, Math.max(bounds.minY, y));
    // Re-check after clamp (corner cases against blockers near edge).
    if (overlaps(x, y, bodyRadius, blockers)) {
      if (!overlaps(x, fromY, bodyRadius, blockers)) {
        y = fromY;
      } else if (!overlaps(fromX, y, bodyRadius, blockers)) {
        x = fromX;
      } else {
        x = fromX;
        y = fromY;
      }
      x = Math.min(bounds.maxX, Math.max(bounds.minX, x));
      y = Math.min(bounds.maxY, Math.max(bounds.minY, y));
    }
  }

  return { x, y };
}

function overlaps(
  x: number,
  y: number,
  bodyRadius: number,
  blockers: readonly CircleBlocker[],
): boolean {
  for (const b of blockers) {
    if (Math.hypot(b.x - x, b.y - y) < b.radius + bodyRadius) return true;
  }
  return false;
}
