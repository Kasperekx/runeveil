import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";

export interface NpcShopOffer {
  itemId: string;
  /** -1 = infinite stock. */
  stock: number;
}

export interface NpcConfig {
  id: string;
  name: string;
  title: string;
  greeting: string;
  shop: NpcShopOffer[];
  repairService: boolean;
}

interface NpcYamlEntry {
  name: string;
  title?: string;
  greeting: string;
  shop?: Array<{ item: string; stock?: number }>;
  repairService?: boolean;
}

interface NpcsYamlFile {
  npcs: Record<string, NpcYamlEntry>;
}

function loadYaml(): NpcsYamlFile {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "../../../src/data/npcs.yaml");
  const parsed = load(readFileSync(path, "utf8")) as NpcsYamlFile;
  if (!parsed?.npcs) {
    throw new Error(`Invalid npcs.yaml at ${path}`);
  }
  return parsed;
}

const yaml = loadYaml();

export const NPCS: Record<string, NpcConfig> = Object.fromEntries(
  Object.entries(yaml.npcs).map(([id, entry]) => [
    id,
    {
      id,
      name: entry.name,
      title: entry.title ?? "",
      greeting: entry.greeting.trim(),
      shop: (entry.shop ?? []).map((row) => ({
        itemId: row.item,
        stock:
          typeof row.stock === "number" && row.stock >= 0
            ? Math.floor(row.stock)
            : -1,
      })),
      repairService: entry.repairService === true,
    },
  ]),
);

export function getNpcConfig(npcId: string): NpcConfig | null {
  return NPCS[npcId] ?? null;
}

/** Fresh stock map for a room (itemId → remaining; omit infinite). */
export function cloneShopStock(npcId: string): Map<string, number> {
  const stock = new Map<string, number>();
  const npc = getNpcConfig(npcId);
  if (!npc) return stock;
  for (const offer of npc.shop) {
    if (offer.stock >= 0) stock.set(offer.itemId, offer.stock);
  }
  return stock;
}
