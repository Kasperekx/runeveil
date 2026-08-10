import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";

export type QuestObjectiveType = "kill" | "craft";
export type QuestTurnInKind = "npc" | "station";

export interface QuestConfig {
  id: string;
  version: number;
  name: string;
  prerequisite?: string;
  giverNpcId?: string;
  autoStart: boolean;
  turnIn: {
    kind: QuestTurnInKind;
    target: string;
  };
  objective: {
    type: QuestObjectiveType;
    target: string;
    quantity: number;
  };
  rewards: {
    gold: number;
    experience: number;
  };
}

interface QuestYaml {
  version?: number;
  name: string;
  prerequisite?: string;
  giverNpcId?: string;
  autoStart?: boolean;
  turnIn?: {
    kind?: QuestTurnInKind;
    target?: string;
  };
  objective?: {
    type?: QuestObjectiveType;
    target?: string;
    quantity?: number;
  };
  rewards?: { gold?: number; experience?: number };
}

function whole(value: number | undefined, fallback: number): number {
  return Math.max(0, Math.floor(value ?? fallback));
}

function loadQuests(): Record<string, QuestConfig> {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "../../../src/data/quests.yaml");
  const parsed = load(readFileSync(path, "utf8")) as {
    quests?: Record<string, QuestYaml>;
  };
  if (!parsed?.quests) throw new Error(`Invalid quests.yaml at ${path}`);

  const quests: Record<string, QuestConfig> = {};
  for (const [id, quest] of Object.entries(parsed.quests)) {
    const objective = quest.objective;
    const turnIn = quest.turnIn;
    if (
      !objective ||
      (objective.type !== "kill" && objective.type !== "craft") ||
      !objective.target ||
      !turnIn ||
      (turnIn.kind !== "npc" && turnIn.kind !== "station") ||
      !turnIn.target
    ) {
      throw new Error(`Invalid objective in quest ${id}`);
    }
    quests[id] = {
      id,
      version: Math.max(1, whole(quest.version, 1)),
      name: quest.name,
      prerequisite: quest.prerequisite,
      giverNpcId: quest.giverNpcId,
      autoStart: quest.autoStart === true,
      turnIn: { kind: turnIn.kind, target: turnIn.target },
      objective: {
        type: objective.type,
        target: objective.target,
        quantity: Math.max(1, whole(objective.quantity, 1)),
      },
      rewards: {
        gold: whole(quest.rewards?.gold, 0),
        experience: whole(quest.rewards?.experience, 0),
      },
    };
  }
  return quests;
}

export const QUESTS = loadQuests();

export function getQuestConfig(id: string): QuestConfig | null {
  return QUESTS[id] ?? null;
}
