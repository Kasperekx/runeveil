import { Assets, Container, extensions } from "pixi.js";
import { TiledMap, tiledMapLoader, type TiledMapAsset } from "pixi-tiledmap";

/** Object layers remain visible in Tiled, but are runtime metadata in-game. */
const AUTHORING_ONLY_LAYERS = ["props", "gameplay"];

let loaderRegistered = false;

/** Load terrain authored in Tiled while keeping gameplay entities Y-sorted by us. */
export async function loadTiledTerrain(source: string): Promise<Container> {
  if (!loaderRegistered) {
    extensions.add(tiledMapLoader);
    loaderRegistered = true;
  }

  const asset = (await Assets.load(source)) as TiledMapAsset;
  const container = asset.container as TiledMap;
  container.label = "tiled-terrain";
  container.eventMode = "none";
  container.zIndex = 0;

  for (const layerName of AUTHORING_ONLY_LAYERS) {
    const layer = container.getLayer(layerName);
    if (layer) layer.visible = false;
  }

  // Pixel-art maps must not inherit Pixi's default linear filtering.
  for (const renderer of container.tileSetRenderers) {
    if (renderer.baseTexture) renderer.baseTexture.source.scaleMode = "nearest";
  }
  applyNearestFiltering(container);

  return container;
}

function applyNearestFiltering(container: Container): void {
  for (const child of container.children) {
    if ("texture" in child) {
      const texture = (
        child as { texture?: { source?: { scaleMode: string } } }
      ).texture;
      if (texture?.source) texture.source.scaleMode = "nearest";
    }
    if (child instanceof Container) applyNearestFiltering(child);
  }
}
