/**
 * Class combat resources (rage / mana / energy).
 * Rage v1 mirrors WoW: build in combat, drain out of combat, cap 100.
 */

export type ResourceKind = "none" | "rage" | "mana" | "energy";

export const RESOURCE_LABELS: Record<ResourceKind, string> = {
  none: "",
  rage: "Wściekłość",
  mana: "Mana",
  energy: "Energia",
};

/** Hard caps per kind (mana/energy stubs for future classes). */
export const RESOURCE_MAX: Record<ResourceKind, number> = {
  none: 0,
  rage: 100,
  mana: 100,
  energy: 100,
};

/** Rage gained on a successful auto-attack that deals damage. */
export const RAGE_ON_AUTO_ATTACK = 10;
/** Rage gained when the player takes creature damage. */
export const RAGE_ON_DAMAGE_TAKEN = 3;
/** Small refund-style gain when a skill actually hits at least one target. */
export const RAGE_ON_SKILL_HIT = 5;
/**
 * After this many ms without rage generation, out-of-combat decay starts.
 * Matches the feel of leaving combat before the bar starts draining.
 */
export const RAGE_DECAY_DELAY_MS = 6_000;
/**
 * Rage drained per second while decaying (WoW-like trickle, not a dump).
 * Full bar (~100) empties in ~50s once decay has started.
 */
export const RAGE_DECAY_PER_SEC = 2;

export function parseResourceKind(raw: string | undefined | null): ResourceKind {
  if (raw === "rage" || raw === "mana" || raw === "energy") return raw;
  return "none";
}

export function maxResourceFor(kind: ResourceKind): number {
  return RESOURCE_MAX[kind] ?? 0;
}

export function clampResource(value: number, max: number): number {
  if (max <= 0) return 0;
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, Math.floor(value)));
}
