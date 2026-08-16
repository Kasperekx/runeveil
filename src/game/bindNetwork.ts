import type { Application, Container } from "pixi.js";
import { parseResourceKind } from "../config/resource";
import { getProfession } from "../content/professions";
import { getQuest } from "../content/quests";
import type { NetworkAnimalSystem } from "../entities/creatures/NetworkAnimalSystem";
import type { Player } from "../entities/player/Player";
import type { GameNetwork } from "../network/GameNetwork";
import type { NetworkPlayerSnapshot } from "../network/types";
import type { GameChat } from "../ui/chat/GameChat";
import {
  formatChatSay,
  formatCombatDealt,
  formatCombatHeal,
  formatCombatTaken,
  formatLevelUp,
  formatLootDropped,
  formatXpGain,
  itemDisplayName,
} from "../ui/chat/chatLogFormat";
import type { ActionBar } from "../ui/hud/actionBar/ActionBar";
import { FloatingCombatText } from "../ui/hud/FloatingCombatText";
import type { GameToast } from "../ui/hud/GameToast";
import type { ItemCooldowns } from "../ui/hud/ItemCooldowns";
import { LevelUpBanner } from "../ui/hud/LevelUpBanner";
import type { PlayerBuffs } from "../ui/hud/PlayerBuffs";
import type { PlayerHud } from "../ui/hud/PlayerHud";
import type { InventoryPanel } from "../ui/inventory/InventoryPanel";
import type { DialogueWindow } from "../ui/panels/DialogueWindow";
import type { ProfessionsPanel } from "../ui/panels/ProfessionsPanel";
import type { Settings } from "../ui/panels/settings";
import type { DeathScreen } from "../ui/screens/DeathScreen";
import { CRAFT_REJECTION_NOTICES, noticeText } from "./notices";

export interface BindNetworkContext {
  network: GameNetwork;
  app: Application;
  world: Container;
  player: Player;
  animals: NetworkAnimalSystem;
  settings: Settings;
  playerHud: PlayerHud;
  playerBuffs: PlayerBuffs;
  actionBar: ActionBar;
  gameChat: GameChat;
  toast: GameToast;
  itemCooldowns: ItemCooldowns;
  professionsPanel: ProfessionsPanel;
  dialogueWindow: DialogueWindow;
  deathScreen: DeathScreen;
  applySheet: (snap: NetworkPlayerSnapshot) => void;
  setDeathState: (dead: boolean) => void;
  logSystem: (text: string) => void;
  getPlayerResource: () => {
    kind: string;
    resource: number;
    maxResource: number;
  };
  setPlayerResource: (state: {
    kind: string;
    resource: number;
    maxResource: number;
  }) => void;
  setPlayerGold: (gold: number) => void;
  getInventoryPanel: () => InventoryPanel | null;
}

/** Wire Colyseus callbacks onto HUD / chat / panels. Returns nothing — side effects only. */
export function bindGameNetwork(ctx: BindNetworkContext): void {
  const {
    network,
    playerHud,
    setDeathState,
    actionBar,
    applySheet,
    itemCooldowns,
    toast,
    logSystem,
    playerBuffs,
    professionsPanel,
    gameChat,
    deathScreen,
    player,
    dialogueWindow,
    animals,
    settings,
    app,
    world,
  } = ctx;

  network.onVitalsChange = (hp, maxHp) => {
    playerHud.setVitals({ hp, maxHp });
    setDeathState(hp <= 0);
  };
  network.onResourceChange = (state) => {
    ctx.setPlayerResource(state);
    playerHud.setResource({
      kind: parseResourceKind(state.kind),
      resource: state.resource,
      maxResource: state.maxResource,
    });
    actionBar.setResource(state.resource);
  };
  network.onSheetChange = (snap) => applySheet(snap);
  network.onItemUsed = (event) => {
    itemCooldowns.start(event.itemId, event.cooldownMs);
    const buff = event.buff;
    if (!buff) return;
    const parts: string[] = [];
    if (buff.strength > 0) parts.push(`+${buff.strength} Siła`);
    if (buff.stamina > 0) parts.push(`+${buff.stamina} Wytrzymałość`);
    if (buff.agility > 0) parts.push(`+${buff.agility} Zwinność`);
    if (buff.intellect > 0) parts.push(`+${buff.intellect} Intelekt`);
    if (buff.spirit > 0) parts.push(`+${buff.spirit} Duch`);
    if (parts.length === 0) return;
    const minutes = Math.round(buff.durationMs / 60000);
    const duration =
      minutes >= 60 ? `${Math.round(minutes / 60)} godz.` : `${minutes} min.`;
    const msg = `${parts.join(", ")} · ${duration}`;
    toast.show(msg);
    logSystem(`Efekt posiłku: ${msg}.`);
  };
  network.onFoodBuffState = (event) => {
    playerBuffs.setFoodBuff(event);
  };
  const pendingFood = network.getFoodBuffState();
  if (pendingFood) playerBuffs.setFoodBuff(pendingFood);
  network.requestFoodBuffState();
  network.onProfessionCrafted = (event) => {
    professionsPanel.handleCrafted(event.recipeId, event.quantity);
    const profession = getProfession(event.professionId);
    const msg =
      event.levelsGained > 0
        ? `${profession.name} ${event.level} · awans profesji!`
        : `${profession.name} · +${event.xp} PD`;
    toast.show(msg);
    logSystem(msg);
  };
  network.onOreMined = (event) => {
    const profession = getProfession(event.professionId);
    const msg =
      event.levelsGained > 0
        ? `${profession.name} ${event.level} · awans profesji!`
        : `${profession.name} · +${event.xp} PD`;
    toast.show(msg);
    logSystem(
      `Wydobyto ${itemDisplayName(event.itemId)}${
        event.quantity > 1 ? ` ×${event.quantity}` : ""
      }. ${msg}`,
    );
  };
  network.onQuestReady = (event) => {
    const quest = getQuest(event.questId);
    toast.show(`Zadanie gotowe · ${quest.name}`);
    logSystem(`Zadanie gotowe do oddania: ${quest.name}.`);
  };
  network.onQuestAccepted = (event) => {
    const quest = getQuest(event.questId);
    toast.show(`Przyjęto zadanie · ${quest.name}`);
    logSystem(`Przyjęto zadanie: ${quest.name}.`);
  };
  network.onQuestClaimed = (event) => {
    const quest = getQuest(event.questId);
    toast.show(`Nagroda odebrana · ${quest.name}`);
    logSystem(`Odebrano nagrodę za zadanie: ${quest.name}.`);
  };

  const levelUpBanner = LevelUpBanner.create();
  network.onLevelUp = (event) => {
    levelUpBanner.show(event);
    const line = formatLevelUp(event.level);
    gameChat.append(line.channel, line.text);
  };
  network.onPlayerDied = (event) => {
    setDeathState(true);
    deathScreen.show({
      lostExperience: event.lostExperience,
      penaltyPercent: event.penaltyPercent,
      homeName: event.homeName,
      respawnDelayMs: event.respawnDelayMs,
    });
    logSystem(
      `Giniesz. Tracisz ${event.lostExperience} PD (−${event.penaltyPercent}%).`,
    );
  };
  network.onPlayerRespawned = (event) => {
    setDeathState(false);
    player.setPosition(event.x, event.y);
    toast.show(`Wskrzeszono · ${event.homeName}`);
    logSystem(`Powracasz do życia przy: ${event.homeName}.`);
  };

  network.onNotice = (event) => {
    if (CRAFT_REJECTION_NOTICES.has(event.kind)) {
      professionsPanel.cancelCraft();
    }
    const message = noticeText(event.kind, ctx.getPlayerResource().kind);
    if (message) {
      toast.show(message);
      logSystem(message);
    }
  };
  network.onTradeResult = (event) => {
    ctx.setPlayerGold(event.gold);
    dialogueWindow.setGold(event.gold);
    ctx.getInventoryPanel()?.setGold(event.gold);
    if (event.kind === "buy" && typeof event.stock === "number") {
      dialogueWindow.setStock(event.itemId, event.stock);
    }
    const name = itemDisplayName(event.itemId);
    if (event.kind === "buy") {
      const spent = event.goldSpent ?? 0;
      toast.show(`Kupiono · −${spent} g`);
      logSystem(
        `Kupujesz ${name}${
          event.quantity > 1 ? ` ×${event.quantity}` : ""
        } za ${spent} g.`,
      );
    } else {
      const earned = event.goldEarned ?? 0;
      toast.show(`Sprzedano · +${earned} g`);
      logSystem(
        `Sprzedajesz ${name}${
          event.quantity > 1 ? ` ×${event.quantity}` : ""
        } za ${earned} g.`,
      );
    }
  };
  network.onEquipmentRepaired = (event) => {
    ctx.setPlayerGold(event.gold);
    dialogueWindow.setGold(event.gold);
    ctx.getInventoryPanel()?.setGold(event.gold);
    toast.show(`Naprawiono ekwipunek · −${event.totalCost} g`);
    logSystem(`Naprawiono ekwipunek za ${event.totalCost} g.`);
  };
  network.onEquipmentBroken = (event) => {
    const msg =
      event.slotIds.length === 1
        ? "Element ekwipunku został uszkodzony!"
        : `${event.slotIds.length} elementy ekwipunku zostały uszkodzone!`;
    toast.show(msg);
    logSystem(msg);
  };

  network.onChat = (event) => {
    gameChat.append("chat", formatChatSay(event.name, event.text));
  };
  network.onLootDropped = (event) => {
    const line = formatLootDropped(event.creatureKind, event.items);
    if (line) gameChat.append(line.channel, line.text);
  };

  const combatText = new FloatingCombatText(app, world);
  combatText.start();
  network.onCombatText = (event) => {
    const creatureKind =
      event.creatureKind ||
      (event.animalId ? animals.getKind(event.animalId) : null);

    if (event.target === "player") {
      if (event.kind === "heal") {
        const line = formatCombatHeal(event.amount);
        gameChat.append(line.channel, line.text);
      } else {
        const line = formatCombatTaken(event.amount, creatureKind);
        gameChat.append(line.channel, line.text);
      }
    } else {
      const line = formatCombatDealt(event.amount, creatureKind, event.killed);
      gameChat.append(line.channel, line.text);
    }

    if (!settings.current.showDamageNumbers) return;
    if (event.target === "player") {
      const { x, y } = player.position;
      if (event.kind === "heal") {
        combatText.spawn(x, y - 26, event.amount, "heal");
      } else {
        combatText.spawn(x, y - 26, event.amount, "taken");
      }
      return;
    }
    const at = animals.getPosition(event.animalId);
    if (at) combatText.spawn(at.x, at.y - 20, event.amount, "dealt");
  };
  network.onXpGain = (event) => {
    const line = formatXpGain(event.amount, event.kind);
    gameChat.append(line.channel, line.text);
    const at = event.animalId ? animals.getPosition(event.animalId) : null;
    const pos = at ?? player.position;
    combatText.spawn(pos.x, pos.y - 36, event.amount, "xp");
  };
}

export interface BindWorldNetworkContext {
  network: GameNetwork;
  applyCampfiresState: (
    campfires: Array<{ id: string; x: number; y: number }>,
  ) => Promise<void>;
  onCampfirePlaced: (event: { id: string; x: number; y: number }) => void;
  onCampfireRemoved: (id: string) => void;
  applyMiningNodesState: (
    nodes: Array<{ nodeKey: string; respawnAt: number }>,
  ) => void;
  setMiningNodeDepleted: (nodeKey: string, depleted: boolean) => void;
}

/** Wire campfire / mining room events after world interactions exist. */
export function bindWorldNetwork(ctx: BindWorldNetworkContext): void {
  const { network } = ctx;
  network.onCampfiresState = (event) => {
    void ctx.applyCampfiresState(event.campfires);
  };
  network.onCampfirePlaced = (event) => {
    ctx.onCampfirePlaced(event);
  };
  network.onCampfireRemoved = (event) => {
    ctx.onCampfireRemoved(event.id);
  };
  network.requestCampfiresState();
  network.onMiningNodesState = (event) => {
    ctx.applyMiningNodesState(event.nodes);
  };
  network.onMiningNodeDepleted = (event) => {
    ctx.setMiningNodeDepleted(event.nodeKey, true);
  };
  network.onMiningNodeRespawned = (event) => {
    ctx.setMiningNodeDepleted(event.nodeKey, false);
  };
  const pendingMining = network.getMiningNodesState();
  if (pendingMining) ctx.applyMiningNodesState(pendingMining.nodes);
  network.requestMiningNodesState();
}
