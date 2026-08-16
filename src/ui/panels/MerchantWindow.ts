import { CHARACTER_PANEL_CLOSE_MS } from "../../config/constants";
import type { Inventory } from "../../inventory/Inventory";
import {
  getItem,
  hasItem,
  repairCost,
  type ItemInstance,
} from "../../content/items";
import type { NpcShopOffer } from "../../content/npcs";
import { makeDraggable, clearDragPosition } from "../makeDraggable";

export type MerchantTab = "buy" | "sell" | "repair";

export interface MerchantTradeHandlers {
  onBuy: (npcInstanceId: string, itemId: string) => void;
  onSell: (npcInstanceId: string, inventoryIndex: number) => void;
}

export interface MerchantRepairHandlers {
  getEquipment: () => Array<ItemInstance & { slotId: string }>;
  onRepair: (
    npcInstanceId: string,
    target?:
      | { source: "equipment"; slotId: string }
      | { source: "inventory"; inventoryIndex: number },
  ) => void;
}

export interface MerchantView {
  name: string;
  title: string;
  npcInstanceId: string;
  shop: NpcShopOffer[];
  gold: number;
  canRepair: boolean;
  initialTab?: MerchantTab;
}

/**
 * Vendor / repair work panel — opened from NPC gossip, not inside it.
 * Inventory is expected to be opened alongside by the caller.
 */
export class MerchantWindow {
  private opened = false;
  private closeTimer: number | null = null;
  private view: MerchantView | null = null;
  private tab: MerchantTab = "buy";
  private stockOverrides = new Map<string, number>();
  private tradeHandlers: MerchantTradeHandlers | null = null;
  private repairHandlers: MerchantRepairHandlers | null = null;
  private inventory: Inventory | null = null;

  private constructor(
    private readonly root: HTMLElement,
    private readonly eyebrowEl: HTMLElement,
    private readonly titleEl: HTMLElement,
    private readonly goldEl: HTMLElement,
    private readonly tabsEl: HTMLElement,
    private readonly listEl: HTMLElement,
    private readonly repairSection: HTMLElement,
    private readonly repairListEl: HTMLElement,
    private readonly repairConditionEl: HTMLElement,
    private readonly repairAllBtn: HTMLButtonElement,
  ) {}

  static create(
    host: HTMLElement = document.getElementById("ui-root")!,
  ): MerchantWindow {
    const root = document.createElement("aside");
    root.id = "merchant-window";
    root.className = "merchant-window panel";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Handel");
    root.innerHTML = `
      <div class="panel__frame">
        <span class="panel__corner panel__corner--tl" aria-hidden="true"></span>
        <span class="panel__corner panel__corner--br" aria-hidden="true"></span>
        <header class="panel__header" data-header>
          <div class="panel__brand">
            <span class="panel__sigil" aria-hidden="true"><span>⚖</span></span>
            <div>
              <span class="panel__eyebrow" data-eyebrow>Handel</span>
              <h2 class="panel__title" data-title>Kupiec</h2>
            </div>
          </div>
          <div class="panel__rule" aria-hidden="true"><span>◆</span></div>
          <span class="panel__chip" data-gold title="Złoto"><i>Złoto</i><b>0</b></span>
          <button type="button" class="panel__close" data-close aria-label="Zamknij">
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div class="panel__body">
          <div class="merchant-window__tabs" data-tabs role="tablist">
            <button type="button" class="merchant-window__tab is-active" data-tab="buy" role="tab">Kup</button>
            <button type="button" class="merchant-window__tab" data-tab="sell" role="tab">Sprzedaj</button>
            <button type="button" class="merchant-window__tab" data-tab="repair" role="tab" hidden>Naprawa</button>
          </div>
          <div class="merchant-window__list" data-list role="list"></div>
          <section class="merchant-window__repair" data-repair hidden aria-label="Warsztat">
            <div class="panel__heading">
              <div><span>Usługa</span><h3>Naprawa ekwipunku</h3></div>
            </div>
            <div class="merchant-window__condition" data-repair-condition></div>
            <div class="merchant-window__repair-list" data-repair-list role="list"></div>
            <footer class="merchant-window__footer">
              <button type="button" class="merchant-window__repair-all" data-repair-all>
                Napraw wszystko
              </button>
            </footer>
          </section>
        </div>
      </div>
    `;
    host.appendChild(root);

    const goldChip = root.querySelector("[data-gold]")!;
    const win = new MerchantWindow(
      root,
      root.querySelector("[data-eyebrow]")!,
      root.querySelector("[data-title]")!,
      goldChip.querySelector("b")!,
      root.querySelector("[data-tabs]")!,
      root.querySelector("[data-list]")!,
      root.querySelector("[data-repair]")!,
      root.querySelector("[data-repair-list]")!,
      root.querySelector("[data-repair-condition]")!,
      root.querySelector("[data-repair-all]")!,
    );

    root.querySelector("[data-close]")!.addEventListener("click", () => {
      win.close();
    });
    win.tabsEl.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const tab = target.dataset.tab;
      if (tab === "buy" || tab === "sell" || tab === "repair") win.setTab(tab);
    });
    win.repairAllBtn.addEventListener("click", () => {
      if (!win.view) return;
      win.repairHandlers?.onRepair(win.view.npcInstanceId);
    });
    makeDraggable(root, root.querySelector("[data-header]") as HTMLElement);
    return win;
  }

  bindTrade(inventory: Inventory, handlers: MerchantTradeHandlers): void {
    this.inventory = inventory;
    this.tradeHandlers = handlers;
    inventory.onChange(() => {
      if (!this.opened) return;
      if (this.tab === "sell") this.renderList();
      if (this.tab === "repair") this.renderRepairList();
    });
  }

  bindRepair(handlers: MerchantRepairHandlers): void {
    this.repairHandlers = handlers;
  }

  get isOpen(): boolean {
    return this.opened;
  }

  open(view: MerchantView): void {
    if (this.closeTimer !== null) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }

    this.view = view;
    this.stockOverrides.clear();
    for (const offer of view.shop) {
      if (offer.stock >= 0) this.stockOverrides.set(offer.itemId, offer.stock);
    }

    this.eyebrowEl.textContent = view.title || "Handel";
    this.titleEl.textContent = view.name;
    this.setGold(view.gold);

    const hasShop = view.shop.length > 0;
    const canRepair = view.canRepair;
    this.tabsEl.querySelector<HTMLElement>('[data-tab="buy"]')!.hidden =
      !hasShop;
    this.tabsEl.querySelector<HTMLElement>('[data-tab="sell"]')!.hidden =
      !hasShop;
    this.tabsEl.querySelector<HTMLElement>('[data-tab="repair"]')!.hidden =
      !canRepair;

    let tab: MerchantTab =
      view.initialTab ?? (hasShop ? "buy" : canRepair ? "repair" : "buy");
    if (tab === "repair" && !canRepair) tab = hasShop ? "buy" : "repair";
    if ((tab === "buy" || tab === "sell") && !hasShop && canRepair) {
      tab = "repair";
    }
    this.tab = tab;
    this.syncTabs();
    this.syncBody();

    this.opened = true;
    this.root.hidden = false;
    clearDragPosition(this.root);
    void this.root.offsetWidth;
    this.root.classList.add("is-open");
  }

  setGold(gold: number): void {
    if (this.view) this.view.gold = gold;
    this.goldEl.textContent = String(Math.max(0, Math.floor(gold)));
    if (!this.opened) return;
    if (this.tab === "buy") this.renderList();
    if (this.tab === "repair") this.renderRepairList();
  }

  setStock(itemId: string, stock: number): void {
    if (stock < 0) this.stockOverrides.delete(itemId);
    else this.stockOverrides.set(itemId, stock);
    if (this.opened && this.tab === "buy") this.renderList();
  }

  refreshRepair(): void {
    if (this.opened && this.tab === "repair") this.renderRepairList();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.view = null;
    this.root.classList.remove("is-open");
    if (this.closeTimer !== null) window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => {
      this.closeTimer = null;
      if (!this.opened) this.root.hidden = true;
    }, CHARACTER_PANEL_CLOSE_MS);
  }

  private setTab(tab: MerchantTab): void {
    if (this.tab === tab) return;
    if (!this.view) return;
    if ((tab === "buy" || tab === "sell") && this.view.shop.length === 0)
      return;
    if (tab === "repair" && !this.view.canRepair) return;
    this.tab = tab;
    this.syncTabs();
    this.syncBody();
  }

  private syncTabs(): void {
    for (const button of this.tabsEl.querySelectorAll("[data-tab]")) {
      if (!(button instanceof HTMLElement)) continue;
      button.classList.toggle("is-active", button.dataset.tab === this.tab);
    }
  }

  private syncBody(): void {
    const repair = this.tab === "repair";
    this.listEl.hidden = repair;
    this.repairSection.hidden = !repair;
    if (repair) this.renderRepairList();
    else this.renderList();
  }

  private renderList(): void {
    this.listEl.replaceChildren();
    this.listEl.classList.add("merchant-window__list--grid");
    if (!this.view) return;
    if (this.tab === "buy") this.renderBuyList();
    else this.renderSellList();
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

      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "merchant-window__cell";
      if (soldOut) cell.classList.add("merchant-window__cell--sold-out");
      if (tooPoor) cell.classList.add("merchant-window__cell--poor");
      cell.setAttribute("role", "listitem");
      cell.disabled = soldOut || tooPoor;
      cell.title = `${item.name} — ${soldOut ? "wyprzedane" : `${item.buyPrice} g`}`;
      cell.setAttribute(
        "aria-label",
        `${item.name}. ${
          soldOut
            ? "Towar wyprzedany"
            : tooPoor
              ? `Za mało złota, potrzeba ${item.buyPrice} g`
              : `Kup za ${item.buyPrice} g`
        }`,
      );
      cell.innerHTML = `
        <span class="merchant-window__cell-icon">
          <img src="/${item.icon}" alt="" draggable="false" />
          ${
            stock > 0
              ? `<span class="merchant-window__cell-qty">${stock}</span>`
              : ""
          }
        </span>
        <span class="merchant-window__cell-copy">
          <span class="merchant-window__cell-name">${escapeHtml(item.name)}</span>
          <span class="merchant-window__cell-price">${item.buyPrice} g</span>
          <span class="merchant-window__cell-status">${
            soldOut
              ? "Wyprzedane"
              : tooPoor
                ? "Za mało złota"
                : "Dostępne"
          }</span>
        </span>
      `;
      cell.addEventListener("click", () => {
        if (!this.view || soldOut || tooPoor) return;
        this.tradeHandlers?.onBuy(this.view.npcInstanceId, offer.itemId);
      });
      this.listEl.appendChild(cell);
    }

    if (!this.listEl.childElementCount) {
      this.listEl.classList.remove("merchant-window__list--grid");
      this.listEl.appendChild(this.emptyNote("Kram jest pusty."));
    }
  }

  private renderSellList(): void {
    if (!this.inventory) {
      this.listEl.classList.remove("merchant-window__list--grid");
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

      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "merchant-window__cell merchant-window__cell--sell";
      cell.setAttribute("role", "listitem");
      cell.title = `${item.name} — sprzedaj za ${item.sellPrice} g`;
      cell.setAttribute(
        "aria-label",
        `Sprzedaj ${item.name} za ${item.sellPrice} g`,
      );
      const qty =
        slot.quantity > 1
          ? `<span class="merchant-window__cell-qty">${slot.quantity}</span>`
          : "";
      cell.innerHTML = `
        <span class="merchant-window__cell-icon">
          <img src="/${item.icon}" alt="" draggable="false" />
          ${qty}
        </span>
        <span class="merchant-window__cell-copy">
          <span class="merchant-window__cell-name">${escapeHtml(item.name)}</span>
          <span class="merchant-window__cell-price merchant-window__cell-price--sell">+${item.sellPrice} g</span>
          <span class="merchant-window__cell-status">${escapeHtml(item.typeLabel)}</span>
        </span>
      `;
      const index = i;
      cell.addEventListener("click", () => {
        if (!this.view) return;
        this.tradeHandlers?.onSell(this.view.npcInstanceId, index);
      });
      this.listEl.appendChild(cell);
    }

    if (!any) {
      this.listEl.classList.remove("merchant-window__list--grid");
      this.listEl.appendChild(this.emptyNote("Nie masz nic na sprzedaż."));
    }
  }

  private renderRepairList(): void {
    this.repairListEl.replaceChildren();
    const view = this.view;
    const handlers = this.repairHandlers;
    if (!view || !handlers) {
      this.repairListEl.appendChild(
        this.emptyNote("Usługa naprawy jest niedostępna."),
      );
      this.repairAllBtn.disabled = true;
      return;
    }

    const equipped = handlers
      .getEquipment()
      .filter(
        (slot) =>
          slot.itemId &&
          slot.maxDurability > 0 &&
          slot.durability < slot.maxDurability &&
          hasItem(slot.itemId),
      )
      .map((slot) => ({
        item: slot,
        sourceLabel: "Założone",
        target: { source: "equipment" as const, slotId: slot.slotId },
      }));
    const carried = (this.inventory?.getSlots() ?? []).flatMap(
      (slot, inventoryIndex) => {
        if (
          !slot?.itemId ||
          slot.maxDurability <= 0 ||
          slot.durability >= slot.maxDurability ||
          !hasItem(slot.itemId)
        ) {
          return [];
        }
        return [
          {
            item: { ...slot, itemId: slot.itemId },
            sourceLabel: "Plecak",
            target: { source: "inventory" as const, inventoryIndex },
          },
        ];
      },
    );
    const damaged = [...equipped, ...carried];
    const allDurable = [
      ...handlers.getEquipment(),
      ...(this.inventory?.getSlots() ?? []),
    ].filter((slot) => slot.itemId && slot.maxDurability > 0);
    const currentDurability = allDurable.reduce(
      (sum, slot) => sum + slot.durability,
      0,
    );
    const maximumDurability = allDurable.reduce(
      (sum, slot) => sum + slot.maxDurability,
      0,
    );
    const conditionPercent =
      maximumDurability > 0
        ? Math.round((currentDurability / maximumDurability) * 100)
        : 100;
    this.repairConditionEl.innerHTML = `
      <div class="merchant-window__condition-copy">
        <span>Łączny stan wyposażenia</span><strong>${conditionPercent}%</strong>
      </div>
      <div class="merchant-window__condition-track"><span style="width:${conditionPercent}%"></span></div>`;

    if (damaged.length === 0) {
      this.repairListEl.appendChild(
        this.emptyNote("Cały sprzęt jest w doskonałym stanie."),
      );
      this.repairAllBtn.textContent = "Nie wymaga naprawy";
      this.repairAllBtn.disabled = true;
      return;
    }

    const totalCost = damaged.reduce(
      (total, entry) =>
        total + repairCost(getItem(entry.item.itemId), entry.item),
      0,
    );
    this.repairAllBtn.textContent = `Napraw wszystko · ${totalCost} g`;
    this.repairAllBtn.disabled = view.gold < totalCost;

    for (const entry of damaged) {
      const slot = entry.item;
      const item = getItem(slot.itemId);
      const missing = slot.maxDurability - slot.durability;
      const cost = repairCost(item, slot);
      const percent = Math.round((slot.durability / slot.maxDurability) * 100);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "merchant-window__repair-item";
      row.innerHTML = `
        <span class="merchant-window__row-icon"><img src="/${item.icon}" alt="" draggable="false" /></span>
        <span class="merchant-window__repair-main">
          <span class="merchant-window__repair-heading"><strong>${escapeHtml(item.name)}</strong><em>${entry.sourceLabel}</em></span>
          <span class="merchant-window__repair-values"><span>Trwałość</span><b>${slot.durability} / ${slot.maxDurability}</b></span>
          <span class="merchant-window__condition-track merchant-window__condition-track--thin"><span style="width:${percent}%"></span></span>
        </span>
        <span class="merchant-window__repair-cost"><small>Napraw</small><strong>${cost} g</strong></span>`;
      row.title = `Brakuje ${missing} punktów trwałości`;
      row.disabled = view.gold < cost;
      row.addEventListener("click", () =>
        handlers.onRepair(view.npcInstanceId, entry.target),
      );
      this.repairListEl.appendChild(row);
    }
  }

  private emptyNote(text: string): HTMLElement {
    const note = document.createElement("p");
    note.className = "merchant-window__empty";
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
