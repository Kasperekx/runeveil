import type { Client } from "colyseus";
import {
  getQuestConfig,
  QUESTS,
  type QuestConfig,
} from "../../content/questConfig.js";
import { QuestState, type PlayerState } from "../../schema/GameState.js";
import type { QuestProgressEvent } from "../questEvents.js";
import type { WorldHost } from "../WorldHost.js";

const COOKING_STATION_RANGE = 132;

export class QuestSystem {
  constructor(private readonly host: WorldHost) {}

  handleAccept(client: Client, data: { questId?: string }): void {
    const player = this.host.livingPlayer(client);
    const quest = data?.questId ? getQuestConfig(data.questId) : null;
    if (!player || !quest || this.questState(player, quest.id)) return;
    if (!this.prerequisiteCompleted(player, quest.prerequisite)) {
      client.send("notice", { kind: "quest_prerequisite_missing" });
      return;
    }
    if (!quest.giverNpcId || !this.host.isNearNpcId(player, quest.giverNpcId)) {
      client.send("notice", { kind: "quest_giver_too_far" });
      return;
    }

    this.addQuest(player, quest.id);
    player.isNew = false;
    this.host.persistPlayer(player);
    client.send("questAccepted", { questId: quest.id });
  }

  handleClaim(client: Client, data: { questId?: string }): void {
    const player = this.host.livingPlayer(client);
    if (!player || !data?.questId) return;
    const state = this.questState(player, data.questId);
    const quest = state ? getQuestConfig(state.questId) : null;
    if (!state || !quest || state.status !== "ready_to_claim") {
      return;
    }
    if (!this.isTurnInReachable(player, quest)) {
      client.send("notice", { kind: "quest_turn_in_too_far" });
      return;
    }

    state.status = "completed";
    player.gold += quest.rewards.gold;
    if (quest.rewards.experience > 0) {
      this.host.grantExperience(client, player, quest.rewards.experience);
    }
    this.ensureAvailable(player);
    player.isNew = false;
    this.host.persistPlayer(player);
    client.send("questClaimed", {
      questId: quest.id,
      gold: quest.rewards.gold,
      experience: quest.rewards.experience,
    });
  }

  ensureAvailable(player: PlayerState): void {
    let added = true;
    while (added) {
      added = false;
      for (const quest of Object.values(QUESTS)) {
        if (this.questState(player, quest.id)) continue;
        if (!quest.autoStart) continue;
        if (!this.prerequisiteCompleted(player, quest.prerequisite)) continue;
        this.addQuest(player, quest.id);
        added = true;
      }
    }
  }

  recordEvent(
    client: Client,
    player: PlayerState,
    event: QuestProgressEvent,
  ): void {
    const delta = Math.max(1, Math.floor(event.amount ?? 1));
    let changed = false;

    for (const state of player.quests) {
      if (state.status !== "active") continue;
      const quest = getQuestConfig(state.questId);
      if (
        !quest ||
        quest.objective.type !== event.type ||
        quest.objective.target !== event.target
      ) {
        continue;
      }

      const before = state.progress;
      state.progress = Math.min(quest.objective.quantity, before + delta);
      if (state.progress === before) continue;
      changed = true;

      if (state.progress < quest.objective.quantity) continue;
      state.status = "ready_to_claim";
      client.send("questReady", {
        questId: quest.id,
      });
    }

    if (!changed) return;
    player.isNew = false;
    this.host.persistPlayer(player);
  }

  private questState(player: PlayerState, questId: string): QuestState | null {
    for (const state of player.quests) {
      if (state.questId === questId) return state;
    }
    return null;
  }

  private addQuest(player: PlayerState, questId: string): QuestState {
    const quest = getQuestConfig(questId);
    const state = new QuestState();
    state.questId = questId;
    state.definitionVersion = quest?.version ?? 1;
    state.status = "active";
    state.progress = 0;
    player.quests.push(state);
    return state;
  }

  private prerequisiteCompleted(
    player: PlayerState,
    prerequisite?: string,
  ): boolean {
    return (
      prerequisite === undefined ||
      this.questState(player, prerequisite)?.status === "completed"
    );
  }

  private isTurnInReachable(player: PlayerState, quest: QuestConfig): boolean {
    if (quest.turnIn.kind === "npc") {
      return this.host.isNearNpcId(player, quest.turnIn.target);
    }
    const station = (this.host.mapForPlayer(player).cookingStations ?? []).find(
      (candidate) => candidate.id === quest.turnIn.target,
    );
    return (
      station !== undefined &&
      Math.hypot(player.x - station.x, player.y - station.y) <=
        Math.max(1, station.radius ?? COOKING_STATION_RANGE)
    );
  }
}
