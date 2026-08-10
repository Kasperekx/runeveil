/** True if target is within range and within ±coneDegrees/2 of the aim vector. */
export function inCone(
  originX: number,
  originY: number,
  aimX: number,
  aimY: number,
  targetX: number,
  targetY: number,
  range: number,
  coneDegrees: number,
): boolean {
  const dx = targetX - originX;
  const dy = targetY - originY;
  const dist = Math.hypot(dx, dy);
  if (dist > range) return false;
  if (dist < 1e-6) return true;
  const adx = aimX - originX;
  const ady = aimY - originY;
  const aimLen = Math.hypot(adx, ady);
  if (aimLen < 1e-6) return true;
  const cos = (dx * adx + dy * ady) / (dist * aimLen);
  const half = (coneDegrees * Math.PI) / 360;
  return Math.acos(Math.min(1, Math.max(-1, cos))) <= half;
}
