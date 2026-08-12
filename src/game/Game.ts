import { Container } from "pixi.js";
import { createApp } from "./createApp";
import { Camera } from "./Camera";
import { screenToWorld } from "./screenToWorld";
import type { GameAccess } from "../auth/types";
import { clearLastCharacter } from "../auth/lastCharacter";
import { NetworkAnimalSystem } from "../creatures/NetworkAnimalSystem";
import { Environment } from "../environment/Environment";
import { parseResourceKind } from "../config/resource";
import { KeyboardInput } from "../input/KeyboardInput";
import { Inventory } from "../inventory/Inventory";
import { getItem, hasItem, loadItemCatalog } from "../items/catalog";
import { getProfession, loadProfessionCatalog } from "../professions/catalog";
import {
  getQuest,
  listQuests,
  loadQuestCatalog,
  type QuestDefinition,
} from "../quests/catalog";
import { getSkill, loadSkillCatalog } from "../skills/catalog";
import { loadCreatureCatalog } from "../creatures/catalog";
import { SweepingStrikeFx } from "../fx/SweepingStrikeFx";
import { loadClassCatalog, getClass } from "../classes/catalog";
import { loadMap } from "../maps/loadMap";
import {
  GameNetwork,
  type NetworkPlayerSnapshot,
  type QuestSnapshot,
} from "../network/GameNetwork";
import { DialogueHotkeys } from "../npcs/DialogueHotkeys";
import { loadNpcCatalog } from "../npcs/catalog";
import { NpcInteraction } from "../npcs/NpcInteraction";
import { NpcSystem } from "../npcs/NpcSystem";
import { Player } from "../player/Player";
import { PlayerCombat } from "../player/PlayerCombat";
import { PlayerMovement } from "../player/PlayerMovement";
import { NetworkPlayerSystem } from "../player/NetworkPlayerSystem";
import { ActionBar } from "../ui/ActionBar";
import { ActionBarHotkeys } from "../ui/ActionBarHotkeys";
import { AttrPointsHint } from "../ui/AttrPointsHint";
import { CharacterHotkeys } from "../ui/CharacterHotkeys";
import { CharacterPanel } from "../ui/CharacterPanel";
import { DialogueWindow } from "../ui/DialogueWindow";
import { DeathScreen } from "../ui/DeathScreen";
import { FloatingCombatText } from "../ui/FloatingCombatText";
import { GameChat } from "../ui/GameChat";
import {
  formatChatSay,
  formatCombatDealt,
  formatCombatHeal,
  formatCombatTaken,
  formatLevelUp,
  formatLootDropped,
  formatSystem,
  formatXpGain,
  itemDisplayName,
} from "../ui/chat/chatLogFormat";
import { GameToast } from "../ui/GameToast";
import { ItemCooldowns } from "../ui/ItemCooldowns";
import { SkillCooldowns } from "../ui/SkillCooldowns";
import { SkillsHotkeys } from "../ui/SkillsHotkeys";
import { SkillsPanel } from "../ui/SkillsPanel";
import { InventoryHotkeys } from "../ui/inventory/InventoryHotkeys";
import { InventoryPanel } from "../ui/inventory/InventoryPanel";
import { LevelUpBanner } from "../ui/LevelUpBanner";
import { LoadingScreen } from "../ui/LoadingScreen";
import { LootWindow } from "../ui/LootWindow";
import { MICRO_ICONS, MicroMenu } from "../ui/MicroMenu";
import { PlayerHud } from "../ui/PlayerHud";
import { PlayerBuffs } from "../ui/PlayerBuffs";
import { Minimap } from "../ui/Minimap";
import { ProfessionsHotkeys } from "../ui/ProfessionsHotkeys";
import { ProfessionsPanel } from "../ui/ProfessionsPanel";
import { QuestLog } from "../ui/QuestLog";
import { QuestLogHotkeys } from "../ui/QuestLogHotkeys";
import { Settings } from "../ui/settings";
import { SettingsPanel } from "../ui/SettingsPanel";
import { SystemMenu } from "../ui/SystemMenu";
import { TargetFrame } from "../ui/TargetFrame";
import { NetworkPickupSystem } from "../world/NetworkPickupSystem";
import { CookingStationInteraction } from "../world/CookingStationInteraction";
import { BuildingEnterInteraction } from "../world/BuildingEnterInteraction";
import { MiningInteraction } from "../world/MiningInteraction";
import { LightSystem } from "../lighting/LightSystem";

const NOTICE_COPY: Record<string, string> = {
  inventory_full: "Plecak jest pełny.",
  not_enough_gold: "Za mało złota.",
  out_of_stock: "Towar wyprzedany.",
  shop_unavailable: "Ten kupiec nie prowadzi teraz handlu.",
  shop_item_unavailable:
    "Ten przedmiot nie jest dostępny u kupca. Odśwież grę.",
  cannot_sell: "Kupiec tego nie kupi.",
  too_far: "Podejdź bliżej, by handlować.",
  already_full_hp: "Jesteś już w pełni sił.",
  item_on_cooldown: "Przedmiot się jeszcze odnawia.",
  food_buff_expired: "Efekt posiłku dobiegł końca.",
  food_buff_cancelled: "Anulowano efekt posiłku.",
  equip_level_too_low: "Twój poziom jest za niski, by założyć ten przedmiot.",
  cooking_station_required: "Podejdź do paleniska lub kuźni, aby wytwarzać.",
  profession_level_too_low:
    "Twój poziom profesji jest za niski dla tej czynności.",
  missing_ingredients: "Brakuje składników do tego przepisu.",
  mining_pickaxe_required: "Potrzebujesz kilofa, aby wydobywać rudę.",
  mining_too_far: "Podejdź bliżej do żyły, aby kopać.",
  mining_node_depleted: "Ta żyła jest już wyczerpana.",
  mining_node_missing: "Nie znaleziono żyły rudy.",
  quest_giver_too_far: "Podejdź do zleceniodawcy, aby przyjąć to zadanie.",
  quest_prerequisite_missing: "Najpierw ukończ poprzednie zadanie.",
  quest_turn_in_too_far: "Podejdź do wskazanego miejsca, aby odebrać nagrodę.",
  no_target: "Nie masz wybranego celu.",
  out_of_range: "Cel jest poza zasięgiem.",
  respawn_too_soon: "Nie możesz jeszcze powrócić do schronienia.",
  repair_unavailable: "Ten NPC nie świadczy usług naprawy.",
  nothing_to_repair: "Twój ekwipunek nie wymaga naprawy.",
  not_enough_resource: "Za mało zasobu.",
  not_enough_rage: "Za mało wściekłości.",
  chat_rate_limited: "Piszesz zbyt szybko. Odczekaj chwilę.",
  chat_invalid: "Wiadomość jest pusta lub niedozwolona.",
};

const CRAFT_REJECTION_NOTICES = new Set([
  "cooking_station_required",
  "profession_level_too_low",
  "missing_ingredients",
  "inventory_full",
  "mining_pickaxe_required",
  "mining_too_far",
  "mining_node_depleted",
  "mining_node_missing",
]);

/** Composition root: wires systems without owning their logic. */
export class Game {
  async start(access: GameAccess): Promise<void> {
    const boot = LoadingScreen.create();
    boot.setStatus("Budzenie run…");

    await loadItemCatalog();
    await loadProfessionCatalog();
    await loadQuestCatalog();
    await loadSkillCatalog();
    await loadCreatureCatalog();
    await loadClassCatalog();
    await loadNpcCatalog();
    await SweepingStrikeFx.preload();
    boot.markProgress();
    boot.setStatus("Tkanka świata…");

    let map = await loadMap();
    const app = await createApp();
    const world = new Container();
    world.sortableChildren = true;

    boot.setStatus("Korzenie i trawy…");
    let environment = await Environment.create(app, world, map);
    const npcs = await NpcSystem.create(app, world, map);

    boot.setStatus("Przekraczanie zasłony…");

    const input = new KeyboardInput();
    const player = await Player.create(
      world,
      map.spawns.player,
      access.classId,
      access.characterName,
    );
    let lights = LightSystem.create(app, world, map);
    const bag = new Inventory();
    const network = new GameNetwork(player, bag, access.characterId);

    const camera = new Camera(app, world, () => player.position);
    camera.setMapSize(map.width, map.height);

    const settings = new Settings(document.getElementById("ui-root")!);
    const playerHud = PlayerHud.create();
    const playerBuffs = PlayerBuffs.create();
    playerBuffs.setCancelFoodHandler(() => network.cancelFoodBuff());
    const gameChat = GameChat.create(document.getElementById("ui-root")!, {
      onFocusChange: (focused) => {
        if (focused) input.clear();
      },
    });
    gameChat.bindSend((text) => network.sendChat(text));
    gameChat.append(
      "system",
      "Witaj w Runeveil. Enter — czat · zakładki filtrują dziennik.",
    );
    const logSystem = (text: string): void => {
      const line = formatSystem(text);
      gameChat.append(line.channel, line.text);
    };
    const characterPanel = CharacterPanel.create(bag, {
      onEquip: (inventoryIndex, slotId) =>
        network.equipItem(inventoryIndex, slotId),
      onUnequip: (slotId) => network.unequipItem(slotId),
      onAllocateAttribute: (attr) => network.allocateAttribute(attr),
    });
    const skillsPanel = SkillsPanel.create();
    const professionsPanel = ProfessionsPanel.create(
      bag,
      (recipeId, quantity) => network.craftRecipe(recipeId, quantity),
    );
    const questLog = QuestLog.create();
    questLog.bindActions({
      onAccept: (questId) => network.acceptQuest(questId),
      onClaim: (questId) => network.claimQuestReward(questId),
    });
    const attrPointsHint = AttrPointsHint.create(() =>
      characterPanel.openPanel(),
    );
    let microMenu: MicroMenu | null = null;
    let lastUnspentAttrPoints = 0;
    const syncUnspentAttrPoints = (points: number): void => {
      lastUnspentAttrPoints = points;
      attrPointsHint.setPoints(points);
      microMenu?.setBadge("character", points);
    };
    let playerGold = 0;
    let questStates: QuestSnapshot[] = [];
    const availableQuests = (): QuestDefinition[] => {
      const accepted = new Set(questStates.map((quest) => quest.questId));
      const completed = new Set(
        questStates
          .filter((quest) => quest.status === "completed")
          .map((quest) => quest.questId),
      );
      return listQuests().filter(
        (quest) =>
          !quest.autoStart &&
          !accepted.has(quest.id) &&
          (!quest.prerequisite || completed.has(quest.prerequisite)),
      );
    };
    const syncQuestMarkers = (): void => {
      const markerNpcs = new Set(
        listQuests()
          .flatMap((quest) => [quest.giverNpcId, quest.turnIn.target])
          .filter((id): id is string => Boolean(id)),
      );
      for (const npcId of markerNpcs) npcs.setQuestMarker(npcId, null);

      for (const state of questStates) {
        if (state.status !== "ready_to_claim") continue;
        const quest = getQuest(state.questId);
        if (quest.turnIn.kind === "npc") {
          npcs.setQuestMarker(quest.turnIn.target, "turn_in");
        }
      }
      for (const quest of availableQuests()) {
        if (quest.giverNpcId)
          npcs.setQuestMarker(quest.giverNpcId, "available");
      }
    };
    let inventoryPanel: InventoryPanel | null = null;
    const dialogueWindow = DialogueWindow.create();
    const toast = GameToast.create();
    let isPlayerDead = false;
    const nearestHomeName = (): string => {
      const { x, y } = player.position;
      const homes = map.homes ?? [];
      if (homes.length === 0) return "Najbliższe schronienie";
      return homes.reduce((closest, candidate) =>
        Math.hypot(candidate.x - x, candidate.y - y) <
        Math.hypot(closest.x - x, closest.y - y)
          ? candidate
          : closest,
      ).name;
    };
    const deathScreen = DeathScreen.create(() => network.respawn());
    const setDeathState = (dead: boolean): void => {
      isPlayerDead = dead;
      player.setDead(dead);
      if (dead) {
        combat?.clearTarget();
        professionsPanel.cancelCraft();
        if (!deathScreen.isOpen) {
          deathScreen.show({
            penaltyPercent: 5,
            homeName: nearestHomeName(),
          });
        }
        return;
      }
      deathScreen.hide();
    };
    const itemCooldowns = new ItemCooldowns();
    const skillCooldowns = new SkillCooldowns();
    let combat: PlayerCombat | null = null;
    let systemMenu: SystemMenu | null = null;
    let animalsRef: NetworkAnimalSystem | null = null;
    let playerResource = {
      kind: "none" as string,
      resource: 0,
      maxResource: 0,
    };
    const actionBar = ActionBar.create(
      bag,
      (inventoryIndex) => network.useItem(inventoryIndex),
      (skillId) => {
        if (isPlayerDead) return false;
        const skill = getSkill(skillId);
        const targetId = combat?.getTargetId() ?? null;
        const target =
          targetId && animalsRef ? animalsRef.getAlive(targetId) : null;

        if (skill.requiresTarget && !target) {
          toast.show(NOTICE_COPY.no_target);
          return false;
        }

        if (skill.requiresTarget && target) {
          const { x: px, y: py } = player.position;
          const dist = Math.hypot(target.x - px, target.y - py);
          if (dist > skill.range) {
            toast.show(NOTICE_COPY.out_of_range);
            return false;
          }
        }

        if (
          skill.resourceCost > 0 &&
          playerResource.resource < skill.resourceCost
        ) {
          toast.show(
            playerResource.kind === "rage"
              ? NOTICE_COPY.not_enough_rage
              : NOTICE_COPY.not_enough_resource,
          );
          return false;
        }

        if (target) player.faceToward(target.x, target.y);
        const { x, y } = player.position;
        player.beginAttack();
        SweepingStrikeFx.play(world, x, y, player.getFacing());
        network.castSkill(skillId, targetId);
        return true;
      },
      input,
      itemCooldowns,
      skillCooldowns,
      access.characterId,
    );

    let equippedItems: NetworkPlayerSnapshot["equipment"] = [];
    const comparisonForSlot = (slotId: string) => {
      const equipped = equippedItems.find(
        (entry) => entry.slotId === slotId && entry.itemId,
      );
      if (!equipped || !hasItem(equipped.itemId)) return null;
      return { item: getItem(equipped.itemId), instance: equipped };
    };

    const applySheet = (snap: NetworkPlayerSnapshot): void => {
      const cls = getClass(snap.classId);
      equippedItems = snap.equipment;
      playerGold = snap.gold ?? 0;
      inventoryPanel?.setGold(playerGold);
      playerHud.setName(snap.name);
      player.setName(snap.name);
      playerHud.setLevel(snap.level);
      playerHud.setPortrait(cls.portrait);
      playerHud.setVitals({ hp: snap.hp, maxHp: snap.maxHp });
      playerHud.setResource({
        kind: parseResourceKind(snap.resourceKind),
        resource: snap.resource,
        maxResource: snap.maxResource,
      });
      playerResource = {
        kind: snap.resourceKind,
        resource: snap.resource,
        maxResource: snap.maxResource,
      };
      actionBar.setResource(snap.resource);
      setDeathState(snap.hp <= 0);
      actionBar.setProgress({
        level: snap.level,
        experience: snap.experience,
        experienceToLevel: snap.experienceToLevel,
      });
      actionBar.setClassId(snap.classId);
      player.setMoveSpeed(snap.moveSpeed);
      const weapon = equippedWeaponDamageRange(snap.equipment);
      actionBar.setCombatStats({
        strength: snap.strength,
        weaponDamageMin: weapon.min,
        weaponDamageMax: weapon.max,
      });
      skillsPanel.setStats({
        classId: snap.classId,
        strength: snap.strength,
        weaponDamageMin: weapon.min,
        weaponDamageMax: weapon.max,
      });
      professionsPanel.setProfessions(snap.professions);
      questStates = snap.quests;
      questLog.setQuests(snap.quests);
      syncQuestMarkers();
      characterPanel.setSheet({
        name: snap.name,
        classId: snap.classId,
        level: snap.level,
        hp: snap.hp,
        maxHp: snap.maxHp,
        attackPower: snap.attackPower,
        damageMin: snap.damageMin,
        damageMax: snap.damageMax,
        moveSpeed: snap.moveSpeed,
        armor: snap.armor,
        strength: snap.strength,
        agility: snap.agility,
        stamina: snap.stamina,
        intellect: snap.intellect,
        spirit: snap.spirit,
        unspentAttrPoints: snap.unspentAttrPoints ?? 0,
        portrait: cls.portrait,
        equipment: snap.equipment,
      });
      dialogueWindow.refreshRepair();
      syncUnspentAttrPoints(snap.unspentAttrPoints ?? 0);
      if (dialogueWindow.isOpen) dialogueWindow.setGold(playerGold);
    };

    boot.setStatus("Wiązanie z realm…");
    const snapshot = await network.connect();
    if (snapshot) {
      // The database-backed server location wins on reconnect/refresh.
      if (snapshot.mapId !== map.id) {
        const restoredMap = await loadMap(snapshot.mapId);
        environment.dispose();
        lights.dispose();
        npcs.dispose();
        map = restoredMap;
        environment = await Environment.create(app, world, map);
        lights = LightSystem.create(app, world, map);
        await npcs.loadMap(world, map);
        camera.setMapSize(map.width, map.height);
      }
      network.hydrate(snapshot);
      applySheet(snapshot);
    }
    boot.setStatus("Synchronizacja dziczy…");

    camera.snap();
    camera.start();

    const animals = new NetworkAnimalSystem(app, world, network);
    animalsRef = animals;
    await animals.init();
    const minimap = Minimap.create(
      app,
      map,
      camera,
      () => player.position,
      animals,
    );
    const targetFrame = TargetFrame.create();
    animals.onSelectionChange = (vitals) => targetFrame.setTarget(vitals);
    network.onVitalsChange = (hp, maxHp) => {
      playerHud.setVitals({ hp, maxHp });
      setDeathState(hp <= 0);
    };
    network.onResourceChange = (state) => {
      playerResource = state;
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
      const message =
        event.kind === "not_enough_resource" && playerResource.kind === "rage"
          ? NOTICE_COPY.not_enough_rage
          : NOTICE_COPY[event.kind];
      if (message) {
        toast.show(message);
        logSystem(message);
      }
    };
    network.onTradeResult = (event) => {
      playerGold = event.gold;
      dialogueWindow.setGold(event.gold);
      inventoryPanel?.setGold(event.gold);
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
      playerGold = event.gold;
      dialogueWindow.setGold(event.gold);
      inventoryPanel?.setGold(event.gold);
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
        const line = formatCombatDealt(
          event.amount,
          creatureKind,
          event.killed,
        );
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
    const lootWindow = LootWindow.create(comparisonForSlot);
    lootWindow.bindHotkeys((handler) => {
      input.onKeyDownPress(handler);
    });
    const cookingStationInteraction = new CookingStationInteraction(
      app,
      camera,
      environment,
      professionsPanel,
      () => player.position,
      toast,
    );
    const miningInteraction = new MiningInteraction(
      app,
      camera,
      world,
      environment,
      input,
      bag,
      () => equippedItems,
      () => player.position,
      toast,
      (nodeKey, nodeId) => network.startMine(nodeKey, nodeId),
      (nodeKey, nodeId) => network.completeMine(nodeKey, nodeId),
      () => Boolean(systemMenu?.isOpen) || isPlayerDead,
    );
    network.onMiningNodesState = (event) => {
      miningInteraction.applyDepletedState(event.nodes);
    };
    network.onMiningNodeDepleted = (event) => {
      miningInteraction.setNodeDepleted(event.nodeKey, true);
    };
    network.onMiningNodeRespawned = (event) => {
      miningInteraction.setNodeDepleted(event.nodeKey, false);
    };
    // Apply any join-time snapshot that arrived before this UI existed, then
    // ask again so a raced early message cannot leave fresh veins on refresh.
    const pendingMining = network.getMiningNodesState();
    if (pendingMining) miningInteraction.applyDepletedState(pendingMining.nodes);
    network.requestMiningNodesState();
    let transitionMap: (mapId: string) => Promise<void> = async () => {
      throw new Error("Map transition is not ready yet.");
    };
    const buildingEnterInteraction = new BuildingEnterInteraction(
      app,
      camera,
      world,
      environment,
      input,
      () => player.position,
      toast,
      (mapId) => transitionMap(mapId),
      () => Boolean(systemMenu?.isOpen) || isPlayerDead,
    );
    const npcInteraction = new NpcInteraction(
      app,
      camera,
      npcs,
      dialogueWindow,
      network,
      bag,
      () => player.position,
      toast,
      () => playerGold,
      () => equippedItems,
      (npcId) => {
        const actions = [] as Array<{ label: string; onClick: () => void }>;
        for (const quest of availableQuests()) {
          if (quest.giverNpcId !== npcId) continue;
          actions.push({
            label: `Przyjmij zadanie: ${quest.name}`,
            onClick: () => network.acceptQuest(quest.id),
          });
        }
        for (const state of questStates) {
          if (state.status !== "ready_to_claim") continue;
          const quest = getQuest(state.questId);
          if (quest.turnIn.kind !== "npc" || quest.turnIn.target !== npcId)
            continue;
          actions.push({
            label: `Odbierz nagrodę: ${quest.name}`,
            onClick: () => network.claimQuestReward(quest.id),
          });
        }
        return actions;
      },
      (x, y) =>
        cookingStationInteraction.isAt(x, y) ||
        buildingEnterInteraction.isAt(x, y) ||
        miningInteraction.isAt(x, y),
    );
    const dialogueHotkeys = new DialogueHotkeys(dialogueWindow, input);
    const pickups = new NetworkPickupSystem(app, world, player, network);
    const remotePlayers = new NetworkPlayerSystem(app, world, network);
    await remotePlayers.init();

    const movement = new PlayerMovement(
      app,
      player,
      input,
      environment,
      map.playable,
      () => network.syncPosition(),
      () => Boolean(systemMenu?.isOpen) || isPlayerDead,
    );

    transitionMap = async (mapId: string): Promise<void> => {
      if (map.id === mapId) return;
      // Flush pose, validate the door and persist the destination on the server
      // before swapping any client visuals.
      const transition = await network.requestMapTransition(mapId);
      const next = await loadMap(transition.mapId);
      environment.dispose();
      lights.dispose();
      npcs.dispose();

      map = next;
      environment = await Environment.create(app, world, map);
      lights = LightSystem.create(app, world, map);
      await npcs.loadMap(world, map);
      syncQuestMarkers();

      movement.setWorldContext(environment, map.playable);
      cookingStationInteraction.setEnvironment(environment);
      buildingEnterInteraction.setEnvironment(environment);
      miningInteraction.setEnvironment(environment);
      camera.setMapSize(map.width, map.height);
      minimap.setMap(map);

      player.setPosition(transition.x, transition.y);
      camera.snap();
      toast.show(
        map.id === "hunters-tavern"
          ? "Witaj w Karczmie Łowców"
          : "Wracasz na tereny łowieckie",
      );
    };

    inventoryPanel = InventoryPanel.create(
      bag,
      (inventoryIndex, clientX, clientY) => {
        const { x, y } = screenToWorld(app, camera, clientX, clientY);
        pickups.dropItem(inventoryIndex, x, y);
      },
      {
        onEquip: (inventoryIndex, bagIndex) =>
          network.equipBag(inventoryIndex, bagIndex),
        onUnequip: (bagIndex, inventoryIndex) =>
          network.unequipBag(bagIndex, inventoryIndex),
        onEquipItem: (inventoryIndex, slotId) =>
          network.equipItem(inventoryIndex, slotId),
        onUnequipItem: (slotId, inventoryIndex) =>
          network.unequipItem(slotId, inventoryIndex),
        onMoveSlot: (fromIndex, toIndex) =>
          network.moveInventorySlot(fromIndex, toIndex),
        onUseItem: (inventoryIndex) => network.useItem(inventoryIndex),
      },
      input,
      itemCooldowns,
      comparisonForSlot,
    );
    inventoryPanel.setGold(playerGold);
    network.onBagsChange = (bags) => inventoryPanel!.setBags(bags);
    // Panel mounts after hydrate — push current bags (main backpack in slot 0).
    network.resyncBags();
    const inventoryHotkeys = new InventoryHotkeys(inventoryPanel, input);
    const characterHotkeys = new CharacterHotkeys(characterPanel, input);
    const skillsHotkeys = new SkillsHotkeys(skillsPanel, input);
    const professionsHotkeys = new ProfessionsHotkeys(professionsPanel, input);
    const questLogHotkeys = new QuestLogHotkeys(questLog, input);
    const actionBarHotkeys = new ActionBarHotkeys(actionBar, input);

    const exitToCharacterSelect = async (): Promise<void> => {
      try {
        await network.disconnect();
      } catch (error) {
        console.error("[game] character logout failed", error);
      }
      // Clear resume so the next boot opens the character hall intentionally.
      clearLastCharacter(access.account.id);
      // Reload tears down every Pixi/UI system. The HttpOnly account session is
      // intentionally preserved, so bootstrap lands in character hall.
      window.location.reload();
    };
    const settingsPanel = SettingsPanel.create(settings, {
      accountEmail: access.account.email,
      onCharacterSelect: exitToCharacterSelect,
    });
    systemMenu = SystemMenu.create({
      onSettings: () => settingsPanel.openPanel(),
      onCharacterSelect: exitToCharacterSelect,
    });

    // This handler is registered before panel/gameplay hotkeys. Returning true
    // consumes input while the modal menu is open.
    input.onKeyDownPress((code, event) => {
      if (gameChat.handleHotkey(code, event)) {
        input.clear();
        return true;
      }
      if (systemMenu?.isOpen) {
        event.preventDefault();
        if (code === "Escape") systemMenu.close();
        input.clear();
        return true;
      }
      if (code !== "Escape") return;

      if (settingsPanel.isOpen) {
        event.preventDefault();
        settingsPanel.close();
        return true;
      }

      const panelOpen =
        inventoryPanel?.isOpen ||
        characterPanel.isOpen ||
        skillsPanel.isOpen ||
        professionsPanel.isOpen ||
        questLog.isOpen ||
        dialogueWindow.isOpen ||
        lootWindow.isOpen;
      if (isPlayerDead) {
        event.preventDefault();
        return true;
      }
      if (panelOpen || combat?.getTargetId()) return;

      event.preventDefault();
      input.clear();
      systemMenu?.openMenu();
      return true;
    });

    microMenu = MicroMenu.create([
      {
        id: "character",
        label: "Szczegóły postaci",
        hotkey: "C",
        icon: MICRO_ICONS.character,
        onClick: () => characterPanel.toggle(),
      },
      {
        id: "inventory",
        label: "Ekwipunek",
        hotkey: "I",
        icon: MICRO_ICONS.bag,
        onClick: () => inventoryPanel.toggle(),
      },
      {
        id: "skills",
        label: "Umiejętności",
        hotkey: "P",
        icon: MICRO_ICONS.skills,
        onClick: () => skillsPanel.toggle(),
      },
      {
        id: "professions",
        label: "Profesje",
        hotkey: "L",
        icon: MICRO_ICONS.professions,
        onClick: () => professionsPanel.toggle(),
      },
      {
        id: "quests",
        label: "Dziennik zadań",
        hotkey: "Q",
        icon: MICRO_ICONS.quests,
        onClick: () => questLog.toggle(),
      },
      {
        id: "map",
        label: "Minimapa",
        icon: MICRO_ICONS.map,
        onClick: () => minimap.toggle(),
      },
      { id: "social", label: "Czat", hotkey: "Enter", icon: MICRO_ICONS.social, onClick: () => gameChat.focusInput() },
      {
        id: "settings",
        label: "Ustawienia",
        icon: MICRO_ICONS.settings,
        onClick: () => settingsPanel.toggle(),
      },
    ]);
    syncUnspentAttrPoints(lastUnspentAttrPoints);

    // Panels close by hotkey and Escape too, so poll rather than wrapping every
    // call site in a notification.
    app.ticker.add(() => {
      microMenu!.setActive("character", characterPanel.isOpen);
      microMenu!.setActive("inventory", inventoryPanel.isOpen);
      microMenu!.setActive("skills", skillsPanel.isOpen);
      microMenu!.setActive("professions", professionsPanel.isOpen);
      microMenu!.setActive("quests", questLog.isOpen);
      microMenu!.setActive("settings", settingsPanel.isOpen);
    });

    const combatInstance = new PlayerCombat(
      app,
      camera,
      player,
      animals,
      network,
      lootWindow,
      input,
      () =>
        inventoryPanel!.isOpen ||
        characterPanel.isOpen ||
        skillsPanel.isOpen ||
        professionsPanel.isOpen ||
        questLog.isOpen ||
        dialogueWindow.isOpen ||
        lootWindow.isOpen ||
        settingsPanel.isOpen ||
        Boolean(systemMenu?.isOpen) ||
        isPlayerDead,
      () => isPlayerDead,
    );
    combat = combatInstance;
    boot.setStatus("Gotowe");

    input.start();
    movement.start();
    inventoryHotkeys.start();
    characterHotkeys.start();
    skillsHotkeys.start();
    professionsHotkeys.start();
    questLogHotkeys.start();
    actionBarHotkeys.start();
    npcs.start();
    dialogueHotkeys.start();
    // Registered before combat's click handler so a hit on an NPC claims the
    // click (stopImmediatePropagation) instead of also selecting/attacking.
    npcInteraction.start();
    cookingStationInteraction.start();
    buildingEnterInteraction.start();
    miningInteraction.start();
    if (network.connected) {
      pickups.start();
      animals.start();
      remotePlayers.start();
      combatInstance.start();
    }

    window.addEventListener("beforeunload", () => network.dispose());
    await boot.dismiss();
  }
}

function equippedWeaponDamageRange(
  equipment: Array<{
    itemId: string;
    affixes: Array<{ stat: string; value: number }>;
    durability: number;
    maxDurability: number;
  }>,
): { min: number; max: number } {
  let min = 0;
  let max = 0;
  for (const slot of equipment) {
    if (!slot.itemId || !hasItem(slot.itemId)) continue;
    if (slot.maxDurability > 0 && slot.durability <= 0) continue;
    const item = getItem(slot.itemId);
    min +=
      item.damageMin +
      slot.affixes
        .filter((a) => a.stat === "damageMin")
        .reduce((sum, a) => sum + a.value, 0);
    max +=
      item.damageMax +
      slot.affixes
        .filter((a) => a.stat === "damageMax")
        .reduce((sum, a) => sum + a.value, 0);
  }
  return { min, max };
}
