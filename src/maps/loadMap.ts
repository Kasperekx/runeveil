import {
  collidersFromMap,
  type MapCircleCollider,
  type MapDocument,
} from "./types";

export type { MapCircleCollider, MapDocument };
export { collidersFromMap };

const DEFAULT_MAP_URL = "/maps/hunting_grounds.json";

const MAP_URLS: Record<string, string> = {
  hunting_grounds: "/maps/hunting_grounds.json",
  "hunters-tavern": "/maps/hunters-tavern.json",
};

/** Resolve a map document URL by id (outdoor hub, interiors, …). */
export function mapUrlForId(mapId: string): string {
  return MAP_URLS[mapId] ?? DEFAULT_MAP_URL;
}

/** Fetch and lightly validate a map document from public/. */
export async function loadMap(
  urlOrId = DEFAULT_MAP_URL,
): Promise<MapDocument> {
  const url = urlOrId.startsWith("/") ? urlOrId : mapUrlForId(urlOrId);
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
