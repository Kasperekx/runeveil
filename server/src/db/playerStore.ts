import type { PoolClient } from "pg";
import { database } from "./database.js";
import {
  BAG_SLOT_COUNT,
  MAIN_BAG_INDEX,
  STARTER_BAGS,
  totalCapacity,
} from "../sim/bagConfig.js";
import {
  computeAttackPower,
  computeMaxHp,
  DEFAULT_CLASS_ID,
  emptyEquipment,
  EQUIPMENT_SLOT_IDS,
  getClass,
  type PlayerAttributes,
} from "../content/classConfig.js";
import { normalizeDurability } from "../sim/itemization.js";

export interface StoredSlot {
  itemId: string;
  quantity: number;
  instanceId: string;
  rarity: string;
  affixesJson: string;
  durability: number;
  maxDurability: number;
}

export type StoredEquipmentSlot = StoredSlot;

export interface StoredProfession {
  level: number;
  experience: number;
}

export interface StoredQuest {
  status: string;
  progress: number;
  definitionVersion: number;
}

export interface StoredPlayer {
  playerId: string;
  mapId: string;
  name: string;
  classId: string;
  level: number;
  experience: number;
  x: number;
  y: number;
  hp: number;
  attrs: PlayerAttributes;
  slots: StoredSlot[];
  equipment: Record<string, StoredEquipmentSlot>;
  bags: string[];
  gold: number;
  unspentAttrPoints: number;
  professions: Record<string, StoredProfession>;
  quests: Record<string, StoredQuest>;
}

interface PlayerRow {
  player_id: string;
  map_id: string;
  name: string;
  class_id: string;
  level: number;
  experience: number;
  x: number;
  y: number;
  hp: number;
  strength: number;
  agility: number;
  stamina: number;
  intellect: number;
  spirit: number;
  gold: number;
  unspent_attr_points: number;
}

interface SlotRow {
  slot_index: number;
  item_id: string;
  quantity: number;
  instance_id: string;
  rarity: string;
  affixes_json: string;
  durability: number;
  max_durability: number;
}

interface EquipmentRow extends Omit<SlotRow, "slot_index"> {
  slot_id: string;
}

/** Gold granted to brand-new characters. */
export const STARTER_GOLD = 50;

function emptySlots(count: number): StoredSlot[] {
  return Array.from({ length: count }, () => ({
    itemId: "",
    quantity: 0,
    instanceId: "",
    rarity: "common",
    affixesJson: "[]",
    durability: 0,
    maxDurability: 0,
  }));
}

function numberAtLeast(value: number, minimum: number): number {
  return Math.max(minimum, Math.floor(Number(value) || 0));
}

async function rowToPlayer(
  row: PlayerRow,
  client: PoolClient,
): Promise<StoredPlayer> {
  const playerId = row.player_id;
  const [
    bagResult,
    inventoryResult,
    equipmentResult,
    professionResult,
    questResult,
  ] = await Promise.all([
    client.query<{ slot_index: number; item_id: string }>(
      "SELECT slot_index, item_id FROM bag_slots WHERE player_id = $1 ORDER BY slot_index",
      [playerId],
    ),
    client.query<SlotRow>(
      `SELECT slot_index, item_id, quantity, instance_id, rarity, affixes_json, durability, max_durability
         FROM inventory_slots WHERE player_id = $1 ORDER BY slot_index`,
      [playerId],
    ),
    client.query<EquipmentRow>(
      `SELECT slot_id, item_id, quantity, instance_id, rarity, affixes_json, durability, max_durability
         FROM equipment_slots WHERE player_id = $1`,
      [playerId],
    ),
    client.query<{ profession_id: string; level: number; experience: number }>(
      "SELECT profession_id, level, experience FROM player_professions WHERE player_id = $1",
      [playerId],
    ),
    client.query<{
      quest_id: string;
      status: string;
      progress: number;
      definition_version: number;
    }>(
      `SELECT quest_id, status, progress, definition_version
         FROM player_quests WHERE player_id = $1`,
      [playerId],
    ),
  ]);

  const bags = Array.from({ length: BAG_SLOT_COUNT }, () => "");
  if (bagResult.rows.length === 0) {
    for (let i = 0; i < BAG_SLOT_COUNT; i++) bags[i] = STARTER_BAGS[i] ?? "";
  } else {
    for (const bag of bagResult.rows) {
      if (bag.slot_index >= 0 && bag.slot_index < BAG_SLOT_COUNT) {
        bags[bag.slot_index] = bag.item_id;
      }
    }
  }
  if (!bags[MAIN_BAG_INDEX]) bags[MAIN_BAG_INDEX] = STARTER_BAGS[0];

  const slots = emptySlots(totalCapacity(bags));
  for (const slot of inventoryResult.rows) {
    if (slot.slot_index < 0 || slot.slot_index >= slots.length) continue;
    slots[slot.slot_index] = {
      itemId: slot.item_id,
      quantity: numberAtLeast(slot.quantity, 0),
      instanceId: slot.instance_id,
      rarity: slot.rarity,
      affixesJson: slot.affixes_json,
      ...normalizeDurability(
        slot.item_id,
        numberAtLeast(slot.durability, 0),
        numberAtLeast(slot.max_durability, 0),
      ),
    };
  }

  const equipment = emptyEquipment();
  for (const slot of equipmentResult.rows) {
    if (!(slot.slot_id in equipment)) continue;
    equipment[slot.slot_id] = {
      itemId: slot.item_id,
      quantity: numberAtLeast(slot.quantity, 0),
      instanceId: slot.instance_id,
      rarity: slot.rarity,
      affixesJson: slot.affixes_json,
      ...normalizeDurability(
        slot.item_id,
        numberAtLeast(slot.durability, 0),
        numberAtLeast(slot.max_durability, 0),
      ),
    };
  }

  const professions: Record<string, StoredProfession> = {};
  for (const profession of professionResult.rows) {
    professions[profession.profession_id] = {
      level: numberAtLeast(profession.level, 1),
      experience: numberAtLeast(profession.experience, 0),
    };
  }

  const quests: Record<string, StoredQuest> = {};
  for (const quest of questResult.rows) {
    quests[quest.quest_id] = {
      status:
        quest.status === "completed"
          ? "completed"
          : quest.status === "ready_to_claim"
            ? "ready_to_claim"
            : "active",
      progress: numberAtLeast(quest.progress, 0),
      definitionVersion: numberAtLeast(quest.definition_version, 1),
    };
  }

  return {
    playerId,
    mapId: row.map_id || "hunting_grounds",
    name: row.name,
    classId: row.class_id,
    level: numberAtLeast(row.level, 1),
    experience: numberAtLeast(row.experience, 0),
    x: Number(row.x) || 0,
    y: Number(row.y) || 0,
    hp: numberAtLeast(row.hp, 0),
    attrs: {
      strength: Number(row.strength) || 0,
      agility: Number(row.agility) || 0,
      stamina: Number(row.stamina) || 0,
      intellect: Number(row.intellect) || 0,
      spirit: Number(row.spirit) || 0,
    },
    slots,
    equipment,
    bags,
    gold: numberAtLeast(row.gold, 0),
    unspentAttrPoints: numberAtLeast(row.unspent_attr_points, 0),
    professions,
    quests,
  };
}

async function save(player: StoredPlayer): Promise<void> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO players (
        player_id, map_id, name, class_id, level, experience, x, y, hp,
        strength, agility, stamina, intellect, spirit, gold,
        unspent_attr_points, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15, $16, NOW()
      ) ON CONFLICT (player_id) DO UPDATE SET
        map_id = EXCLUDED.map_id,
        name = EXCLUDED.name,
        class_id = EXCLUDED.class_id,
        level = EXCLUDED.level,
        experience = EXCLUDED.experience,
        x = EXCLUDED.x,
        y = EXCLUDED.y,
        hp = EXCLUDED.hp,
        strength = EXCLUDED.strength,
        agility = EXCLUDED.agility,
        stamina = EXCLUDED.stamina,
        intellect = EXCLUDED.intellect,
        spirit = EXCLUDED.spirit,
        gold = EXCLUDED.gold,
        unspent_attr_points = EXCLUDED.unspent_attr_points,
        updated_at = NOW()`,
      [
        player.playerId,
        player.mapId,
        player.name,
        player.classId,
        numberAtLeast(player.level, 1),
        numberAtLeast(player.experience, 0),
        player.x,
        player.y,
        numberAtLeast(player.hp, 0),
        player.attrs.strength,
        player.attrs.agility,
        player.attrs.stamina,
        player.attrs.intellect,
        player.attrs.spirit,
        numberAtLeast(player.gold, 0),
        numberAtLeast(player.unspentAttrPoints, 0),
      ],
    );

    await Promise.all([
      client.query("DELETE FROM inventory_slots WHERE player_id = $1", [
        player.playerId,
      ]),
      client.query("DELETE FROM equipment_slots WHERE player_id = $1", [
        player.playerId,
      ]),
      client.query("DELETE FROM bag_slots WHERE player_id = $1", [
        player.playerId,
      ]),
      client.query("DELETE FROM player_professions WHERE player_id = $1", [
        player.playerId,
      ]),
      client.query("DELETE FROM player_quests WHERE player_id = $1", [
        player.playerId,
      ]),
    ]);

    for (let slotIndex = 0; slotIndex < player.slots.length; slotIndex++) {
      const slot = player.slots[slotIndex] ?? emptySlots(1)[0]!;
      await client.query(
        `INSERT INTO inventory_slots
          (player_id, slot_index, item_id, quantity, instance_id, rarity, affixes_json, durability, max_durability)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          player.playerId,
          slotIndex,
          slot.itemId ?? "",
          numberAtLeast(slot.quantity, 0),
          slot.instanceId ?? "",
          slot.rarity ?? "common",
          slot.affixesJson ?? "[]",
          numberAtLeast(slot.durability, 0),
          numberAtLeast(slot.maxDurability, 0),
        ],
      );
    }

    for (const slotId of EQUIPMENT_SLOT_IDS) {
      const slot = player.equipment[slotId] ?? emptyEquipment()[slotId]!;
      await client.query(
        `INSERT INTO equipment_slots
          (player_id, slot_id, item_id, quantity, instance_id, rarity, affixes_json, durability, max_durability)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          player.playerId,
          slotId,
          slot.itemId ?? "",
          numberAtLeast(slot.quantity, 0),
          slot.instanceId ?? "",
          slot.rarity ?? "common",
          slot.affixesJson ?? "[]",
          numberAtLeast(slot.durability, 0),
          numberAtLeast(slot.maxDurability, 0),
        ],
      );
    }

    for (let slotIndex = 0; slotIndex < BAG_SLOT_COUNT; slotIndex++) {
      await client.query(
        "INSERT INTO bag_slots (player_id, slot_index, item_id) VALUES ($1, $2, $3)",
        [player.playerId, slotIndex, player.bags[slotIndex] ?? ""],
      );
    }

    for (const [professionId, profession] of Object.entries(
      player.professions,
    )) {
      await client.query(
        `INSERT INTO player_professions (player_id, profession_id, level, experience)
         VALUES ($1, $2, $3, $4)`,
        [
          player.playerId,
          professionId,
          numberAtLeast(profession.level, 1),
          numberAtLeast(profession.experience, 0),
        ],
      );
    }

    for (const [questId, quest] of Object.entries(player.quests)) {
      await client.query(
        `INSERT INTO player_quests
          (player_id, quest_id, status, progress, definition_version)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          player.playerId,
          questId,
          quest.status === "completed"
            ? "completed"
            : quest.status === "ready_to_claim"
              ? "ready_to_claim"
              : "active",
          numberAtLeast(quest.progress, 0),
          numberAtLeast(quest.definitionVersion, 1),
        ],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** PostgreSQL-backed persistent player state. All writes are transactional. */
export const playerStore = {
  async get(playerId: string): Promise<StoredPlayer | null> {
    const client = await database.connect();
    try {
      const result = await client.query<PlayerRow>(
        "SELECT * FROM players WHERE player_id = $1",
        [playerId],
      );
      const row = result.rows[0];
      return row ? await rowToPlayer(row, client) : null;
    } finally {
      client.release();
    }
  },

  save,

  createDefault(
    playerId: string,
    x: number,
    y: number,
    identity?: { name: string; classId: string },
  ): StoredPlayer {
    const cls = getClass(identity?.classId ?? DEFAULT_CLASS_ID);
    const attrs = { ...cls.base };
    const bags = [...STARTER_BAGS];
    return {
      playerId,
      mapId: "hunting_grounds",
      name: identity?.name ?? "Wędrowiec",
      classId: cls.id,
      level: 1,
      experience: 0,
      x,
      y,
      hp: computeMaxHp(attrs, cls.derived),
      attrs,
      slots: emptySlots(totalCapacity(bags)),
      equipment: emptyEquipment(),
      bags,
      gold: STARTER_GOLD,
      unspentAttrPoints: 0,
      professions: {},
      quests: {},
    };
  },

  derived(player: Pick<StoredPlayer, "classId" | "attrs">): {
    maxHp: number;
    attackPower: number;
  } {
    const cls = getClass(player.classId);
    return {
      maxHp: computeMaxHp(player.attrs, cls.derived),
      attackPower: computeAttackPower(player.attrs, cls.derived),
    };
  },
};
