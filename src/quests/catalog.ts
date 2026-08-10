import { load } from "js-yaml";
import questsYaml from "../data/quests.yaml?raw";

export type QuestObjectiveType = "kill" | "craft";
export type QuestTurnInKind = "npc" | "station";

export interface QuestDefinition {
  id: string;
  version: number;
  name: string;
  category: string;
  giver: string;
  description: string;
  prerequisite?: string;
  giverNpcId?: string;
  autoStart: boolean;
  turnIn: {
    kind: QuestTurnInKind;
    target: string;
    label: string;
  };
  objective: {
    type: QuestObjectiveType;
    target: string;
    quantity: number;
    label: string;
  };
  rewards: {
    gold: number;
    experience: number;
  };
}

interface QuestYaml {
  version?: number;
  name: string;
  category?: string;
  giver?: string;
  description?: string;
  prerequisite?: string;
  giverNpcId?: string;
  autoStart?: boolean;
  turnIn?: {
    kind?: QuestTurnInKind;
    target?: string;
    label?: string;
  };
  objective?: {
    type?: QuestObjectiveType;
    target?: string;
    quantity?: number;
    label?: string;
  };
  rewards?: { gold?: number; experience?: number };
}

let catalog: Record<string, QuestDefinition> = {};

export async function loadQuestCatalog(): Promise<void> {
  const parsed = load(questsYaml) as { quests?: Record<string, QuestYaml> };
  if (!parsed?.quests)
    throw new Error("Invalid quests.yaml: missing quests map");

  catalog = Object.fromEntries(
    Object.entries(parsed.quests).flatMap(([id, quest]) => {
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
        return [];
      }
      return [
        [
          id,
          {
            id,
            version: Math.max(1, Math.floor(quest.version ?? 1)),
            name: quest.name,
            category: quest.category?.trim() || "Przygoda",
            giver: quest.giver?.trim() || "Nieznany zleceniodawca",
            description: quest.description?.trim() || "",
            prerequisite: quest.prerequisite,
            giverNpcId: quest.giverNpcId,
            autoStart: quest.autoStart === true,
            turnIn: {
              kind: turnIn.kind,
              target: turnIn.target,
              label: turnIn.label?.trim() || "Odbierz nagrodę",
            },
            objective: {
              type: objective.type,
              target: objective.target,
              quantity: Math.max(1, Math.floor(objective.quantity ?? 1)),
              label: objective.label?.trim() || objective.target,
            },
            rewards: {
              gold: Math.max(0, Math.floor(quest.rewards?.gold ?? 0)),
              experience: Math.max(
                0,
                Math.floor(quest.rewards?.experience ?? 0),
              ),
            },
          } satisfies QuestDefinition,
        ],
      ];
    }),
  );
}

export function getQuest(id: string): QuestDefinition {
  const quest = catalog[id];
  if (!quest) throw new Error(`Unknown quest id: ${id}`);
  return quest;
}

export function hasQuest(id: string): boolean {
  return id in catalog;
}

export function listQuests(): QuestDefinition[] {
  return Object.values(catalog);
}
