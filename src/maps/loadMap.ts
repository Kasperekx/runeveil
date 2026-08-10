import {
  collidersFromMap,
  type MapCircleCollider,
  type MapDocument,
} from "./types";

export type { MapCircleCollider, MapDocument };
export { collidersFromMap };

const DEFAULT_MAP_URL = "/maps/hunting_grounds.json";

/** Fetch and lightly validate a map document from public/. */
export async function loadMap(
  url = DEFAULT_MAP_URL,
): Promise<MapDocument> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load map ${url}: ${res.status}`);
  }
  const data = (await res.json()) as MapDocument;
  assertMap(data);
  return data;
}

function assertMap(data: MapDocument): void {
  if (!data?.id || !data.playable || !data.ground?.texture) {
    throw new Error("Invalid map document");
  }
  if (!Array.isArray(data.props) || !data.propTypes) {
    throw new Error("Map missing props / propTypes");
  }
  if (!data.spawns?.player || !Array.isArray(data.spawns.animals)) {
    throw new Error("Map missing spawns");
  }
}
