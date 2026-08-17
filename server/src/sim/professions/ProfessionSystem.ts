import type { Client } from "colyseus";
import {
  awardProfessionExperience,
  getProfessionConfig,
  getProfessionRecipe,
  professionXpForLevel,
} from "../../content/professionConfig.js";
import { getNpcConfig } from "../../content/npcConfig.js";
import { addItemToPlayer, removeItemFromPlayer } from "../inventoryOps.js";
import { emptyItemData } from "../itemization.js";
import type { WorldHost } from "../WorldHost.js";

export class ProfessionSystem {
  readonly craftReadyAt = new Map<string, number>();

  constructor(private readonly host: WorldHost) {}

  clearSession(sessionId: string): void {
    this.craftReadyAt.delete(sessionId);
  }

  handleLearn(
    client: Client,
    data: {
      npcInstanceId?: string;
      professionId?: string;
      x?: number;
      y?: number;
    },
  ): void {
    const player = this.host.livingPlayer(client);
    if (!player || typeof data?.npcInstanceId !== "string") return;
    if (typeof data.professionId !== "string") return;

    this.host.applyClientPosition(player, data.x, data.y);

    const placement = this.host.findNpc(player, data.npcInstanceId);
    if (!placement) return;
    if (!this.host.withinNpcRange(player, placement)) {
      client.send("notice", { kind: "too_far" });
      return;
    }

    const npc = getNpcConfig(placement.npcId);
    if (!npc?.trainProfessions.includes(data.professionId)) {
      client.send("notice", { kind: "cannot_learn_profession" });
      return;
    }

    const profession = getProfessionConfig(data.professionId);
    if (!profession) return;

    if (this.host.hasProfession(player, data.professionId)) {
      client.send("notice", { kind: "profession_already_learned" });
      return;
    }

    const state = this.host.learnProfession(player, data.professionId);
    if (!state) return;

    player.isNew = false;
    this.host.persistPlayer(player);
    client.send("notice", { kind: "profession_learned" });
  }

  handleCraft(
    client: Client,
    data: {
      recipeId?: string;
      quantity?: number;
      x?: number;
      y?: number;
    },
  ): void {
    const player = this.host.livingPlayer(client);
    if (!player || typeof data?.recipeId !== "string") return;
    const recipe = getProfessionRecipe(data.recipeId);
    if (!recipe) return;
    const profession = getProfessionConfig(recipe.professionId);
    if (!profession) return;

    this.host.applyClientPosition(player, data.x, data.y);
    if (!this.host.isAtCraftStation(player, recipe.station)) {
      client.send("notice", {
        kind:
          recipe.station === "forge"
            ? "forge_station_required"
            : "cooking_station_required",
      });
      return;
    }

    const quantity = Math.min(
      20,
      Math.max(
        1,
        typeof data.quantity === "number" ? Math.floor(data.quantity) : 1,
      ),
    );
    const state = this.host.professionState(player, recipe.professionId);
    if (!state) {
      client.send("notice", { kind: "profession_not_learned" });
      return;
    }
    if (state.level < recipe.level) {
      client.send("notice", { kind: "profession_level_too_low" });
      return;
    }
    const now = Date.now();
    if (now < (this.craftReadyAt.get(client.sessionId) ?? 0)) return;

    const ingredients = recipe.ingredients.map((ingredient) => ({
      itemId: ingredient.itemId,
      quantity: ingredient.quantity * quantity,
    }));
    const output = emptyItemData(
      recipe.output.itemId,
      recipe.output.quantity * quantity,
    );
    if (!this.host.canFitCraftOutput(player, ingredients, output)) {
      client.send("notice", { kind: "inventory_full" });
      return;
    }
    if (
      !ingredients.every((ingredient) =>
        this.host.hasItemQuantity(
          player,
          ingredient.itemId,
          ingredient.quantity,
        ),
      )
    ) {
      client.send("notice", { kind: "missing_ingredients" });
      return;
    }

    for (const ingredient of ingredients) {
      if (!removeItemFromPlayer(player, ingredient.itemId, ingredient.quantity))
        return;
    }
    if (!addItemToPlayer(player, output, player.slots.length)) return;

    this.craftReadyAt.set(client.sessionId, now + recipe.craftTimeMs);
    const gainedXp = recipe.xp * quantity;
    const result = awardProfessionExperience(profession, state, gainedXp);
    state.level = result.level;
    state.experience = result.experience;
    state.experienceToLevel = professionXpForLevel(profession, result.level);
    player.isNew = false;
    this.host.persistPlayer(player);
    client.send("professionCrafted", {
      professionId: recipe.professionId,
      recipeId: recipe.id,
      quantity,
      xp: gainedXp,
      levelsGained: result.levelsGained,
      level: state.level,
    });
    this.host.recordQuestEvent(client, player, {
      type: "craft",
      target: recipe.id,
      amount: quantity,
    });
  }
}
