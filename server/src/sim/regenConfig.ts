/**
 * Out-of-combat HP regen (keep numbers in sync with design doc).
 * Combat = took creature damage recently.
 */
export const REGEN_OUT_OF_COMBAT_MS = 6000;
export const REGEN_TICK_MS = 2000;
export const REGEN_BASE = 1;
export const REGEN_PER_SPIRIT = 0.25;
export const REGEN_PER_LEVEL = 0.15;

/** HP restored per regen tick. */
export function regenHealAmount(spirit: number, level: number): number {
  const s = Math.max(0, spirit);
  const lvl = Math.max(1, Math.floor(level));
  return Math.max(
    1,
    Math.floor(REGEN_BASE + s * REGEN_PER_SPIRIT + lvl * REGEN_PER_LEVEL),
  );
}
