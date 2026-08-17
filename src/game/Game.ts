import { Container } from "pixi.js";
import { createApp } from "./createApp";
import { Camera } from "./Camera";
import { screenToWorld } from "./screenToWorld";
import { bindGameHud } from "./bindHud";
import { bindGameNetwork, bindWorldNetwork } from "./bindNetwork";
import { loadGameContent } from "./loadContent";
import { NOTICE_COPY } from "./notices";
import type { GameAccess } from "../auth/types";
import { clearLastCharacter } from "../auth/lastCharacter";
import { NetworkAnimalSystem } from "../entities/creatures/NetworkAnimalSystem";
import { Environment } from "../render/Environment";
import { parseResourceKind } from "../config/resource";
import { KeyboardInput } from "../input/KeyboardInput";
import { Inventory } from "../inventory/Inventory";
import { getItem, hasItem } from "../content/items";
import { getQuest, listQuests, type QuestDefinition } from "../content/quests";
import { getSkill } from "../content/skills";
import { SweepingStrikeFx } from "../render/SweepingStrikeFx";
import { getClass } from "../content/classes";
import { loadMap } from "../maps/loadMap";
import {
  GameNetwork,
  type NetworkPlayerSnapshot,
  type QuestSnapshot,
} from "../network/GameNetwork";
import { DialogueHotkeys } from "../ui/panels/DialogueHotkeys";
import { NpcInteraction } from "../entities/npcs/NpcInteraction";
import { NpcSystem } from "../entities/npcs/NpcSystem";
import { Player } from "../entities/player/Player";
import { PlayerCombat } from "../entities/player/PlayerCombat";
import { PlayerMovement } from "../entities/player/PlayerMovement";
import { NetworkPlayerSystem } from "../entities/player/NetworkPlayerSystem";
import { ActionBar } from "../ui/hud/actionBar/ActionBar";
import { AttrPointsHint } from "../ui/hud/AttrPointsHint";
import { CharacterPanel } from "../ui/panels/CharacterPanel";
import { DialogueWindow } from "../ui/panels/DialogueWindow";
import { MerchantWindow } from "../ui/panels/MerchantWindow";
import { DeathScreen } from "../ui/screens/DeathScreen";
import { GameChat } from "../ui/chat/GameChat";
import { formatSystem } from "../ui/chat/chatLogFormat";
import { GameToast } from "../ui/hud/GameToast";
import { ItemCooldowns } from "../ui/hud/ItemCooldowns";
import { SkillCooldowns } from "../ui/hud/SkillCooldowns";
import { SkillsPanel } from "../ui/panels/SkillsPanel";
import { InventoryPanel } from "../ui/inventory/InventoryPanel";
import { LoadingScreen } from "../ui/screens/LoadingScreen";
import { LootWindow } from "../ui/panels/LootWindow";
import type { MicroMenu } from "../ui/panels/MicroMenu";
import { PlayerHud } from "../ui/hud/PlayerHud";
import { PlayerBuffs } from "../ui/hud/PlayerBuffs";
import { Minimap } from "../ui/hud/Minimap";
import { ProfessionsPanel } from "../ui/panels/ProfessionsPanel";
import { QuestLog } from "../ui/panels/QuestLog";
import { Settings } from "../ui/panels/settings";
import type { SystemMenu } from "../ui/panels/SystemMenu";
import { TargetFrame } from "../ui/hud/TargetFrame";
import { NetworkPickupSystem } from "../world/NetworkPickupSystem";
import { CookingStationInteraction } from "../world/CookingStationInteraction";
import { CampfirePlacementMode } from "../world/CampfirePlacementMode";
import { PLACEABLE_CAMPFIRE } from "../world/placeableCampfire";
import { BuildingEnterInteraction } from "../world/BuildingEnterInteraction";
import { MiningInteraction } from "../world/MiningInteraction";
import { LightSystem } from "../render/LightSystem";

/** Composition root: wires systems without owning their logic. */
export class Game {
  async start(access: GameAccess): Promise<void> {
    const boot = LoadingScreen.create();
    boot.setStatus("Budzenie run…");

    await loadGameContent();
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
    let campfirePlacement: CampfirePlacementMode | null = null;
    professionsPanel.setPlaceCampfireHandler(() => {
      void campfirePlacement?.start();
    });
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
    const merchantWindow = MerchantWindow.create();
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
        experience: snap.experience,
        experienceToLevel: snap.experienceToLevel,
        hp: snap.hp,
        maxHp: snap.maxHp,
        resourceKind: snap.resourceKind,
        resource: snap.resource,
        maxResource: snap.maxResource,
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
        bonusAttributes: {
          strength: snap.bonusStrength ?? 0,
          agility: snap.bonusAgility ?? 0,
          stamina: snap.bonusStamina ?? 0,
          intellect: snap.bonusIntellect ?? 0,
          spirit: snap.bonusSpirit ?? 0,
        },
        unspentAttrPoints: snap.unspentAttrPoints ?? 0,
        portrait: cls.portrait,
        equipment: snap.equipment,
      });
      merchantWindow.refreshRepair();
      syncUnspentAttrPoints(snap.unspentAttrPoints ?? 0);
      if (merchantWindow.isOpen) merchantWindow.setGold(playerGold);
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
    bindGameNetwork({
      network,
      app,
      world,
      player,
      animals,
      settings,
      playerHud,
      playerBuffs,
      actionBar,
      gameChat,
      toast,
      itemCooldowns,
      professionsPanel,
      merchantWindow,
      deathScreen,
      applySheet,
      setDeathState,
      logSystem,
      getPlayerResource: () => playerResource,
      setPlayerResource: (state) => {
        playerResource = state;
      },
      setPlayerGold: (gold) => {
        playerGold = gold;
      },
      getInventoryPanel: () => inventoryPanel,
    });
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
    campfirePlacement = new CampfirePlacementMode(
      app,
      camera,
      world,
      environment,
      () => player.position,
      toast,
      (x, y) => network.placeCampfire(x, y),
      () =>
        Boolean(systemMenu?.isOpen) ||
        isPlayerDead ||
        dialogueWindow.isOpen ||
        merchantWindow.isOpen ||
        lootWindow.isOpen,
    );
    const upsertCampfireLight = (id: string, x: number, y: number): void => {
      const light = PLACEABLE_CAMPFIRE.prop.light;
      if (!light) return;
      lights.upsertLight(id, x, y, light);
    };
    const applyCampfiresState = async (
      campfires: Array<{
        id: string;
        x: number;
        y: number;
      }>,
    ): Promise<void> => {
      environment.clearRuntimeCampfires();
      lights.clearDynamicLights();
      for (const campfire of campfires) {
        await environment.upsertRuntimeCampfire(
          campfire.id,
          campfire.x,
          campfire.y,
        );
        upsertCampfireLight(campfire.id, campfire.x, campfire.y);
      }
      cookingStationInteraction.setEnvironment(environment);
    };
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
    bindWorldNetwork({
      network,
      applyCampfiresState,
      onCampfirePlaced: (event) => {
        void environment
          .upsertRuntimeCampfire(event.id, event.x, event.y)
          .then(() => {
            upsertCampfireLight(event.id, event.x, event.y);
            cookingStationInteraction.setEnvironment(environment);
          });
      },
      onCampfireRemoved: (id) => {
        environment.removeRuntimeCampfire(id);
        lights.removeLight(id);
        cookingStationInteraction.setEnvironment(environment);
      },
      applyMiningNodesState: (nodes) => {
        miningInteraction.applyDepletedState(nodes);
      },
      setMiningNodeDepleted: (nodeKey, depleted) => {
        miningInteraction.setNodeDepleted(nodeKey, depleted);
      },
    });
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
      merchantWindow,
      network,
      bag,
      () => inventoryPanel,
      () => player.position,
      toast,
      () => playerGold,
      () => equippedItems,
      () => professionsPanel.learnedProfessionIds(),
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
    const dialogueHotkeys = new DialogueHotkeys(
      dialogueWindow,
      merchantWindow,
      input,
    );
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
      campfirePlacement?.cancel();
      campfirePlacement?.setEnvironment(environment);
      camera.setMapSize(map.width, map.height);
      minimap.setMap(map);

      player.setPosition(transition.x, transition.y);
      camera.snap();
      network.requestCampfiresState();
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
    const hud = bindGameHud({
      app,
      input,
      inventoryPanel,
      characterPanel,
      skillsPanel,
      professionsPanel,
      questLog,
      actionBar,
      gameChat,
      dialogueWindow,
      merchantWindow,
      lootWindow,
      settings,
      minimap,
      accountEmail: access.account.email,
      onCharacterSelect: exitToCharacterSelect,
      getCombatTargetId: () => combat?.getTargetId() ?? null,
      getIsPlayerDead: () => isPlayerDead,
    });
    systemMenu = hud.systemMenu;
    microMenu = hud.microMenu;
    syncUnspentAttrPoints(lastUnspentAttrPoints);

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
        merchantWindow.isOpen ||
        lootWindow.isOpen ||
        hud.settingsPanel.isOpen ||
        Boolean(systemMenu?.isOpen) ||
        isPlayerDead,
      () => isPlayerDead,
    );
    combat = combatInstance;
    boot.setStatus("Gotowe");

    input.start();
    movement.start();
    hud.startHotkeys();
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
