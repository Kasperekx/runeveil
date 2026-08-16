import {
  BAG_SLOT_COUNT,
  DRAG_BAG_MIME,
  DRAG_EQUIP_MIME,
  DRAG_SLOT_MIME,
  INVENTORY_CLOSE_MS,
  MAIN_BAG_INDEX,
} from "../../config/constants";
import type { KeyboardInput } from "../../input/KeyboardInput";
import type { Inventory } from "../../inventory/Inventory";
import { getItem, hasItem, isUsableItem } from "../../content/items";
import type { ItemCooldowns } from "../hud/ItemCooldowns";
import { makeDraggable } from "../makeDraggable";
import { ItemTooltip, type ItemComparisonProvider } from "./ItemTooltip";

export type DropToWorldHandler = (
  inventoryIndex: number,
  clientX: number,
  clientY: number,
) => void | Promise<void>;

export interface BagHandlers {
  /** Drag a container from the grid onto a socket. */
  onEquip: (inventoryIndex: number, bagIndex: number) => void;
  /** Unequip into inventory (optional target slot). */
  onUnequip: (bagIndex: number, inventoryIndex?: number) => void;
  /** Double-click a wearable item — send it to its own equipment slot. */
  onEquipItem: (inventoryIndex: number, slotId: string) => void;
  /** Drag a worn item out of the paper doll (optional target bag slot). */
  onUnequipItem: (slotId: string, inventoryIndex?: number) => void;
  /** Persist a bag rearrange to the server. */
  onMoveSlot: (fromIndex: number, toIndex: number) => void;
  /** Use a consumable from the bag (double-click / right-click). */
  onUseItem: (inventoryIndex: number) => void;
}

/** DOM view for the bag panel. Renders Inventory data. */
export class InventoryPanel {
  private open = false;
  private closeTimer: number | null = null;
  private readonly slotElements: HTMLElement[] = [];
  private readonly bagElements: HTMLElement[] = [];
  private bags: string[] = [];
  private gold = 0;
  private readonly tooltip: ItemTooltip;
  private dragFromIndex: number | null = null;
  private dragFromBagIndex: number | null = null;
  /** Slot under the cursor — used to clear tooltip when that item disappears. */
  private hoverSlotIndex: number | null = null;
  private hoverBagIndex: number | null = null;
  private readonly onDropToWorld: DropToWorldHandler;
  private readonly bagHandlers: BagHandlers;
  private readonly input: KeyboardInput;
  private readonly cooldowns: ItemCooldowns;
  private readonly goldEl: HTMLElement;
  private readonly capacityEl: HTMLElement;
  private readonly capacityFillEl: HTMLElement;

  private constructor(
    private readonly root: HTMLElement,
    private readonly grid: HTMLElement,
    private readonly bagsEl: HTMLElement,
    private readonly inventory: Inventory,
    header: HTMLElement,
    closeButton: HTMLButtonElement,
    goldEl: HTMLElement,
    capacityEl: HTMLElement,
    capacityFillEl: HTMLElement,
    onDropToWorld: DropToWorldHandler,
    bagHandlers: BagHandlers,
    input: KeyboardInput,
    cooldowns: ItemCooldowns,
    private readonly comparisonProvider: ItemComparisonProvider | null,
  ) {
    this.onDropToWorld = onDropToWorld;
    this.bagHandlers = bagHandlers;
    this.input = input;
    this.cooldowns = cooldowns;
    this.goldEl = goldEl;
    this.capacityEl = capacityEl;
    this.capacityFillEl = capacityFillEl;
    this.tooltip = ItemTooltip.create();
    this.buildSlots();
    this.buildBagSockets();
    this.render();
    this.renderGold();
    this.inventory.onChange(() => this.render());
    this.cooldowns.onChange(() => this.renderCooldowns());
    closeButton.addEventListener("click", () => this.close());
    makeDraggable(this.root, header, () => this.input.clear());
    this.bindWorldDrop();
    this.bindDropTargetHint();
  }

  static create(
    inventory: Inventory,
    onDropToWorld: DropToWorldHandler,
    bagHandlers: BagHandlers,
    input: KeyboardInput,
    cooldowns: ItemCooldowns,
    comparisonProvider: ItemComparisonProvider | null = null,
  ): InventoryPanel {
    const root = document.getElementById("inventory");
    const grid = document.getElementById("inventory-grid");
    const bags = document.getElementById("inventory-bags");
    const header = document.getElementById("inventory-header");
    const closeButton = document.getElementById("inventory-close");
    const goldEl = document.getElementById("inventory-gold");
    const capacityEl = document.getElementById("inventory-capacity");
    const capacityFillEl = document.getElementById("inventory-capacity-fill");

    if (
      !root ||
      !grid ||
      !bags ||
      !header ||
      !goldEl ||
      !capacityEl ||
      !capacityFillEl ||
      !(closeButton instanceof HTMLButtonElement)
    ) {
      throw new Error(
        "Inventory markup missing (#inventory, #inventory-grid, #inventory-bags, #inventory-header, #inventory-close, #inventory-gold, #inventory-capacity, #inventory-capacity-fill)",
      );
    }

    return new InventoryPanel(
      root,
      grid,
      bags,
      inventory,
      header,
      closeButton,
      goldEl,
      capacityEl,
      capacityFillEl,
      onDropToWorld,
      bagHandlers,
      input,
      cooldowns,
      comparisonProvider,
    );
  }

  /** Server-authoritative bag loadout (itemId per socket, "" = empty). */
  setBags(bags: string[]): void {
    this.bags = [...bags];
    this.renderBags();
  }

  /** Wallet display under the bag sockets (not an inventory slot). */
  setGold(gold: number): void {
    this.gold = Math.max(0, Math.floor(gold));
    this.renderGold();
  }

  private renderGold(): void {
    this.goldEl.textContent = String(this.gold);
    const money = this.goldEl.parentElement;
    money?.setAttribute("aria-label", `Złoto: ${this.gold}`);
  }

  /** Free space is the one number players check before every pickup. */
  private renderCapacity(): void {
    const slots = this.inventory.getSlots();
    const total = slots.length;
    const used = slots.filter((slot) => slot.itemId).length;
    const free = total - used;

    this.capacityEl.textContent = `${used} / ${total}`;
    this.capacityFillEl.style.width = `${total > 0 ? (used / total) * 100 : 0}%`;
    this.capacityFillEl.dataset.tier =
      free === 0 ? "full" : free <= 3 ? "tight" : "roomy";
    this.capacityEl.parentElement?.setAttribute(
      "aria-label",
      free === 0
        ? "Plecak pełny"
        : `Zajęte ${used} z ${total} miejsc, wolne ${free}`,
    );
  }

  /**
   * Any drag — grid, bag socket or paper doll — marks the panel as a drop zone
   * so the free slots waiting for the item are obvious.
   */
  private bindDropTargetHint(): void {
    document.addEventListener("dragstart", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.closest("[data-slot-index], [data-bag-index], [data-slot]")) {
        return;
      }
      this.root.classList.add("is-receiving");
    });

    const clear = () => this.root.classList.remove("is-receiving");
    document.addEventListener("dragend", clear);
    document.addEventListener("drop", clear);
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.openPanel();
  }

  openPanel(): void {
    if (this.closeTimer !== null) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }

    this.open = true;
    this.root.hidden = false;
    this.root.setAttribute("aria-hidden", "false");
    void this.root.offsetWidth;
    this.root.classList.add("is-open");
  }

  close(): void {
    if (!this.open && !this.root.classList.contains("is-open")) return;

    this.open = false;
    this.tooltip.hide();
    this.root.classList.remove("is-open");
    this.root.setAttribute("aria-hidden", "true");

    if (this.closeTimer !== null) window.clearTimeout(this.closeTimer);

    this.closeTimer = window.setTimeout(() => {
      this.closeTimer = null;
      if (!this.open) this.root.hidden = true;
    }, INVENTORY_CLOSE_MS);
  }

  private buildSlots(): void {
    this.hoverSlotIndex = null;
    this.tooltip.hide();
    const fragment = document.createDocumentFragment();
    this.slotElements.length = 0;

    for (let i = 0; i < this.inventory.getSlots().length; i++) {
      const slot = document.createElement("div");
      slot.className = "inventory__slot";
      slot.setAttribute("role", "gridcell");
      slot.dataset.slotIndex = String(i);

      slot.addEventListener("pointerenter", (event) => {
        if (this.dragFromIndex !== null) return;
        this.hoverSlotIndex = i;
        this.showSlotTooltip(i, event.clientX, event.clientY);
      });
      slot.addEventListener("pointermove", (event) => {
        if (this.dragFromIndex !== null) return;
        this.tooltip.moveTo(event.clientX, event.clientY);
      });
      slot.addEventListener("pointerleave", () => {
        this.hoverSlotIndex = null;
        this.tooltip.hide();
      });

      slot.addEventListener("dblclick", () => this.onSlotDoubleClick(i));
      slot.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.onSlotContextMenu(i);
      });

      slot.addEventListener("dragstart", (event) =>
        this.onSlotDragStart(i, event),
      );
      slot.addEventListener("dragend", () => this.onSlotDragEnd());
      slot.addEventListener("dragover", (event) =>
        this.onSlotDragOver(i, event),
      );
      slot.addEventListener("dragleave", () => this.onSlotDragLeave(i));
      slot.addEventListener("drop", (event) => this.onSlotDrop(i, event));

      fragment.appendChild(slot);
      this.slotElements.push(slot);
    }

    this.grid.replaceChildren(fragment);
  }

  /**
   * Double-click: equip gear/bags, or drink/eat a consumable.
   */
  private onSlotDoubleClick(index: number): void {
    const slot = this.inventory.getSlot(index);
    if (!slot?.itemId || !hasItem(slot.itemId)) return;

    const item = getItem(slot.itemId);
    this.tooltip.hide();

    if (item.use) {
      if (this.cooldowns.remaining(slot.itemId) > 0) return;
      this.bagHandlers.onUseItem(index);
      return;
    }

    if (item.slot) {
      this.bagHandlers.onEquipItem(index, item.slot);
      return;
    }

    if (item.capacity > 0) {
      const free = this.firstFreeBagSocket();
      if (free !== null) this.bagHandlers.onEquip(index, free);
    }
  }

  /** Right-click uses a consumable (same as action-bar activate). */
  private onSlotContextMenu(index: number): void {
    const slot = this.inventory.getSlot(index);
    if (!slot?.itemId || !isUsableItem(slot.itemId)) return;
    if (this.cooldowns.remaining(slot.itemId) > 0) return;
    this.tooltip.hide();
    this.bagHandlers.onUseItem(index);
  }

  /** Main socket is permanent, so auto-equip only considers the rest. */
  private firstFreeBagSocket(): number | null {
    for (let i = 0; i < BAG_SLOT_COUNT; i++) {
      if (i === MAIN_BAG_INDEX) continue;
      if (!this.bags[i]) return i;
    }
    return null;
  }

  private buildBagSockets(): void {
    const fragment = document.createDocumentFragment();
    this.bagElements.length = 0;

    for (let i = 0; i < BAG_SLOT_COUNT; i++) {
      const socket = document.createElement("button");
      socket.type = "button";
      socket.className = "inventory__bag-socket";
      if (i === MAIN_BAG_INDEX) {
        socket.classList.add("inventory__bag-socket--main");
      }
      socket.dataset.bagIndex = String(i);

      socket.addEventListener("dragstart", (event) =>
        this.onBagDragStart(i, event),
      );
      socket.addEventListener("dragend", () => this.onBagDragEnd());

      socket.addEventListener("dragover", (event) => {
        if (i === MAIN_BAG_INDEX) return;
        const types = event.dataTransfer?.types ?? [];
        if (!types.includes(DRAG_SLOT_MIME)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer!.dropEffect = "move";
        socket.classList.add("inventory__bag-socket--drag-over");
      });
      socket.addEventListener("dragleave", () => {
        socket.classList.remove("inventory__bag-socket--drag-over");
      });
      socket.addEventListener("drop", (event) => this.onBagDrop(i, event));

      // Extra bags unequip on right-click; main socket stays put.
      socket.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        if (i === MAIN_BAG_INDEX) return;
        if (this.bags[i]) this.bagHandlers.onUnequip(i);
      });

      socket.addEventListener("pointerenter", (event) => {
        const itemId = this.bags[i];
        if (!itemId || !hasItem(itemId)) return;
        this.hoverBagIndex = i;
        this.tooltip.show(getItem(itemId), 1, event.clientX, event.clientY);
      });
      socket.addEventListener("pointermove", (event) => {
        this.tooltip.moveTo(event.clientX, event.clientY);
      });
      socket.addEventListener("pointerleave", () => {
        this.hoverBagIndex = null;
        this.tooltip.hide();
      });

      fragment.appendChild(socket);
      this.bagElements.push(socket);
    }

    this.bagsEl.replaceChildren(fragment);
    this.renderBags();
  }

  private onBagDragStart(bagIndex: number, event: DragEvent): void {
    if (bagIndex === MAIN_BAG_INDEX) {
      event.preventDefault();
      return;
    }
    const itemId = this.bags[bagIndex];
    if (!itemId || !event.dataTransfer) {
      event.preventDefault();
      return;
    }

    this.dragFromBagIndex = bagIndex;
    this.dragFromIndex = null;
    this.input.clear();
    this.tooltip.hide();
    this.bagElements[bagIndex]?.classList.add(
      "inventory__bag-socket--dragging",
    );

    event.dataTransfer.setData(DRAG_BAG_MIME, String(bagIndex));
    event.dataTransfer.setData("text/plain", String(bagIndex));
    event.dataTransfer.effectAllowed = "move";

    const item = getItem(itemId);
    const ghost = document.createElement("img");
    ghost.src = `/${item.icon}`;
    ghost.width = 36;
    ghost.height = 36;
    ghost.style.position = "absolute";
    ghost.style.top = "-1000px";
    ghost.style.imageRendering = "pixelated";
    document.body.appendChild(ghost);
    event.dataTransfer.setDragImage(ghost, 18, 18);
    requestAnimationFrame(() => ghost.remove());
  }

  private onBagDragEnd(): void {
    this.clearDragState();
  }

  private onBagDrop(bagIndex: number, event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.bagElements[bagIndex]?.classList.remove(
      "inventory__bag-socket--drag-over",
    );
    if (bagIndex === MAIN_BAG_INDEX) {
      this.clearDragState();
      return;
    }

    // Bag → bag not supported in one step; only inventory → socket.
    const fromIndex = readDragIndex(event, DRAG_SLOT_MIME, this.dragFromIndex);
    this.clearDragState();

    if (fromIndex === null) return;

    const slot = this.inventory.getSlot(fromIndex);
    if (!slot?.itemId) return;
    if (getItem(slot.itemId).capacity <= 0) return;

    this.bagHandlers.onEquip(fromIndex, bagIndex);
  }

  private renderBags(): void {
    this.bagElements.forEach((socket, index) => {
      const itemId = this.bags[index] ?? "";
      socket.replaceChildren();
      socket.classList.toggle("inventory__bag-socket--filled", Boolean(itemId));
      // Main socket is not draggable; extra bags are.
      socket.draggable = Boolean(itemId) && index !== MAIN_BAG_INDEX;

      if (!itemId || !hasItem(itemId)) {
        const label =
          index === MAIN_BAG_INDEX
            ? "Główny plecak"
            : `Puste gniazdo torby ${index + 1}`;
        socket.setAttribute("aria-label", label);
        const caption = document.createElement("span");
        caption.className = "inventory__bag-caption";
        caption.textContent = index === MAIN_BAG_INDEX ? "Główna" : "Torba";
        socket.appendChild(caption);
        return;
      }

      const item = getItem(itemId);
      const hint =
        index === MAIN_BAG_INDEX
          ? item.name
          : `${item.name} — przeciągnij do ekwipunku lub PPM aby zdjąć`;
      socket.setAttribute("aria-label", hint);

      const icon = document.createElement("img");
      icon.className = "inventory__bag-icon";
      icon.src = `/${item.icon}`;
      icon.alt = "";
      icon.draggable = false;
      socket.appendChild(icon);
    });
  }

  private bindWorldDrop(): void {
    window.addEventListener("dragover", (event) => {
      if (this.dragFromIndex === null && this.dragFromBagIndex === null) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    });

    window.addEventListener("drop", (event) => {
      if (this.dragFromIndex === null && this.dragFromBagIndex === null) return;
      event.preventDefault();

      const target = event.target;
      // Panel / hotbar drops handle themselves — don't throw the stack into the world.
      if (
        target instanceof Element &&
        target.closest(
          "#inventory, #action-bar, #character-panel, #micro-menu, #dialogue-window",
        )
      ) {
        return;
      }

      // Equipped bags only unequip into the inventory grid, not the world.
      if (this.dragFromBagIndex !== null) {
        this.clearDragState();
        return;
      }

      const fromIndex = this.dragFromIndex;
      this.clearDragState();
      if (fromIndex === null || !this.inventory.getSlot(fromIndex)?.itemId)
        return;

      void this.onDropToWorld(fromIndex, event.clientX, event.clientY);
    });
  }

  private onSlotDragStart(index: number, event: DragEvent): void {
    const slot = this.inventory.getSlot(index);
    if (!slot?.itemId || !event.dataTransfer) {
      event.preventDefault();
      return;
    }

    this.dragFromIndex = index;
    this.dragFromBagIndex = null;
    this.input.clear();
    this.tooltip.hide();
    this.slotElements[index]?.classList.add("inventory__slot--dragging");

    event.dataTransfer.setData(DRAG_SLOT_MIME, String(index));
    // text/plain: some browsers return "" for custom MIME on drop; ?? would
    // then coerce Number("") → 0 and move the wrong slot (or no-op).
    event.dataTransfer.setData("text/plain", String(index));
    event.dataTransfer.effectAllowed = "move";

    const item = getItem(slot.itemId);
    const ghost = document.createElement("img");
    ghost.src = `/${item.icon}`;
    ghost.width = 40;
    ghost.height = 40;
    ghost.style.position = "absolute";
    ghost.style.top = "-1000px";
    ghost.style.imageRendering = "pixelated";
    document.body.appendChild(ghost);
    event.dataTransfer.setDragImage(ghost, 20, 20);
    requestAnimationFrame(() => ghost.remove());
  }

  private onSlotDragEnd(): void {
    this.clearDragState();
  }

  private onSlotDragOver(index: number, event: DragEvent): void {
    const types = event.dataTransfer?.types ?? [];
    const fromBag =
      this.dragFromBagIndex !== null || types.includes(DRAG_BAG_MIME);
    const fromSlot =
      this.dragFromIndex !== null ||
      types.includes(DRAG_SLOT_MIME) ||
      types.includes("text/plain");
    const fromEquip = types.includes(DRAG_EQUIP_MIME);
    if (!fromBag && !fromSlot && !fromEquip) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    this.slotElements[index]?.classList.add("inventory__slot--drag-over");
  }

  private onSlotDragLeave(index: number): void {
    this.slotElements[index]?.classList.remove("inventory__slot--drag-over");
  }

  private onSlotDrop(index: number, event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();

    // Worn gear dragged off the paper doll lands in the slot it was dropped on.
    const equipSlotId = event.dataTransfer?.getData(DRAG_EQUIP_MIME);
    if (equipSlotId) {
      this.clearDragState();
      this.bagHandlers.onUnequipItem(equipSlotId, index);
      return;
    }

    const bagRaw = event.dataTransfer?.getData(DRAG_BAG_MIME);
    const fromBag =
      bagRaw != null && bagRaw !== "" ? Number(bagRaw) : this.dragFromBagIndex;
    if (
      fromBag !== null &&
      Number.isInteger(fromBag) &&
      fromBag >= 0 &&
      this.bags[fromBag]
    ) {
      this.clearDragState();
      if (fromBag === MAIN_BAG_INDEX) return;
      this.bagHandlers.onUnequip(fromBag, index);
      return;
    }

    const fromIndex = readDragIndex(event, DRAG_SLOT_MIME, this.dragFromIndex);
    this.clearDragState();

    if (fromIndex === null) return;
    if (!this.inventory.transferSlot(fromIndex, index)) return;
    this.bagHandlers.onMoveSlot(fromIndex, index);
  }

  private clearDragState(): void {
    this.dragFromIndex = null;
    this.dragFromBagIndex = null;
    this.input.clear();
    for (const el of this.slotElements) {
      el.classList.remove(
        "inventory__slot--dragging",
        "inventory__slot--drag-over",
      );
    }
    for (const el of this.bagElements) {
      el.classList.remove(
        "inventory__bag-socket--dragging",
        "inventory__bag-socket--drag-over",
      );
    }
  }

  private showSlotTooltip(
    index: number,
    clientX: number,
    clientY: number,
  ): void {
    const slot = this.inventory.getSlots()[index];
    if (!slot?.itemId) {
      this.tooltip.hide();
      return;
    }

    const item = getItem(slot.itemId);
    this.tooltip.show(
      item,
      slot.quantity,
      clientX,
      clientY,
      slot,
      item.slot ? this.comparisonProvider?.(item.slot) : null,
    );
  }

  private render(): void {
    const slots = this.inventory.getSlots();

    // Equipping/unequipping a bag resizes the inventory under us.
    if (slots.length !== this.slotElements.length) {
      this.buildSlots();
    }

    this.slotElements.forEach((element, index) => {
      const slot = slots[index];
      element.replaceChildren();
      element.removeAttribute("draggable");
      element.classList.remove(
        "inventory__slot--uncommon",
        "inventory__slot--rare",
        "inventory__slot--epic",
        "inventory__slot--worn",
        "inventory__slot--broken",
      );

      if (!slot?.itemId) {
        element.setAttribute("aria-label", `Pusty slot ${index + 1}`);
        element.classList.remove("inventory__slot--filled");
        return;
      }

      if (!hasItem(slot.itemId)) {
        element.setAttribute(
          "aria-label",
          `Nieznany przedmiot (${slot.itemId})`,
        );
        element.classList.remove("inventory__slot--filled");
        return;
      }

      const item = getItem(slot.itemId);
      element.classList.add("inventory__slot--filled");
      element.classList.toggle(
        "inventory__slot--uncommon",
        slot.rarity === "uncommon",
      );
      element.classList.toggle("inventory__slot--rare", slot.rarity === "rare");
      element.classList.toggle("inventory__slot--epic", slot.rarity === "epic");
      element.draggable = true;
      element.setAttribute(
        "aria-label",
        `${item.name}${slot.quantity > 1 ? ` x${slot.quantity}` : ""}`,
      );

      const icon = document.createElement("img");
      icon.className = "inventory__icon";
      icon.src = `/${item.icon}`;
      icon.alt = item.name;
      icon.draggable = false;
      element.appendChild(icon);

      if (slot.quantity > 1) {
        const qty = document.createElement("span");
        qty.className = "inventory__qty";
        qty.textContent = String(slot.quantity);
        element.appendChild(qty);
      }

      // Wear is visible on the paper doll, so the bag shows it too — a broken
      // piece looks the same in both places.
      if (slot.maxDurability > 0) {
        const ratio = Math.max(
          0,
          Math.min(1, slot.durability / slot.maxDurability),
        );
        element.classList.toggle("inventory__slot--broken", ratio <= 0);
        element.classList.toggle(
          "inventory__slot--worn",
          ratio > 0 && ratio <= 0.25,
        );
        const track = document.createElement("span");
        track.className = "inventory__durability";
        const fill = document.createElement("span");
        fill.style.width = `${ratio * 100}%`;
        track.appendChild(fill);
        element.appendChild(track);
      }

      const cooldown = document.createElement("span");
      cooldown.className = "inventory__cooldown";
      cooldown.setAttribute("aria-hidden", "true");
      element.appendChild(cooldown);
    });

    this.renderCapacity();
    this.renderCooldowns();

    // Item removed under the cursor (loot pickup / equip) skips pointerleave.
    if (this.hoverSlotIndex !== null) {
      const hovered = slots[this.hoverSlotIndex];
      if (!hovered?.itemId) {
        this.hoverSlotIndex = null;
        this.tooltip.hide();
      }
    }
    if (this.hoverBagIndex !== null) {
      const bagId = this.bags[this.hoverBagIndex];
      if (!bagId) {
        this.hoverBagIndex = null;
        this.tooltip.hide();
      }
    }
  }

  private renderCooldowns(): void {
    const slots = this.inventory.getSlots();
    this.slotElements.forEach((element, index) => {
      const overlay = element.querySelector<HTMLElement>(
        ".inventory__cooldown",
      );
      if (!overlay) return;

      const itemId = slots[index]?.itemId;
      if (!itemId || !hasItem(itemId)) {
        overlay.style.height = "0%";
        return;
      }

      const item = getItem(itemId);
      const total = item.use?.cooldownMs ?? 0;
      const remaining = this.cooldowns.remaining(itemId);
      overlay.style.height =
        total > 0 && remaining > 0
          ? `${Math.min(100, (remaining / total) * 100)}%`
          : "0%";
    });
  }
}

/**
 * Custom MIME getData often returns "" (not null). Using ?? then Number("") → 0
 * silently moves slot 0 instead of the dragged item.
 * Prefer mime → in-memory fallback → text/plain.
 */
function readDragIndex(
  event: DragEvent,
  mime: string,
  fallback: number | null,
): number | null {
  const raw = event.dataTransfer?.getData(mime);
  if (raw != null && raw !== "") {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0) return n;
  }
  if (fallback !== null && Number.isInteger(fallback) && fallback >= 0) {
    return fallback;
  }
  const plain = event.dataTransfer?.getData("text/plain");
  if (plain != null && plain !== "") {
    const n = Number(plain);
    if (Number.isInteger(n) && n >= 0) return n;
  }
  return null;
}
