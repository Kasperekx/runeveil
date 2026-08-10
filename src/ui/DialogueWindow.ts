import { CHARACTER_PANEL_CLOSE_MS } from "../config/constants";
import type { Inventory } from "../inventory/Inventory";
import {
  getItem,
  hasItem,
  repairCost,
  type ItemInstance,
} from "../items/catalog";
import type { NpcDialogueOption, NpcShopOffer } from "../npcs/catalog";
import { makeDraggable, clearDragPosition } from "./makeDraggable";

export type DialogueTab = "buy" | "sell";

type DialogueMode = "root" | "story" | "trade" | "repair";

export interface NpcDialogueView {
  name: string;
  title: string;
  /** Public-relative sprite path (no leading slash), as stored in the catalog. */
  portrait: string;
  greeting: string;
  dialogue: NpcDialogueOption[];
  /** Map instance id — required for trade requests. */
  npcInstanceId: string;
  shop: NpcShopOffer[];
  gold: number;
  questActions?: DialogueQuestAction[];
}

export interface DialogueQuestAction {
  label: string;
  onClick: () => void;
}

export interface DialogueTradeHandlers {
  onBuy: (npcInstanceId: string, itemId: string) => void;
  onSell: (npcInstanceId: string, inventoryIndex: number) => void;
}

export interface DialogueRepairHandlers {
  getEquipment: () => Array<ItemInstance & { slotId: string }>;
  onRepair: (npcInstanceId: string, slotId?: string) => void;
}

/**
 * NPC dialogue + vendor panel.
 * Starts on choice buttons when `dialogue` is set; trade is an explicit option.
 */
export class DialogueWindow {
  private opened = false;
  private closeTimer: number | null = null;
  private view: NpcDialogueView | null = null;
  private mode: DialogueMode = "root";
  private tab: DialogueTab = "buy";
  /** Runtime stock overrides from the server (itemId → remaining). */
  private stockOverrides = new Map<string, number>();
  private tradeHandlers: DialogueTradeHandlers | null = null;
  private repairHandlers: DialogueRepairHandlers | null = null;
  private inventory: Inventory | null = null;
  private unbindInventory: (() => void) | null = null;
  private readonly titleEl: HTMLElement;
  private readonly optionsEl: HTMLElement;

  private constructor(
    private readonly root: HTMLElement,
    private readonly portraitEl: HTMLImageElement,
    private readonly nameEl: HTMLElement,
    private readonly roleEl: HTMLElement,
    private readonly greetingEl: HTMLElement,
    private readonly goldEl: HTMLElement,
    private readonly tabsEl: HTMLElement,
    private readonly listEl: HTMLElement,
    private readonly shopSection: HTMLElement,
    titleEl: HTMLElement,
    optionsEl: HTMLElement,
  ) {
    this.titleEl = titleEl;
    this.optionsEl = optionsEl;
  }

  static create(
    host: HTMLElement = document.getElementById("ui-root")!,
  ): DialogueWindow {
    const root = document.createElement("aside");
    root.id = "dialogue-window";
    root.className = "dialogue-window";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Rozmowa");
    root.innerHTML = `
      <div class="dialogue-window__frame">
        <div class="dialogue-window__ornament dialogue-window__ornament--tl" aria-hidden="true"></div>
        <div class="dialogue-window__ornament dialogue-window__ornament--tr" aria-hidden="true"></div>
        <div class="dialogue-window__ornament dialogue-window__ornament--bl" aria-hidden="true"></div>
        <div class="dialogue-window__ornament dialogue-window__ornament--br" aria-hidden="true"></div>
        <header class="dialogue-window__header" data-header>
          <span class="dialogue-window__sigil" aria-hidden="true">⚔</span>
          <h2 class="dialogue-window__title" data-title>Rozmowa</h2>
          <div class="dialogue-window__gold" data-gold title="Złoto">0</div>
          <button type="button" class="dialogue-window__close" data-close aria-label="Zamknij">×</button>
        </header>
        <div class="dialogue-window__body">
          <div class="dialogue-window__identity">
            <div class="dialogue-window__portrait-wrap">
              <img class="dialogue-window__portrait" data-portrait src="" alt="" draggable="false" />
            </div>
            <div class="dialogue-window__identity-text">
              <div class="dialogue-window__name" data-name></div>
              <div class="dialogue-window__role" data-role></div>
            </div>
          </div>
          <p class="dialogue-window__greeting" data-greeting></p>
          <div class="dialogue-window__options" data-options role="list"></div>
          <div class="dialogue-window__shop" data-shop hidden>
            <div class="dialogue-window__tabs" data-tabs role="tablist">
              <button type="button" class="dialogue-window__tab is-active" data-tab="buy" role="tab">Kup</button>
              <button type="button" class="dialogue-window__tab" data-tab="sell" role="tab">Sprzedaj</button>
            </div>
            <div class="dialogue-window__list" data-list role="list"></div>
          </div>
        </div>
      </div>
    `;
    host.appendChild(root);

    const win = new DialogueWindow(
      root,
      root.querySelector("[data-portrait]")!,
      root.querySelector("[data-name]")!,
      root.querySelector("[data-role]")!,
      root.querySelector("[data-greeting]")!,
      root.querySelector("[data-gold]")!,
      root.querySelector("[data-tabs]")!,
      root.querySelector("[data-list]")!,
      root.querySelector("[data-shop]")!,
      root.querySelector("[data-title]")!,
      root.querySelector("[data-options]")!,
    );

    root.querySelector("[data-close]")!.addEventListener("click", () => {
      win.close();
    });
    win.tabsEl.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const tab = target.dataset.tab;
      if (tab === "buy" || tab === "sell") win.setTab(tab);
    });
    makeDraggable(root, root.querySelector("[data-header]") as HTMLElement);

    return win;
  }

  bindTrade(inventory: Inventory, handlers: DialogueTradeHandlers): void {
    this.inventory = inventory;
    this.tradeHandlers = handlers;
    this.unbindInventory?.();
    const onChange = () => {
      if (this.opened && this.mode === "trade" && this.tab === "sell") {
        this.renderList();
      }
    };
    inventory.onChange(onChange);
    this.unbindInventory = () => {
      /* Inventory has no off(); listeners are session-long — fine for boot wire. */
    };
  }

  bindRepair(handlers: DialogueRepairHandlers): void {
    this.repairHandlers = handlers;
  }

  get isOpen(): boolean {
    return this.opened;
  }

  refreshRepair(): void {
    if (this.opened && this.mode === "repair") this.renderRepairList();
  }

  open(view: NpcDialogueView): void {
    if (this.closeTimer !== null) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }

    this.view = view;
    this.stockOverrides.clear();
    for (const offer of view.shop) {
      if (offer.stock >= 0) this.stockOverrides.set(offer.itemId, offer.stock);
    }
    this.tab = "buy";

    this.portraitEl.src = `/${view.portrait}`;
    this.nameEl.textContent = view.name;
    this.roleEl.textContent = view.title;
    this.setGold(view.gold);

    const hasDialogue = view.dialogue.length > 0;
    const hasShop = view.shop.length > 0;
    // Legacy: no dialogue tree → open straight into trade when a shop exists.
    this.mode = hasDialogue ? "root" : hasShop ? "trade" : "root";

    this.syncMode();

    this.opened = true;
    this.root.hidden = false;
    clearDragPosition(this.root);
    void this.root.offsetWidth;
    this.root.classList.add("is-open");
  }

  setGold(gold: number): void {
    if (this.view) this.view.gold = gold;
    this.goldEl.textContent = String(Math.max(0, Math.floor(gold)));
    if (
      this.opened &&
      (this.mode === "repair" || (this.mode === "trade" && this.tab === "buy"))
    ) {
      this.renderList();
    }
  }

  /** Apply authoritative stock after a successful buy. */
  setStock(itemId: string, stock: number): void {
    if (stock < 0) this.stockOverrides.delete(itemId);
    else this.stockOverrides.set(itemId, stock);
    if (this.opened && this.mode === "trade" && this.tab === "buy") {
      this.renderList();
    }
  }

  close(): void {
    if (!this.opened) return;

    this.opened = false;
    this.view = null;
    this.mode = "root";
    this.root.classList.remove("is-open");

    if (this.closeTimer !== null) window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => {
      this.closeTimer = null;
      if (!this.opened) this.root.hidden = true;
    }, CHARACTER_PANEL_CLOSE_MS);
  }

  private syncMode(): void {
    if (!this.view) return;

    if (this.mode === "trade") {
      this.titleEl.textContent = "Handel";
      this.tabsEl.hidden = false;
      this.greetingEl.textContent = this.view.greeting;
      this.goldEl.hidden = false;
      this.optionsEl.hidden = true;
      this.optionsEl.replaceChildren();
      this.shopSection.hidden = this.view.shop.length === 0;
      if (!this.shopSection.hidden) {
        this.syncTabs();
        this.renderList();
      } else {
        this.listEl.replaceChildren();
      }
      // From dialogue, allow returning to the root menu.
      if (this.view.dialogue.length > 0) {
        this.optionsEl.hidden = false;
        this.renderBackOption();
      }
      return;
    }

    if (this.mode === "repair") {
      this.titleEl.textContent = "Naprawa ekwipunku";
      this.greetingEl.textContent =
        "Sprawdzę pęknięcia, nitowania i ostrze. Wybierz przedmiot albo napraw wszystko.";
      this.goldEl.hidden = false;
      this.optionsEl.hidden = false;
      this.renderBackOption();
      this.shopSection.hidden = false;
      this.tabsEl.hidden = true;
      this.renderRepairList();
      return;
    }

    this.titleEl.textContent = "Rozmowa";
    this.goldEl.hidden = true;
    this.shopSection.hidden = true;
    this.listEl.replaceChildren();
    this.optionsEl.hidden = false;

    if (this.mode === "story") {
      this.renderBackOption();
      return;
    }

    this.greetingEl.textContent = this.view.greeting;
    this.renderRootOptions();
  }

  private renderRootOptions(): void {
    this.optionsEl.replaceChildren();
    if (!this.view) return;

    for (const action of this.view.questActions ?? []) {
      const button = this.buildOptionButton(action.label, () => {
        action.onClick();
        this.close();
      });
      button.classList.add("dialogue-window__option--quest");
      this.optionsEl.appendChild(button);
    }

    for (const option of this.view.dialogue) {
      this.optionsEl.appendChild(
        this.buildOptionButton(option.label, () => {
          this.chooseOption(option);
        }),
      );
    }
  }

  private renderBackOption(): void {
    this.optionsEl.replaceChildren();
    if (this.mode === "trade" || this.mode === "repair") {
      this.optionsEl.appendChild(
        this.buildOptionButton("Wróć do rozmowy", () => {
          this.mode = "root";
          this.syncMode();
        }),
      );
      return;
    }

    this.optionsEl.appendChild(
      this.buildOptionButton("Wróć", () => {
        this.mode = "root";
        this.syncMode();
      }),
    );
  }

  private chooseOption(option: NpcDialogueOption): void {
    if (option.action === "close") {
      this.close();
      return;
    }

    if (option.text) {
      this.greetingEl.textContent = option.text;
      this.mode = "story";
      this.syncMode();
      // Text-only options stop here; trade+text would be unusual — prefer text first.
      if (!option.action) return;
    }

    if (option.action === "trade") {
      this.mode = "trade";
      this.tab = "buy";
      this.syncMode();
    }
    if (option.action === "repair") {
      this.mode = "repair";
      this.syncMode();
    }
  }

  private buildOptionButton(
    label: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dialogue-window__option";
    button.setAttribute("role", "listitem");
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  private setTab(tab: DialogueTab): void {
    if (this.tab === tab) return;
    this.tab = tab;
    this.syncTabs();
    this.renderList();
  }

  private syncTabs(): void {
    for (const button of this.tabsEl.querySelectorAll("[data-tab]")) {
      if (!(button instanceof HTMLElement)) continue;
      button.classList.toggle("is-active", button.dataset.tab === this.tab);
    }
  }

  private renderList(): void {
    this.listEl.replaceChildren();
    if (!this.view) return;

    if (this.tab === "buy") {
      this.renderBuyList();
      return;
    }
    this.renderSellList();
  }

  private renderRepairList(): void {
    this.listEl.replaceChildren();
    const view = this.view;
    const handlers = this.repairHandlers;
    if (!view || !handlers) {
      this.listEl.appendChild(
        this.emptyNote("Usługa naprawy jest niedostępna."),
      );
      return;
    }
    const damaged = handlers
      .getEquipment()
      .filter(
        (slot) =>
          slot.itemId &&
          slot.maxDurability > 0 &&
          slot.durability < slot.maxDurability &&
          hasItem(slot.itemId),
      );
    if (damaged.length === 0) {
      this.listEl.appendChild(
        this.emptyNote("Twój wyposażony sprzęt jest w doskonałym stanie."),
      );
      return;
    }
    const totalCost = damaged.reduce(
      (total, slot) => total + repairCost(getItem(slot.itemId), slot),
      0,
    );
    const all = document.createElement("button");
    all.type = "button";
    all.className = "dialogue-window__repair-all";
    all.textContent = `Napraw wszystko · ${totalCost} g`;
    all.disabled = view.gold < totalCost;
    all.addEventListener("click", () => handlers.onRepair(view.npcInstanceId));
    this.listEl.appendChild(all);
    for (const slot of damaged) {
      const item = getItem(slot.itemId);
      const missing = slot.maxDurability - slot.durability;
      const cost = repairCost(item, slot);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "dialogue-window__row dialogue-window__row--repair";
      row.innerHTML = `
        <span class="dialogue-window__row-icon"><img src="/${item.icon}" alt="" draggable="false" /></span>
        <span class="dialogue-window__row-meta">
          <span class="dialogue-window__row-name">${escapeHtml(item.name)}</span>
          <span class="dialogue-window__row-sub">Trwałość: ${slot.durability} / ${slot.maxDurability}</span>
        </span>
        <span class="dialogue-window__row-price">${cost} g</span>`;
      row.title = `Brakuje ${missing} punktów trwałości`;
      row.disabled = view.gold < cost;
      row.addEventListener("click", () =>
        handlers.onRepair(view.npcInstanceId, slot.slotId),
      );
      this.listEl.appendChild(row);
    }
  }

  private renderBuyList(): void {
    if (!this.view) return;
    const gold = this.view.gold;

    for (const offer of this.view.shop) {
      if (!hasItem(offer.itemId)) continue;
      const item = getItem(offer.itemId);
      if (item.buyPrice <= 0) continue;

      const stock =
        this.stockOverrides.get(offer.itemId) ??
        (offer.stock >= 0 ? offer.stock : -1);
      const soldOut = stock === 0;
      const tooPoor = gold < item.buyPrice;

      const row = document.createElement("button");
      row.type = "button";
      row.className = "dialogue-window__row";
      row.setAttribute("role", "listitem");
      row.disabled = soldOut || tooPoor;
      if (soldOut) {
        row.title = "Towar wyprzedany";
      } else if (tooPoor) {
        row.title = `Za mało złota — potrzeba ${item.buyPrice} g`;
      }
      row.setAttribute(
        "aria-label",
        `${item.name}. ${
          soldOut
            ? "Towar wyprzedany"
            : tooPoor
              ? `Za mało złota, potrzeba ${item.buyPrice} g`
              : `Kup za ${item.buyPrice} g`
        }`,
      );
      row.innerHTML = `
        <span class="dialogue-window__row-icon"><img src="/${item.icon}" alt="" draggable="false" /></span>
        <span class="dialogue-window__row-meta">
          <span class="dialogue-window__row-name">${escapeHtml(item.name)}</span>
          <span class="dialogue-window__row-sub">${
            soldOut ? "Wyprzedane" : stock < 0 ? "W zapasie" : `Zapas: ${stock}`
          }</span>
        </span>
        <span class="dialogue-window__row-price">${item.buyPrice} g</span>
      `;
      row.addEventListener("click", () => {
        if (!this.view || soldOut || tooPoor) return;
        this.tradeHandlers?.onBuy(this.view.npcInstanceId, offer.itemId);
      });
      this.listEl.appendChild(row);
    }

    if (!this.listEl.childElementCount) {
      this.listEl.appendChild(this.emptyNote("Kram jest pusty."));
    }
  }

  private renderSellList(): void {
    if (!this.inventory) {
      this.listEl.appendChild(this.emptyNote("Brak ekwipunku."));
      return;
    }

    const slots = this.inventory.getSlots();
    let any = false;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (!slot?.itemId || !hasItem(slot.itemId)) continue;
      const item = getItem(slot.itemId);
      if (item.sellPrice <= 0) continue;
      any = true;

      const row = document.createElement("button");
      row.type = "button";
      row.className = "dialogue-window__row";
      row.setAttribute("role", "listitem");
      const qtyLabel = slot.quantity > 1 ? ` ×${slot.quantity}` : "";
      row.innerHTML = `
        <span class="dialogue-window__row-icon"><img src="/${item.icon}" alt="" draggable="false" /></span>
        <span class="dialogue-window__row-meta">
          <span class="dialogue-window__row-name">${escapeHtml(item.name)}${qtyLabel}</span>
          <span class="dialogue-window__row-sub">${item.typeLabel}</span>
        </span>
        <span class="dialogue-window__row-price dialogue-window__row-price--sell">+${item.sellPrice} g</span>
      `;
      const index = i;
      row.addEventListener("click", () => {
        if (!this.view) return;
        this.tradeHandlers?.onSell(this.view.npcInstanceId, index);
      });
      this.listEl.appendChild(row);
    }

    if (!any) {
      this.listEl.appendChild(this.emptyNote("Nie masz nic na sprzedaż."));
    }
  }

  private emptyNote(text: string): HTMLElement {
    const note = document.createElement("p");
    note.className = "dialogue-window__empty";
    note.textContent = text;
    return note;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
