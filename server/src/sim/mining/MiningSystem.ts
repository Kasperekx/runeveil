import type { Client } from "colyseus";
import {
  awardProfessionExperience,
  getProfessionConfig,
  getProfessionGatherNode,
  professionXpForLevel,
} from "../../content/professionConfig.js";
import { emptyItemData } from "../itemization.js";
import { addItemToPlayer } from "../inventoryOps.js";
import type { PlayerState } from "../../schema/GameState.js";
import type { WorldHost } from "../WorldHost.js";

const MINING_ACTIVATION_RANGE = 72;

export class MiningSystem {
  readonly channels = new Map<
    string,
    { nodeKey: string; nodeId: string; completeAt: number }
  >();
  readonly depletedNodes = new Map<string, number>();

  constructor(private readonly host: WorldHost) {}

  clearSession(sessionId: string): void {
    this.channels.delete(sessionId);
  }

  tickRespawns(now: number): void {
    for (const [nodeKey, respawnAt] of this.depletedNodes) {
      if (now < respawnAt) continue;
      this.depletedNodes.delete(nodeKey);
      this.host.broadcast("miningNodeRespawned", { nodeKey });
    }
  }

  sendState(client: Client): void {
    const nodes = Array.from(this.depletedNodes.entries()).map(
      ([nodeKey, respawnAt]) => ({ nodeKey, respawnAt }),
    );
    client.send("miningNodesState", { nodes });
  }

  handleStart(client: Client, data: MineNodePayload): void {
    const player = this.host.livingPlayer(client);
    if (!player || typeof data?.nodeKey !== "string") return;
    if (typeof data.nodeId !== "string") return;

    this.host.applyClientPosition(player, data.x, data.y);
    const spot = this.findSpot(player, data.nodeKey);
    if (!spot || spot.nodeId !== data.nodeId) {
      client.send("notice", { kind: "mining_node_missing" });
      return;
    }
    if (this.isDepleted(data.nodeKey)) {
      client.send("notice", { kind: "mining_node_depleted" });
      return;
    }
    if (
      Math.hypot(player.x - spot.x, player.y - spot.y) > spot.activationRadius
    ) {
      client.send("notice", { kind: "mining_too_far" });
      return;
    }

    const node = getProfessionGatherNode(data.nodeId);
    const profession = node ? getProfessionConfig(node.professionId) : null;
    if (!node || !profession) return;

    const state = this.host.professionState(player, node.professionId);
    if (state.level < node.level) {
      client.send("notice", { kind: "profession_level_too_low" });
      return;
    }
    if (!this.host.playerHasGatheringTool(player, node.requiredTool)) {
      client.send("notice", { kind: "mining_pickaxe_required" });
      return;
    }

    this.channels.set(client.sessionId, {
      nodeKey: data.nodeKey,
      nodeId: data.nodeId,
      completeAt: Date.now() + node.gatherTimeMs,
    });
  }

  handleComplete(client: Client, data: MineNodePayload): void {
    const player = this.host.livingPlayer(client);
    if (!player || typeof data?.nodeKey !== "string") return;
    if (typeof data.nodeId !== "string") return;

    const channel = this.channels.get(client.sessionId);
    this.channels.delete(client.sessionId);
    if (
      !channel ||
      channel.nodeKey !== data.nodeKey ||
      channel.nodeId !== data.nodeId
    ) {
      return;
    }

    const now = Date.now();
    if (now < channel.completeAt - 150) return;
    if (now > channel.completeAt + 4000) return;

    this.host.applyClientPosition(player, data.x, data.y);
    const spot = this.findSpot(player, data.nodeKey);
    if (!spot || spot.nodeId !== data.nodeId) {
      client.send("notice", { kind: "mining_node_missing" });
      return;
    }
    if (this.isDepleted(data.nodeKey)) {
      client.send("notice", { kind: "mining_node_depleted" });
      return;
    }
    if (
      Math.hypot(player.x - spot.x, player.y - spot.y) > spot.activationRadius
    ) {
      client.send("notice", { kind: "mining_too_far" });
      return;
    }

    const node = getProfessionGatherNode(data.nodeId);
    const profession = node ? getProfessionConfig(node.professionId) : null;
    if (!node || !profession) return;

    const state = this.host.professionState(player, node.professionId);
    if (state.level < node.level) {
      client.send("notice", { kind: "profession_level_too_low" });
      return;
    }
    if (!this.host.playerHasGatheringTool(player, node.requiredTool)) {
      client.send("notice", { kind: "mining_pickaxe_required" });
      return;
    }

    const quantity =
      node.output.quantityMin +
      Math.floor(
        Math.random() * (node.output.quantityMax - node.output.quantityMin + 1),
      );
    const output = emptyItemData(node.output.itemId, quantity);
    if (!this.host.canFitCraftOutput(player, [], output)) {
      client.send("notice", { kind: "inventory_full" });
      return;
    }
    if (!addItemToPlayer(player, output, player.slots.length)) return;

    const respawnAt = now + node.respawnMs;
    this.depletedNodes.set(data.nodeKey, respawnAt);
    this.host.broadcast("miningNodeDepleted", {
      nodeKey: data.nodeKey,
      respawnAt,
    });

    const gainedXp = node.xp;
    const result = awardProfessionExperience(profession, state, gainedXp);
    state.level = result.level;
    state.experience = result.experience;
    state.experienceToLevel = professionXpForLevel(profession, result.level);
    player.isNew = false;
    this.host.persistPlayer(player);
    client.send("oreMined", {
      professionId: node.professionId,
      nodeId: node.id,
      nodeKey: data.nodeKey,
      itemId: node.output.itemId,
      quantity,
      xp: gainedXp,
      levelsGained: result.levelsGained,
      level: state.level,
    });
  }

  private isDepleted(nodeKey: string): boolean {
    const respawnAt = this.depletedNodes.get(nodeKey);
    if (!respawnAt) return false;
    if (Date.now() >= respawnAt) {
      this.depletedNodes.delete(nodeKey);
      return false;
    }
    return true;
  }

  private findSpot(
    player: PlayerState,
    nodeKey: string,
  ): {
    x: number;
    y: number;
    nodeId: string;
    activationRadius: number;
  } | null {
    const map = this.host.mapForPlayer(player);
    for (const prop of map.props) {
      const interaction = map.propTypes[prop.type]?.interaction;
      if (!interaction || interaction.kind !== "mining") continue;
      const key = `${map.id}:${prop.type}:${prop.x}:${prop.y}`;
      if (key !== nodeKey) continue;
      return {
        x: prop.x + (interaction.offsetX ?? 0),
        y: prop.y + (interaction.offsetY ?? 0),
        nodeId: interaction.nodeId,
        activationRadius: Math.max(
          1,
          interaction.activationRadius ?? MINING_ACTIVATION_RANGE,
        ),
      };
    }
    return null;
  }
}

type MineNodePayload = {
  nodeKey?: string;
  nodeId?: string;
  x?: number;
  y?: number;
};
