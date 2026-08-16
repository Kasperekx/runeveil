import { load } from "js-yaml";
import npcsYaml from "@mmo/shared/data/npcs.yaml?raw";

export type NpcId = string;

export interface NpcShopOffer {
  itemId: string;
  /** -1 = infinite. */
  stock: number;
}

export type NpcDialogueAction = "trade" | "repair" | "close";

export interface NpcDialogueOption {
  id: string;
  label: string;
  /** Shown in the greeting area when this option is chosen. */
  text?: string;
  /** Special action; omit for text-only replies. */
  action?: NpcDialogueAction;
}

export interface NpcDefinition {
  id: NpcId;
  name: string;
  title: string;
  /** Idle-breathing loop; a single frame counts as a length-1 array. */
  frames: string[];
  animFps: number;
  greeting: string;
  dialogue: NpcDialogueOption[];
  shop: NpcShopOffer[];
  repairService: boolean;
}

interface NpcYamlDialogueEntry {
  id?: string;
  label: string;
  text?: string;
  action?: string;
}

interface NpcYamlEntry {
  name: string;
  title?: string;
  sprites: { folder: string; filePrefix: string; frameCount?: number };
  animFps?: number;
  greeting: string;
  dialogue?: NpcYamlDialogueEntry[];
  shop?: Array<{ item: string; stock?: number }>;
  repairService?: boolean;
}

interface NpcsYamlFile {
  npcs: Record<string, NpcYamlEntry>;
}

let catalog: Record<NpcId, NpcDefinition> = {};

function framePaths(sprites: NpcYamlEntry["sprites"]): string[] {
  const base = `assets/npcs/${sprites.folder}/${sprites.filePrefix}-idle-down`;
  const count = Math.max(1, Math.floor(sprites.frameCount ?? 1));
  if (count === 1) return [`${base}.png`];
  return Array.from({ length: count }, (_, i) => `${base}-${i + 1}.png`);
}

function parseDialogue(
  rows: NpcYamlDialogueEntry[] | undefined,
): NpcDialogueOption[] {
  if (!Array.isArray(rows)) return [];
  const out: NpcDialogueOption[] = [];
  for (const [index, row] of rows.entries()) {
    if (!row?.label?.trim()) continue;
    const action =
      row.action === "trade" ||
      row.action === "repair" ||
      row.action === "close"
        ? row.action
        : undefined;
    const text = row.text?.trim();
    if (!text && !action) continue;
    out.push({
      id: row.id?.trim() || `opt-${index}`,
      label: row.label.trim(),
      text: text || undefined,
      action,
    });
  }
  return out;
}

/** Load shared npcs.yaml (call once at boot). */
export async function loadNpcCatalog(): Promise<void> {
  const parsed = load(npcsYaml) as NpcsYamlFile;
  if (!parsed?.npcs || typeof parsed.npcs !== "object") {
    throw new Error("Invalid npcs.yaml: missing npcs map");
  }

  const next: Record<NpcId, NpcDefinition> = {};
  for (const [id, entry] of Object.entries(parsed.npcs)) {
    next[id] = {
      id,
      name: entry.name,
      title: entry.title ?? "",
      frames: framePaths(entry.sprites),
      animFps: entry.animFps ?? 3,
      greeting: entry.greeting.trim(),
      dialogue: parseDialogue(entry.dialogue),
      shop: (entry.shop ?? []).map((row) => ({
        itemId: row.item,
        stock:
          typeof row.stock === "number" && row.stock >= 0
            ? Math.floor(row.stock)
            : -1,
      })),
      repairService: entry.repairService === true,
    };
  }

  catalog = next;
}

export function getNpc(id: NpcId): NpcDefinition {
  const npc = catalog[id];
  if (!npc) throw new Error(`Unknown npc id: ${id}`);
  return npc;
}

export function hasNpc(id: NpcId): boolean {
  return id in catalog;
}
