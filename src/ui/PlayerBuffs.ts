import { getItem, hasItem } from "../items/catalog";
import { ItemTooltip } from "./inventory/ItemTooltip";

export interface FoodBuffSnapshot {
  itemId: string;
  expiresAt: number;
  strength: number;
  agility: number;
  stamina: number;
  intellect: number;
  spirit: number;
}

/**
 * WoW-style personal buff strip under the player frame: icon + remaining time.
 * Food buffs are exclusive — one Well Fed at a time; click cancels.
 */
export class PlayerBuffs {
  private readonly root: HTMLElement;
  private readonly row: HTMLElement;
  private readonly tooltip: ItemTooltip;
  private food: FoodBuffSnapshot | null = null;
  private foodButton: HTMLButtonElement | null = null;
  private foodTimeEl: HTMLElement | null = null;
  private onCancelFood: (() => void) | null = null;

  private constructor(root: HTMLElement, row: HTMLElement, tooltip: ItemTooltip) {
    this.root = root;
    this.row = row;
    this.tooltip = tooltip;
  }

  static create(
    host: HTMLElement = document.getElementById("ui-root")!,
  ): PlayerBuffs {
    const root = document.createElement("div");
    root.className = "player-buffs";
    root.setAttribute("aria-label", "Aktywne efekty");
    root.innerHTML = `<div class="player-buffs__row" data-row></div>`;
    host.appendChild(root);
    const buffs = new PlayerBuffs(
      root,
      root.querySelector("[data-row]")!,
      ItemTooltip.create(host),
    );
    window.setInterval(() => buffs.tick(), 250);
    return buffs;
  }

  setCancelFoodHandler(handler: () => void): void {
    this.onCancelFood = handler;
  }

  setFoodBuff(buff: FoodBuffSnapshot | null): void {
    if (!buff || buff.expiresAt <= Date.now() || !hasItem(buff.itemId)) {
      this.clearFoodBuff();
      return;
    }
    this.food = buff;
    this.renderFood();
    this.tick();
  }

  clearFoodBuff(): void {
    this.food = null;
    this.foodButton?.remove();
    this.foodButton = null;
    this.foodTimeEl = null;
    this.tooltip.hide();
    this.root.hidden = this.row.childElementCount === 0;
  }

  private renderFood(): void {
    if (!this.food) return;
    const item = getItem(this.food.itemId);
    if (!this.foodButton) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "player-buffs__buff";
      button.addEventListener("pointerenter", (event) => {
        this.showFoodTooltip(event.clientX, event.clientY);
      });
      button.addEventListener("pointermove", (event) => {
        this.tooltip.moveTo(event.clientX, event.clientY);
      });
      button.addEventListener("pointerleave", () => this.tooltip.hide());
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.tooltip.hide();
        this.onCancelFood?.();
      });
      button.innerHTML = `
        <span class="player-buffs__icon-wrap">
          <img class="player-buffs__icon" alt="" draggable="false" />
          <span class="player-buffs__time" data-time></span>
        </span>
      `;
      this.row.appendChild(button);
      this.foodButton = button;
      this.foodTimeEl = button.querySelector("[data-time]");
    }
    const img = this.foodButton.querySelector("img");
    if (img) {
      img.src = `/${item.icon.replace(/^\//, "")}`;
      img.alt = item.name;
    }
    this.foodButton.title = `${item.name} — kliknij, aby anulować`;
    this.root.hidden = false;
  }

  private showFoodTooltip(clientX: number, clientY: number): void {
    if (!this.food || !hasItem(this.food.itemId)) return;
    const item = getItem(this.food.itemId);
    const remaining = Math.max(0, this.food.expiresAt - Date.now());
    this.tooltip.showInfo(
      item.name,
      [
        ...buffStatLines(this.food),
        `Pozostało: ${formatBuffTime(remaining)}`,
        "Kliknij, aby anulować",
      ],
      "Zastępuje poprzedni efekt posiłku.",
      clientX,
      clientY,
    );
  }

  private tick(): void {
    if (!this.food) {
      this.root.hidden = this.row.childElementCount === 0;
      return;
    }
    const remaining = this.food.expiresAt - Date.now();
    if (remaining <= 0) {
      this.clearFoodBuff();
      return;
    }
    if (this.foodTimeEl) {
      this.foodTimeEl.textContent = formatBuffTime(remaining);
      this.foodTimeEl.classList.toggle("is-urgent", remaining < 30_000);
    }
  }
}

function buffStatLines(buff: FoodBuffSnapshot): string[] {
  const lines: string[] = [];
  if (buff.strength > 0) lines.push(`+${buff.strength} do Siły`);
  if (buff.agility > 0) lines.push(`+${buff.agility} do Zwinności`);
  if (buff.stamina > 0) lines.push(`+${buff.stamina} do Wytrzymałości`);
  if (buff.intellect > 0) lines.push(`+${buff.intellect} do Intelektu`);
  if (buff.spirit > 0) lines.push(`+${buff.spirit} do Ducha`);
  return lines;
}

/** WoW-like remaining time for long food buffs. */
export function formatBuffTime(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  if (totalSec >= 3600) {
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    return mins > 0 ? `${hours} godz. ${mins} min` : `${hours} godz.`;
  }
  if (totalSec >= 60) {
    return `${Math.ceil(totalSec / 60)} min`;
  }
  return `${totalSec} s`;
}
