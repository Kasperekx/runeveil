import type { Application } from "pixi.js";
import { NPC_CLICK_RADIUS, NPC_TALK_RANGE } from "../../config/constants";
import type { Camera } from "../../game/Camera";
import { screenToWorld } from "../../game/screenToWorld";
import type { Inventory } from "../../inventory/Inventory";
import type { ItemInstance } from "../../content/items";
import type { GameNetwork } from "../../network/GameNetwork";
import type {
  DialogueQuestAction,
  DialogueWindow,
  NpcDialogueView,
} from "../../ui/panels/DialogueWindow";
import type { MerchantWindow } from "../../ui/panels/MerchantWindow";
import type { InventoryPanel } from "../../ui/inventory/InventoryPanel";
import type { GameToast } from "../../ui/hud/GameToast";
import { getNpc } from "../../content/npcs";
import type { NpcSystem } from "./NpcSystem";

const TOO_FAR_MESSAGE = "Podejdź bliżej, by porozmawiać.";

/**
 * Click an NPC to select it and open gossip; trade/repair open Merchant + bag.
 */
export class NpcInteraction {
  private openNpcId: string | null = null;

  constructor(
    private readonly app: Application,
    private readonly camera: Camera,
    private readonly npcs: NpcSystem,
    private readonly dialogue: DialogueWindow,
    private readonly merchant: MerchantWindow,
    private readonly network: GameNetwork,
    private readonly inventory: Inventory,
    private readonly getInventoryPanel: () => InventoryPanel | null,
    private readonly getPlayerPosition: () => { x: number; y: number },
    private readonly toast: GameToast,
    private readonly getGold: () => number,
    private readonly getEquipment: () => Array<
      ItemInstance & { slotId: string }
    >,
    private readonly getLearnedProfessionIds: () => ReadonlySet<string>,
    private readonly getQuestActions: (
      npcId: string,
    ) => DialogueQuestAction[] = () => [],
    private readonly isOtherInteractiveAt: (
      x: number,
      y: number,
    ) => boolean = () => false,
  ) {}

  start(): void {
    this.merchant.bindTrade(this.inventory, {
      onBuy: (npcInstanceId, itemId) =>
        this.network.buyFromNpc(npcInstanceId, itemId, 1),
      onSell: (npcInstanceId, inventoryIndex) =>
        this.network.sellToNpc(npcInstanceId, inventoryIndex),
    });
    this.merchant.bindRepair({
      getEquipment: this.getEquipment,
      onRepair: (npcInstanceId, target) =>
        this.network.repairEquipment(npcInstanceId, target),
    });
    this.dialogue.bindServices({
      onTrade: (view) => this.openMerchant(view, "buy"),
      onRepair: (view) => this.openMerchant(view, "repair"),
      onLearnProfession: (view, professionId) => {
        this.network.learnProfession(view.npcInstanceId, professionId);
      },
    });
    this.app.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.app.canvas.addEventListener("pointermove", this.onPointerMove);
    this.app.ticker.add(this.update);
  }

  private openMerchant(
    view: NpcDialogueView,
    tab: "buy" | "sell" | "repair",
  ): void {
    this.dialogue.close();
    this.merchant.open({
      name: view.name,
      title: view.title,
      npcInstanceId: view.npcInstanceId,
      shop: view.shop,
      gold: this.getGold(),
      canRepair: Boolean(view.canRepair),
      initialTab: tab,
    });
    this.getInventoryPanel()?.openPanel();
  }

  private closeAll(): void {
    this.openNpcId = null;
    this.dialogue.close();
    this.merchant.close();
  }

  private onPointerMove = (event: PointerEvent): void => {
    const world = screenToWorld(
      this.app,
      this.camera,
      event.clientX,
      event.clientY,
    );
    const hit = this.npcs.findNearest(world.x, world.y, NPC_CLICK_RADIUS);
    this.app.canvas.style.cursor =
      hit || this.isOtherInteractiveAt(world.x, world.y) ? "pointer" : "";
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    if (
      event.target instanceof Element &&
      (event.target.closest("#inventory") ||
        event.target.closest("#loot-window") ||
        event.target.closest("#character-panel") ||
        event.target.closest("#dialogue-window") ||
        event.target.closest("#merchant-window"))
    ) {
      return;
    }

    const world = screenToWorld(
      this.app,
      this.camera,
      event.clientX,
      event.clientY,
    );
    const hit = this.npcs.findNearest(world.x, world.y, NPC_CLICK_RADIUS);

    if (!hit) {
      if (this.isOtherInteractiveAt(world.x, world.y)) return;
      this.npcs.setSelected(null);
      this.closeAll();
      return;
    }

    event.stopImmediatePropagation();
    this.npcs.setSelected(hit.id);

    if (!this.withinTalkRange(hit)) {
      this.closeAll();
      this.toast.show(TOO_FAR_MESSAGE);
      return;
    }

    this.openNpcId = hit.id;
    const def = getNpc(hit.npcId);
    const learned = this.getLearnedProfessionIds();
    const view: NpcDialogueView = {
      name: def.name,
      title: def.title,
      portrait: def.frames[0]!,
      greeting: def.greeting,
      dialogue: def.dialogue.filter(
        (option) =>
          option.action !== "learnProfession" ||
          !option.profession ||
          !learned.has(option.profession),
      ),
      npcInstanceId: hit.id,
      shop: def.shop,
      gold: this.getGold(),
      canRepair: def.repairService,
      questActions: this.getQuestActions(hit.npcId),
    };

    // Legacy: no gossip tree → open merchant straight away.
    if (def.dialogue.length === 0 && def.shop.length > 0) {
      this.openMerchant(view, "buy");
      return;
    }
    if (def.dialogue.length === 0 && def.repairService) {
      this.openMerchant(view, "repair");
      return;
    }

    this.merchant.close();
    this.dialogue.open(view);
  };

  private update = (): void => {
    if (!this.openNpcId) return;
    if (!this.dialogue.isOpen && !this.merchant.isOpen) {
      this.openNpcId = null;
      return;
    }

    const position = this.npcs.getPosition(this.openNpcId);
    if (!position || !this.withinTalkRange(position)) {
      this.closeAll();
    }
  };

  private withinTalkRange(hit: { x: number; y: number }): boolean {
    const { x, y } = this.getPlayerPosition();
    return Math.hypot(hit.x - x, hit.y - y) <= NPC_TALK_RANGE;
  }
}
