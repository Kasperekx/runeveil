import { load } from "js-yaml";
import professionsYaml from "../data/professions.yaml?raw";

export interface ProfessionIngredient {
  itemId: string;
  quantity: number;
}
export interface ProfessionRecipe {
  id: string;
  professionId: string;
  name: string;
  description: string;
  level: number;
  xp: number;
  craftTimeMs: number;
  output: { itemId: string; quantity: number };
  ingredients: ProfessionIngredient[];
}
export interface ProfessionDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  maxLevel: number;
  xpBase: number;
  xpStep: number;
  recipes: ProfessionRecipe[];
}

interface RecipeYaml {
  name: string;
  description: string;
  level?: number;
  xp?: number;
  craftTimeMs?: number;
  output?: { item?: string; quantity?: number };
  ingredients?: Array<{ item?: string; quantity?: number }>;
}
interface ProfessionYaml {
  name: string;
  description: string;
  icon?: string;
  maxLevel?: number;
  xp?: { base?: number; step?: number };
  recipes?: Record<string, RecipeYaml>;
}

let catalog: Record<string, ProfessionDefinition> = {};
const number = (value: number | undefined, fallback: number) =>
  Math.max(0, Math.floor(value ?? fallback));

export async function loadProfessionCatalog(): Promise<void> {
  const parsed = load(professionsYaml) as {
    professions?: Record<string, ProfessionYaml>;
  };
  if (!parsed?.professions)
    throw new Error("Invalid professions.yaml: missing professions map");
  catalog = Object.fromEntries(
    Object.entries(parsed.professions).map(([id, profession]) => {
      const recipes = Object.entries(profession.recipes ?? {}).flatMap(
        ([recipeId, recipe]) => {
          const outputId = recipe.output?.item ?? "";
          if (!outputId) return [];
          return [
            {
              id: recipeId,
              professionId: id,
              name: recipe.name,
              description: recipe.description.trim(),
              level: Math.max(1, number(recipe.level, 1)),
              xp: Math.max(1, number(recipe.xp, 1)),
              craftTimeMs: Math.max(500, number(recipe.craftTimeMs, 1600)),
              output: {
                itemId: outputId,
                quantity: Math.max(1, number(recipe.output?.quantity, 1)),
              },
              ingredients: (recipe.ingredients ?? []).flatMap((ingredient) =>
                ingredient.item
                  ? [
                      {
                        itemId: ingredient.item,
                        quantity: Math.max(1, number(ingredient.quantity, 1)),
                      },
                    ]
                  : [],
              ),
            } satisfies ProfessionRecipe,
          ];
        },
      );
      return [
        id,
        {
          id,
          name: profession.name,
          description: profession.description.trim(),
          icon: profession.icon ?? "✦",
          maxLevel: Math.max(1, number(profession.maxLevel, 100)),
          xpBase: Math.max(1, number(profession.xp?.base, 30)),
          xpStep: number(profession.xp?.step, 0),
          recipes,
        } satisfies ProfessionDefinition,
      ];
    }),
  );
}

export function getProfession(id: string): ProfessionDefinition {
  const profession = catalog[id];
  if (!profession) throw new Error(`Unknown profession id: ${id}`);
  return profession;
}

export function listProfessions(): ProfessionDefinition[] {
  return Object.values(catalog);
}

export function professionXpForLevel(
  profession: ProfessionDefinition,
  level: number,
): number {
  return level >= profession.maxLevel
    ? 0
    : profession.xpBase + Math.max(0, level - 1) * profession.xpStep;
}
