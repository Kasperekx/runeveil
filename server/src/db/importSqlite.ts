import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDatabase, database } from "./database.js";
import {
  playerStore,
  type StoredPlayer,
  type StoredSlot,
} from "./playerStore.js";
import { BAG_SLOT_COUNT, STARTER_BAGS } from "../sim/bagConfig.js";
import { emptyEquipment } from "../content/classConfig.js";

type SqliteRow = Record<string, unknown>;

const defaultPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../data/players.sqlite",
);
const sqlitePath = process.argv[2] ?? defaultPath;

function asNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table),
  );
}

function columns(db: DatabaseSync, table: string): Set<string> {
  if (!tableExists(db, table)) return new Set();
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as SqliteRow[]).map(
      (row) => asString(row.name),
    ),
  );
}

function slotColumns(db: DatabaseSync, table: string): string {
  const present = columns(db, table);
  return [
    "item_id",
    "quantity",
    present.has("instance_id") ? "instance_id" : "'' AS instance_id",
    present.has("rarity") ? "rarity" : "'common' AS rarity",
    present.has("affixes_json") ? "affixes_json" : "'[]' AS affixes_json",
  ].join(", ");
}

function toSlot(row: SqliteRow): StoredSlot {
  return {
    itemId: asString(row.item_id),
    quantity: Math.max(0, Math.floor(asNumber(row.quantity))),
    instanceId: asString(row.instance_id),
    rarity: asString(row.rarity, "common"),
    affixesJson: asString(row.affixes_json, "[]"),
    durability: 0,
    maxDurability: 0,
  };
}

async function importPlayers(): Promise<void> {
  if (!existsSync(sqlitePath)) {
    throw new Error(`SQLite source does not exist: ${sqlitePath}`);
  }

  const existing = await database.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM players",
  );
  if (Number(existing.rows[0]?.count ?? 0) > 0) {
    throw new Error(
      "PostgreSQL already contains players. Import into an empty database to prevent accidental overwrites.",
    );
  }

  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    if (!tableExists(sqlite, "players")) {
      throw new Error("SQLite source does not contain a players table");
    }
    const rows = sqlite.prepare("SELECT * FROM players").all() as SqliteRow[];

    for (const row of rows) {
      const playerId = asString(row.player_id);
      if (!playerId) continue;
      const record: StoredPlayer = playerStore.createDefault(
        playerId,
        asNumber(row.x),
        asNumber(row.y),
      );
      record.name = asString(row.name, record.name);
      record.classId = asString(row.class_id, record.classId);
      record.level = Math.max(1, Math.floor(asNumber(row.level, 1)));
      record.experience = Math.max(0, Math.floor(asNumber(row.experience)));
      record.hp = Math.max(0, Math.floor(asNumber(row.hp, record.hp)));
      record.gold = Math.max(0, Math.floor(asNumber(row.gold, record.gold)));
      record.unspentAttrPoints = Math.max(
        0,
        Math.floor(asNumber(row.unspent_attr_points)),
      );
      record.attrs = {
        strength: asNumber(row.strength, record.attrs.strength),
        agility: asNumber(row.agility, record.attrs.agility),
        stamina: asNumber(row.stamina, record.attrs.stamina),
        intellect: asNumber(row.intellect, record.attrs.intellect),
        spirit: asNumber(row.spirit, record.attrs.spirit),
      };

      if (tableExists(sqlite, "bag_slots")) {
        const bags = sqlite
          .prepare(
            "SELECT slot_index, item_id FROM bag_slots WHERE player_id = ? ORDER BY slot_index",
          )
          .all(playerId) as SqliteRow[];
        if (bags.length > 0) {
          record.bags = Array.from({ length: BAG_SLOT_COUNT }, () => "");
          for (const bag of bags) {
            const index = Math.floor(asNumber(bag.slot_index, -1));
            if (index >= 0 && index < BAG_SLOT_COUNT) {
              record.bags[index] = asString(bag.item_id);
            }
          }
          if (!record.bags[0]) record.bags[0] = STARTER_BAGS[0];
        }
      }

      if (tableExists(sqlite, "inventory_slots")) {
        const slots = sqlite
          .prepare(
            `SELECT slot_index, ${slotColumns(sqlite, "inventory_slots")}
             FROM inventory_slots WHERE player_id = ? ORDER BY slot_index`,
          )
          .all(playerId) as SqliteRow[];
        for (const slot of slots) {
          const index = Math.floor(asNumber(slot.slot_index, -1));
          if (index >= 0 && index < record.slots.length) {
            record.slots[index] = toSlot(slot);
          }
        }
      }

      if (tableExists(sqlite, "equipment_slots")) {
        const equipment = emptyEquipment();
        const slots = sqlite
          .prepare(
            `SELECT slot_id, ${slotColumns(sqlite, "equipment_slots")}
             FROM equipment_slots WHERE player_id = ?`,
          )
          .all(playerId) as SqliteRow[];
        for (const slot of slots) {
          const slotId = asString(slot.slot_id);
          if (slotId in equipment) equipment[slotId] = toSlot(slot);
        }
        record.equipment = equipment;
      }

      if (tableExists(sqlite, "player_professions")) {
        const professions = sqlite
          .prepare(
            "SELECT profession_id, level, experience FROM player_professions WHERE player_id = ?",
          )
          .all(playerId) as SqliteRow[];
        for (const profession of professions) {
          const professionId = asString(profession.profession_id);
          if (!professionId) continue;
          record.professions[professionId] = {
            level: Math.max(1, Math.floor(asNumber(profession.level, 1))),
            experience: Math.max(
              0,
              Math.floor(asNumber(profession.experience)),
            ),
          };
        }
      }

      if (tableExists(sqlite, "player_quests")) {
        const quests = sqlite
          .prepare(
            "SELECT quest_id, status, progress FROM player_quests WHERE player_id = ?",
          )
          .all(playerId) as SqliteRow[];
        for (const quest of quests) {
          const questId = asString(quest.quest_id);
          if (!questId) continue;
          record.quests[questId] = {
            status: quest.status === "completed" ? "completed" : "active",
            progress: Math.max(0, Math.floor(asNumber(quest.progress))),
            definitionVersion: 1,
          };
        }
      }

      await playerStore.save(record);
    }
    console.log(
      `[database] imported ${rows.length} player(s) from ${sqlitePath}`,
    );
  } finally {
    sqlite.close();
  }
}

importPlayers()
  .then(closeDatabase)
  .catch(async (error: unknown) => {
    console.error("[database] SQLite import failed", error);
    await closeDatabase();
    process.exitCode = 1;
  });
