/**
 * Shared HP-bar maths for the HUD.
 *
 * PlayerHud, TargetFrame and CharacterPanel all render the same bar, so the
 * thresholds live here — the CSS keys off `data-tier` in all three places and
 * would drift the moment one copy changed.
 */

export type VitalsTier = "high" | "mid" | "low";

export function hpRatio(hp: number, maxHp: number): number {
  return Math.max(0, Math.min(1, hp / Math.max(1, maxHp)));
}

export function hpTier(ratio: number): VitalsTier {
  if (ratio > 0.5) return "high";
  if (ratio > 0.25) return "mid";
  return "low";
}

/** Clamped so a lethal overkill never renders as a negative readout. */
export function formatHp(hp: number, maxHp: number): string {
  return `${Math.ceil(Math.max(0, hp))} / ${maxHp}`;
}

/** Drives an existing fill element, and its readout when there is one. */
export function applyHpBar(
  fill: HTMLElement,
  hp: number,
  maxHp: number,
  readout?: HTMLElement | null,
): void {
  const ratio = hpRatio(hp, maxHp);
  fill.style.width = `${ratio * 100}%`;
  fill.dataset.tier = hpTier(ratio);
  if (readout) readout.textContent = formatHp(hp, maxHp);
}
