import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { SHARED_DATA_DIR } from "@mmo/shared/data/dir";
import { getItemConfig } from "./itemConfig.js";

export interface ProfessionIngredient {
  itemId: string;
  quantity: number;
}

export interface ProfessionRecipeConfig {
  id: string;
  professionId: string;
  name: string;
  level: number;
  xp: number;
  craftTimeMs: number;
  /** World station required to craft this recipe. */
  station: "cooking" | "forge";
  output: { itemId: string; quantity: number };
  ingredients: ProfessionIngredient[];
}

export interface ProfessionGatherNodeConfig {
  id: string;
  professionId: string;
  name: string;
  description: string;
  level: number;
  xp: number;
  gatherTimeMs: number;
  respawnMs: number;
  /** Matches `gatheringTool` on items (e.g. mining). */
  requiredTool: string;
  output: { itemId: string; quantityMin: number; quantityMax: number };
}

export interface ProfessionConfig {
  id: string;
  name: string;
  maxLevel: number;
  xpBase: number;
  xpStep: number;
  recipes: Record<string, ProfessionRecipeConfig>;
  nodes: Record<string, ProfessionGatherNodeConfig>;
}

interface RecipeYamlEntry {
  name: string;
  level?: number;
  xp?: number;
  craftTimeMs?: number;
  station?: "cooking" | "forge";
  output?: { item?: string; quantity?: number };
  ingredients?: Array<{ item?: string; quantity?: number }>;
}

interface NodeYamlEntry {
  name: string;
  description?: string;
  level?: number;
  xp?: number;
  gatherTimeMs?: number;
  respawnMs?: number;
  requiredTool?: string;
  output?: {
    item?: string;
    quantity?: number;
    quantityMin?: number;
    quantityMax?: number;
  };
}

interface ProfessionYamlEntry {
  name: string;
  maxLevel?: number;
  xp?: { base?: number; step?: number };
  recipes?: Record<string, RecipeYamlEntry>;
  nodes?: Record<string, NodeYamlEntry>;
}

function loadYaml(): Record<string, ProfessionYamlEntry> {
  const path = join(SHARED_DATA_DIR, "professions.yaml");
  const parsed = load(readFileSync(path, "utf8")) as {
    professions?: Record<string, ProfessionYamlEntry>;
  };
  if (!parsed?.professions)
    throw new Error(`Invalid professions.yaml at ${path}`);
  return parsed.professions;
}

function whole(value: number | undefined, fallback: number): number {
  return Math.max(0, Math.floor(value ?? fallback));
}

export const PROFESSIONS: Record<string, ProfessionConfig> = Object.fromEntries(
  Object.entries(loadYaml()).map(([id, entry]) => {
    const recipes: Record<string, ProfessionRecipeConfig> = {};
    for (const [recipeId, recipe] of Object.entries(entry.recipes ?? {})) {
      const outputId = recipe.output?.item ?? "";
      const ingredients = (recipe.ingredients ?? [])
        .map((ingredient) => ({
          itemId: ingredient.item ?? "",
          quantity: whole(ingredient.quantity, 1),
        }))
        .filter((ingredient) => ingredient.itemId && ingredient.quantity > 0);
      if (!outputId || ingredients.length === 0) {
        throw new Error(`Invalid ${id}.${recipeId} recipe in professions.yaml`);
      }
      if (!getItemConfig(outputId)) {
        throw new Error(`Unknown output item ${outputId} in ${id}.${recipeId}`);
      }
      for (const ingredient of ingredients) {
        if (!getItemConfig(ingredient.itemId)) {
          throw new Error(
            `Unknown ingredient ${ingredient.itemId} in ${id}.${recipeId}`,
          );
        }
      }
      recipes[recipeId] = {
        id: recipeId,
        professionId: id,
        name: recipe.name,
        level: Math.max(1, whole(recipe.level, 1)),
        xp: Math.max(1, whole(recipe.xp, 1)),
        craftTimeMs: Math.max(500, whole(recipe.craftTimeMs, 1600)),
        station: recipe.station === "forge" ? "forge" : "cooking",
        output: {
          itemId: outputId,
          quantity: Math.max(1, whole(recipe.output?.quantity, 1)),
        },
        ingredients,
      };
    }

    const nodes: Record<string, ProfessionGatherNodeConfig> = {};
    for (const [nodeId, node] of Object.entries(entry.nodes ?? {})) {
      const outputId = node.output?.item ?? "";
      const requiredTool = node.requiredTool?.trim() ?? "";
      if (!outputId || !requiredTool) {
        throw new Error(`Invalid ${id}.${nodeId} node in professions.yaml`);
      }
      if (!getItemConfig(outputId)) {
        throw new Error(`Unknown output item ${outputId} in ${id}.${nodeId}`);
      }
      const quantityMin = Math.max(
        1,
        whole(node.output?.quantityMin ?? node.output?.quantity, 1),
      );
      const quantityMax = Math.max(
        quantityMin,
        whole(node.output?.quantityMax ?? node.output?.quantity, quantityMin),
      );
      nodes[nodeId] = {
        id: nodeId,
        professionId: id,
        name: node.name,
        description: (node.description ?? "").trim(),
        level: Math.max(1, whole(node.level, 1)),
        xp: Math.max(1, whole(node.xp, 1)),
        gatherTimeMs: Math.max(500, whole(node.gatherTimeMs, 2000)),
        respawnMs: Math.max(5000, whole(node.respawnMs, 45000)),
        requiredTool,
        output: { itemId: outputId, quantityMin, quantityMax },
      };
    }

    return [
      id,
      {
        id,
        name: entry.name,
        maxLevel: Math.max(1, whole(entry.maxLevel, 100)),
        xpBase: Math.max(1, whole(entry.xp?.base, 30)),
        xpStep: whole(entry.xp?.step, 0),
        recipes,
        nodes,
      },
    ];
  }),
);

export function getProfessionConfig(id: string): ProfessionConfig | null {
  return PROFESSIONS[id] ?? null;
}

export function getProfessionRecipe(
  recipeId: string,
): ProfessionRecipeConfig | null {
  for (const profession of Object.values(PROFESSIONS)) {
    const recipe = profession.recipes[recipeId];
    if (recipe) return recipe;
  }
  return null;
}

export function getProfessionGatherNode(
  nodeId: string,
): ProfessionGatherNodeConfig | null {
  for (const profession of Object.values(PROFESSIONS)) {
    const node = profession.nodes[nodeId];
    if (node) return node;
  }
  return null;
}

export function professionXpForLevel(
  profession: ProfessionConfig,
  level: number,
): number {
  if (level >= profession.maxLevel) return 0;
  return profession.xpBase + Math.max(0, level - 1) * profession.xpStep;
}

export function awardProfessionExperience(
  profession: ProfessionConfig,
  current: { level: number; experience: number },
  amount: number,
): { level: number; experience: number; levelsGained: number } {
  let level = Math.min(
    profession.maxLevel,
    Math.max(1, Math.floor(current.level)),
  );
  let experience = Math.max(0, Math.floor(current.experience));
  let remaining = Math.max(0, Math.floor(amount));
  const before = level;

  while (remaining > 0 && level < profession.maxLevel) {
    const needed = professionXpForLevel(profession, level);
    const toNext = Math.max(0, needed - experience);
    if (remaining < toNext) {
      experience += remaining;
      remaining = 0;
      break;
    }
    remaining -= toNext;
    level += 1;
    experience = 0;
  }
  if (level >= profession.maxLevel) experience = 0;
  return { level, experience, levelsGained: level - before };
}
