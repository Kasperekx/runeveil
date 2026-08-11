import type { MapDocument } from "./loadMap.js";

export interface MapTransitionMatch {
  targetEntryId?: string;
}

/** Finds a configured door only when the authoritative pose is in range. */
export function findMapTransition(
  map: MapDocument,
  playerX: number,
  playerY: number,
  targetMapId: string,
): MapTransitionMatch | null {
  for (const prop of map.props) {
    const interaction = map.propTypes[prop.type]?.interaction;
    if (interaction?.kind !== "enter") continue;
    if (interaction.targetMapId !== targetMapId) continue;
    const x = prop.x + (interaction.offsetX ?? 0);
    const y = prop.y + (interaction.offsetY ?? 0);
    const range = Math.max(1, interaction.activationRadius ?? 72);
    if (Math.hypot(playerX - x, playerY - y) <= range) {
      return { targetEntryId: interaction.targetEntryId };
    }
  }
  return null;
}

/** Resolves a named arrival point, with a safe spawn fallback. */
export function resolveMapArrival(
  map: MapDocument,
  entryId?: string,
): { x: number; y: number } {
  const point =
    map.entryPoints?.find((candidate) => candidate.id === entryId) ??
    map.spawns.player;
  return { x: point.x, y: point.y };
}
