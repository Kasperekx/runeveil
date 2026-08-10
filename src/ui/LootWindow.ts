import { CHARACTER_PANEL_CLOSE_MS } from "../config/constants";
import {
  getItem,
  itemRarity,
  itemRarityLabel,
  type ItemDefinition,
  type ItemInstance,
} from "../items/catalog";
import {
  ItemTooltip,
  type ItemComparisonProvider,
} from "./inventory/ItemTooltip";
import { makeDraggable, clearDragPosition } from "./makeDraggable";

export type LootSlotView = ItemInstance;

interface FilledSlot {
  index: number;
  quantity: number;
  def: ItemDefinition;
  instance: LootSlotView;
}

/** Corpse loot panel — click an item to take it; Esc / take-all for speed. */
export class LootWindow {
  private animalId: string | null = null;
  private onTake: ((animalId: string, slotIndex: number) => void) | null = null;
  private onTakeAll: ((animalId: string) => void) | null = null;
  private lastKey = "";
  private opened = false;
  private closeTimer: number | null = null;
  private filled: FilledSlot[] = [];
  private readonly tooltip: ItemTooltip;

  private constructor(
    private readonly root: HTMLElement,
    private readonly titleEl: HTMLElement,
    private readonly countEl: HTMLElement,
    private readonly hintEl: HTMLElement,
    private readonly gridEl: HTMLElement,
    private readonly takeAllEl: HTMLButtonElement,
    private readonly comparisonProvider: ItemComparisonProvider | null,
  ) {
    this.tooltip = ItemTooltip.create();
  }

  static create(
    comparisonProvider: ItemComparisonProvider | null = null,
    host: HTMLElement = document.getElementById("ui-root")!,
  ): LootWindow {
    const root = document.createElement("aside");
    root.id = "loot-window";
    root.className = "loot-window";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "false");
    root.setAttribute("aria-label", "Łup ze zwłok");
    root.innerHTML = `
      <div class="loot-window__frame">
        <div class="loot-window__ornament loot-window__ornament--tl" aria-hidden="true"></div>
        <div class="loot-window__ornament loot-window__ornament--tr" aria-hidden="true"></div>
        <div class="loot-window__ornament loot-window__ornament--bl" aria-hidden="true"></div>
        <div class="loot-window__ornament loot-window__ornament--br" aria-hidden="true"></div>
        <header class="loot-window__header" data-header>
          <span class="loot-window__sigil" aria-hidden="true">☠</span>
          <div class="loot-window__heading">
            <p class="loot-window__eyebrow">Łup ze zwłok</p>
            <h2 class="loot-window__title" data-title>Łup</h2>
          </div>
          <span class="loot-window__count" data-count hidden title="Liczba przedmiotów">0</span>
          <button type="button" class="loot-window__close" data-close aria-label="Zamknij">×</button>
        </header>
        <p class="loot-window__hint" data-hint>Kliknij przedmiot, aby go zabrać</p>
        <div class="loot-window__grid" data-grid role="list"></div>
        <footer class="loot-window__footer">
          <button type="button" class="loot-window__take-all" data-take-all>
            <span data-take-all-label>Zabierz wszystko</span>
            <kbd class="loot-window__kbd" aria-hidden="true">Space</kbd>
          </button>
        </footer>
      </div>
    `;
    host.appendChild(root);

    const win = new LootWindow(
      root,
      root.querySelector("[data-title]")!,
      root.querySelector("[data-count]")!,
      root.querySelector("[data-hint]")!,
      root.querySelector("[data-grid]")!,
      root.querySelector("[data-take-all]")!,
      comparisonProvider,
    );

    root.querySelector("[data-close]")!.addEventListener("click", () => {
      win.close();
    });
    win.takeAllEl.addEventListener("click", () => win.takeAll());
    makeDraggable(root, root.querySelector("[data-header]") as HTMLElement);

    return win;
  }

  /** Esc closes; Space takes all while the window is open. */
  bindHotkeys(
    onKey: (handler: (code: string, event: KeyboardEvent) => void) => void,
  ): void {
    onKey((code, event) => {
      if (!this.opened) return;
      if (code === "Escape") {
        event.preventDefault();
        this.close();
        return;
      }
      if (code === "Space" && this.filled.length > 0) {
        event.preventDefault();
        this.takeAll();
      }
    });
  }

  setTakeHandler(handler: (animalId: string, slotIndex: number) => void): void {
    this.onTake = handler;
  }

  setTakeAllHandler(handler: (animalId: string) => void): void {
    this.onTakeAll = handler;
  }

  get openAnimalId(): string | null {
    return this.animalId;
  }

  get isOpen(): boolean {
    return this.opened;
  }

  open(animalId: string, title: string, slots: LootSlotView[]): void {
    if (this.closeTimer !== null) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }

    this.animalId = animalId;
    this.titleEl.textContent = stripLootPrefix(title);
    this.opened = true;
    this.root.hidden = false;
    clearDragPosition(this.root);
    void this.root.offsetWidth;
    this.root.classList.add("is-open");
    this.renderSlots(slots);
  }

  updateIfOpen(animalId: string, slots: LootSlotView[]): void {
    if (this.animalId !== animalId || !this.opened) return;
    this.renderSlots(slots);
  }

  close(): void {
    if (!this.opened) return;

    this.animalId = null;
    this.opened = false;
    this.lastKey = "";
    this.filled = [];
    this.tooltip.hide();
    this.root.classList.remove("is-open");

    if (this.closeTimer !== null) window.clearTimeout(this.closeTimer);
    this.closeTimer = window.setTimeout(() => {
      this.closeTimer = null;
      if (this.opened) return;
      this.root.hidden = true;
      this.gridEl.replaceChildren();
    }, CHARACTER_PANEL_CLOSE_MS);
  }

  /**
   * One server round-trip for the whole corpse — avoids the old race where
   * interleaved client inventory saves wiped all but the last looted item.
   */
  private takeAll(): void {
    if (!this.animalId || !this.onTakeAll || this.filled.length === 0) return;
    this.tooltip.hide();
    this.takeAllEl.classList.add("is-pulse");
    window.setTimeout(() => this.takeAllEl.classList.remove("is-pulse"), 220);
    this.onTakeAll(this.animalId);
  }

  private renderSlots(slots: LootSlotView[]): void {
    const key = JSON.stringify(slots);
    if (key === this.lastKey) return;
    this.lastKey = key;

    // Replacing buttons under the cursor skips pointerleave — clear tooltip.
    this.tooltip.hide();

    this.filled = [];
    for (const [index, slot] of slots.entries()) {
      if (!slot.itemId || slot.quantity <= 0) continue;
      try {
        this.filled.push({
          index,
          quantity: slot.quantity,
          def: getItem(slot.itemId),
          instance: slot,
        });
      } catch {
        // Unknown item id (catalog drift) — skip rather than break the window.
      }
    }

    this.gridEl.replaceChildren();
    this.syncChrome();

    if (this.filled.length === 0) {
      const empty = document.createElement("div");
      empty.className = "loot-window__empty";
      empty.innerHTML = `
        <span class="loot-window__empty-sigil" aria-hidden="true">☠</span>
        <p class="loot-window__empty-title">Zwłoki są puste</p>
        <p class="loot-window__empty-sub">Nie zostało nic do zabrania</p>
      `;
      this.gridEl.appendChild(empty);
      return;
    }

    for (const [i, entry] of this.filled.entries()) {
      const row = this.buildSlot(entry);
      row.style.setProperty("--loot-i", String(i));
      this.gridEl.appendChild(row);
    }
  }

  private syncChrome(): void {
    const n = this.filled.length;
    this.takeAllEl.disabled = n === 0;
    this.hintEl.hidden = n === 0;
    this.hintEl.textContent =
      n === 1
        ? "Kliknij przedmiot, aby go zabrać"
        : "Kliknij przedmiot · Space zabiera wszystko";

    const label = this.takeAllEl.querySelector("[data-take-all-label]");
    if (label) {
      label.textContent =
        n === 0
          ? "Brak łupu"
          : n === 1
            ? "Zabierz przedmiot"
            : `Zabierz wszystko (${n})`;
    }

    if (n === 0) {
      this.countEl.hidden = true;
      this.countEl.textContent = "0";
    } else {
      this.countEl.hidden = false;
      this.countEl.textContent = String(n);
    }
  }

  private buildSlot({
    index,
    quantity,
    def,
    instance,
  }: FilledSlot): HTMLElement {
    const rarity = itemRarity(def, instance);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `loot-window__slot loot-window__slot--${rarity}`;
    button.setAttribute("role", "listitem");
    button.setAttribute(
      "aria-label",
      `Zabierz: ${def.name}${quantity > 1 ? ` x${quantity}` : ""}`,
    );

    const frame = document.createElement("span");
    frame.className = `loot-window__icon-frame loot-window__icon-frame--${rarity}`;

    const icon = document.createElement("img");
    icon.className = "loot-window__icon";
    icon.src = `/${def.icon}`;
    icon.alt = "";
    icon.draggable = false;
    frame.appendChild(icon);

    if (quantity > 1) {
      const qty = document.createElement("span");
      qty.className = "loot-window__qty";
      qty.textContent = String(quantity);
      frame.appendChild(qty);
    }

    const text = document.createElement("span");
    text.className = "loot-window__text";

    const name = document.createElement("span");
    name.className = `loot-window__name loot-window__name--${rarity}`;
    name.textContent = def.name;

    const meta = document.createElement("span");
    meta.className = "loot-window__meta";
    meta.textContent = `${def.typeLabel} · ${itemRarityLabel(rarity)}`;

    text.append(name, meta);

    const action = document.createElement("span");
    action.className = "loot-window__action";
    action.textContent = "Zabierz";
    action.setAttribute("aria-hidden", "true");

    button.append(frame, text, action);

    button.addEventListener("click", () => {
      if (!this.animalId) return;
      this.tooltip.hide();
      button.classList.add("is-taken");
      this.onTake?.(this.animalId, index);
    });
    button.addEventListener("pointerenter", (event) => {
      this.tooltip.show(
        def,
        quantity,
        event.clientX,
        event.clientY,
        instance,
        def.slot ? this.comparisonProvider?.(def.slot) : null,
      );
    });
    button.addEventListener("pointermove", (event) => {
      this.tooltip.moveTo(event.clientX, event.clientY);
    });
    button.addEventListener("pointerleave", () => this.tooltip.hide());

    return button;
  }
}

/** "Łup — Dzik" → "Dzik"; plain titles pass through. */
function stripLootPrefix(title: string): string {
  const trimmed = title.trim();
  const match = /^Łup\s*[—–-]\s*(.+)$/u.exec(trimmed);
  return match?.[1]?.trim() || trimmed;
}
