import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const CHECK_ONLY = process.argv.includes("--check");
const MAP_IDS = ["hunting_grounds"];
const FLIP_MASK = 0x0fffffff;

for (const mapId of MAP_IDS) {
  await buildMap(mapId);
}

async function buildMap(mapId) {
  const basePath = resolve(`public/maps/${mapId}.json`);
  const tiledPath = resolve(`public/maps/${mapId}.tmj`);
  const outputPath = resolve(`public/maps/generated/${mapId}.json`);
  const [base, tiled] = await Promise.all([
    readJson(basePath),
    readJson(tiledPath),
  ]);

  assertTiledMap(tiled, tiledPath);
  const layers = flattenLayers(tiled.layers);
  const mapProperties = propertiesOf(tiled);
  const width = numberProperty(
    mapProperties,
    "worldWidth",
    tiled.width * tiled.tilewidth,
  );
  const height = numberProperty(
    mapProperties,
    "worldHeight",
    tiled.height * tiled.tileheight,
  );
  const playableObject = requiredObject(layers, "playable", "playable-area");
  const playerObject = requiredObject(layers, "player-spawns", "player");

  const output = {
    id: stringProperty(mapProperties, "id", mapId),
    tiledMap: `/maps/${mapId}.tmj`,
    width,
    height,
    tileSize: base.tileSize,
    playable: {
      minX: playableObject.x,
      maxX: playableObject.x + playableObject.width,
      minY: playableObject.y,
      maxY: playableObject.y + playableObject.height,
    },
    ground: base.ground,
    groundPatches: objectsOf(layers, "terrain-overlays").map((object) => {
      const props = propertiesOf(object);
      return {
        texture: stringProperty(props, "runtimeTexture"),
        tileScale: numberProperty(props, "tileScale", 1),
        x: object.x,
        y: object.y - object.height,
        width: object.width,
        height: object.height,
      };
    }),
    propTypes: base.propTypes,
    props: objectsOf(layers, "props").map((object) =>
      propFromObject(object, tiled, base),
    ),
    spawns: {
      player: { x: playerObject.x, y: playerObject.y },
      animals: objectsOf(layers, "creature-spawns").map((object) => ({
        id: requiredName(object, "creature-spawns"),
        kind: stringProperty(propertiesOf(object), "kind"),
        x: object.x,
        y: object.y,
      })),
    },
    npcs: objectsOf(layers, "npcs").map((object) => ({
      id: requiredName(object, "npcs"),
      npcId: stringProperty(propertiesOf(object), "npcId"),
      x: object.x,
      y: object.y,
    })),
    cookingStations: objectsOf(layers, "cooking-stations").map((object) => ({
      id: requiredName(object, "cooking-stations"),
      name: stringProperty(propertiesOf(object), "displayName", object.name),
      x: object.x + object.width / 2,
      y: object.y + object.height / 2,
      radius: Math.max(object.width, object.height) / 2,
    })),
    homes: objectsOf(layers, "homes").map((object) => ({
      id: requiredName(object, "homes"),
      name: stringProperty(propertiesOf(object), "displayName", object.name),
      x: object.x,
      y: object.y,
    })),
  };

  validateRuntimeMap(output);
  const serialized = `${JSON.stringify(output, null, 2)}\n`;

  if (CHECK_ONLY) {
    const existing = await readFile(outputPath, "utf8").catch(() => "");
    if (existing !== serialized) {
      throw new Error(
        `${outputPath} jest nieaktualny. Uruchom npm run maps:build.`,
      );
    }
    console.log(`[maps] OK ${mapId}`);
    return;
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized);
  console.log(`[maps] zbudowano ${mapId} -> ${outputPath}`);
}

function propFromObject(object, tiled, base) {
  if (!Number.isInteger(object.gid)) {
    throw new Error(
      `Obiekt ${object.name || object.id} na warstwie props nie jest tile objectem.`,
    );
  }
  const tile = tileDefinitionForGid(tiled.tilesets, object.gid);
  const propType = stringProperty(propertiesOf(tile), "propType");
  const definition = base.propTypes[propType];
  if (!definition)
    throw new Error(`Brak propTypes.${propType} w mapie bazowej.`);

  const width = object.width || tile.imagewidth;
  const height = object.height || tile.imageheight;
  if (!(width > 0) || !(height > 0)) {
    throw new Error(`Prop ${propType} nie ma poprawnych wymiarów.`);
  }

  return {
    type: propType,
    x: round(object.x + width * definition.anchorX),
    y: round(object.y - height + height * definition.anchorY),
  };
}

function tileDefinitionForGid(tilesets, rawGid) {
  const gid = (rawGid >>> 0) & FLIP_MASK;
  const tileset = [...tilesets]
    .filter(
      (candidate) =>
        Number.isInteger(candidate.firstgid) && candidate.firstgid <= gid,
    )
    .sort((a, b) => b.firstgid - a.firstgid)[0];
  if (!tileset || tileset.source) {
    throw new Error(`Nieobsługiwany lub brakujący tileset dla GID ${gid}.`);
  }
  const tile = tileset.tiles?.find(
    (candidate) => candidate.id === gid - tileset.firstgid,
  );
  if (!tile) throw new Error(`Brak definicji tile dla GID ${gid}.`);
  return tile;
}

function flattenLayers(layers) {
  return layers.flatMap((layer) => [
    layer,
    ...(layer.layers ? flattenLayers(layer.layers) : []),
  ]);
}

function objectsOf(layers, layerName) {
  const layer = layers.find((candidate) => candidate.name === layerName);
  if (!layer || layer.type !== "objectgroup") {
    throw new Error(`Brak warstwy obiektowej "${layerName}".`);
  }
  return layer.objects ?? [];
}

function requiredObject(layers, layerName, objectName) {
  const object = objectsOf(layers, layerName).find(
    (candidate) => candidate.name === objectName,
  );
  if (!object)
    throw new Error(`Brak obiektu "${objectName}" na warstwie "${layerName}".`);
  return object;
}

function propertiesOf(value) {
  return new Map(
    (value.properties ?? []).map((property) => [property.name, property.value]),
  );
}

function stringProperty(properties, name, fallback) {
  const value = properties.get(name) ?? fallback;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Brak właściwości tekstowej "${name}".`);
  }
  return value;
}

function numberProperty(properties, name, fallback) {
  const value = properties.get(name) ?? fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Brak właściwości liczbowej "${name}".`);
  }
  return value;
}

function requiredName(object, layerName) {
  if (typeof object.name !== "string" || object.name.trim() === "") {
    throw new Error(
      `Obiekt na warstwie "${layerName}" musi mieć unikalną nazwę.`,
    );
  }
  return object.name;
}

function assertTiledMap(map, path) {
  if (
    map?.type !== "map" ||
    !Array.isArray(map.layers) ||
    !Array.isArray(map.tilesets)
  ) {
    throw new Error(`Nieprawidłowa mapa Tiled: ${path}`);
  }
}

function validateRuntimeMap(map) {
  if (!(map.width > 0) || !(map.height > 0))
    throw new Error("Mapa ma nieprawidłowy rozmiar.");
  const ids = [
    ...map.spawns.animals.map((entry) => entry.id),
    ...map.npcs.map((entry) => entry.id),
    ...map.cookingStations.map((entry) => entry.id),
    ...map.homes.map((entry) => entry.id),
  ];
  if (new Set(ids).size !== ids.length)
    throw new Error("Id obiektów mapy muszą być unikalne.");
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
