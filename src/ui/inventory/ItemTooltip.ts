import {
  affixLabel,
  itemRarity,
  itemRarityLabel,
  type ItemDefinition,
  type ItemInstance,
} from "../../content/items";
import { toHostSpace } from "../hud/uiScale";

export interface ItemTooltipComparison {
  item: ItemDefinition;
  instance: Pick<
    ItemInstance,
    "instanceId" | "rarity" | "affixes" | "durability" | "maxDurability"
  >;
}

export type ItemComparisonProvider = (
  slotId: string,
) => ItemTooltipComparison | null;

interface ActiveItemTooltip {
  item: ItemDefinition;
  quantity: number;
  clientX: number;
  clientY: number;
  instance: Pick<
    ItemInstance,
    "instanceId" | "rarity" | "affixes" | "durability" | "maxDurability"
  > | null;
  comparison: ItemTooltipComparison | null;
}

/** WoW-style floating item details panel. */
export class ItemTooltip {
  private readonly root: HTMLElement;
  private readonly comparisonRoot: HTMLElement;
  private active: ActiveItemTooltip | null = null;
  private altHeld = false;

  private constructor(root: HTMLElement, comparisonRoot: HTMLElement) {
    this.root = root;
    this.comparisonRoot = comparisonRoot;
    window.addEventListener("keydown", this.onKeyChange);
    window.addEventListener("keyup", this.onKeyChange);
  }

  static create(
    parent: HTMLElement = document.getElementById("ui-root")!,
  ): ItemTooltip {
    if (!parent) {
      throw new Error("Missing #ui-root for item tooltip");
    }

    const root = document.createElement("div");
    root.className = "item-tooltip";
    root.hidden = true;
    root.setAttribute("aria-hidden", "true");
    parent.appendChild(root);

    const comparisonRoot = document.createElement("div");
    comparisonRoot.className = "item-tooltip item-tooltip--comparison";
    comparisonRoot.hidden = true;
    comparisonRoot.setAttribute("aria-hidden", "true");
    parent.appendChild(comparisonRoot);

    return new ItemTooltip(root, comparisonRoot);
  }

  show(
    item: ItemDefinition,
    quantity: number,
    clientX: number,
    clientY: number,
    instance?: Pick<
      ItemInstance,
      "instanceId" | "rarity" | "affixes" | "durability" | "maxDurability"
    > | null,
    comparison?: ItemTooltipComparison | null,
  ): void {
    this.active = {
      item,
      quantity,
      clientX,
      clientY,
      instance: instance ?? null,
      comparison: comparison ?? null,
    };
    this.renderActive();
  }

  private renderActive(): void {
    const active = this.active;
    if (!active) return;

    const { item, quantity, instance, comparison } = active;
    const canCompare = Boolean(
      comparison && comparison.item.slot === item.slot,
    );
    const upgrade = canCompare
      ? upgradePercent(item, instance, comparison!)
      : null;
    this.root.innerHTML = `${itemDetailsHtml(item, quantity, instance)}
      ${
        canCompare && this.altHeld
          ? upgradeHtml(upgrade!)
          : canCompare
            ? `<p class="item-tooltip__hint">Przytrzymaj Alt, aby porównać</p>`
            : ""
      }`;

    this.root.hidden = false;
    this.root.setAttribute("aria-hidden", "false");
    this.moveTo(active.clientX, active.clientY);

    if (canCompare && this.altHeld) {
      this.comparisonRoot.innerHTML = `
        <p class="item-tooltip__eyebrow">Aktualnie założony</p>
        ${itemDetailsHtml(comparison!.item, 1, comparison!.instance)}
        ${comparisonHtml(item, instance, comparison!)}
      `;
      this.comparisonRoot.hidden = false;
      this.comparisonRoot.setAttribute("aria-hidden", "false");
      this.moveComparisonTo();
    } else {
      this.hideComparison();
    }
  }

  /** Generic tip (attributes, UI hints) — same plate as item tooltips. */
  showInfo(
    title: string,
    effect: string | string[],
    flavor: string,
    clientX: number,
    clientY: number,
  ): void {
    this.active = null;
    this.hideComparison();
    const effects = Array.isArray(effect) ? effect : [effect];
    this.root.innerHTML = `
      <p class="item-tooltip__name item-tooltip__name--uncommon">${escapeHtml(title)}</p>
      ${effects
        .map((line) => `<p class="item-tooltip__stat">${escapeHtml(line)}</p>`)
        .join("")}
      <p class="item-tooltip__desc">${escapeHtml(flavor)}</p>
    `;
    this.root.hidden = false;
    this.root.setAttribute("aria-hidden", "false");
    this.moveTo(clientX, clientY);
  }

  moveTo(clientX: number, clientY: number): void {
    if (this.root.hidden) return;
    if (this.active) {
      this.active.clientX = clientX;
      this.active.clientY = clientY;
    }

    const offset = 14;
    // The tooltip sits inside the scaled HUD layer, so work in its space:
    // pointer coords and getBoundingClientRect are both screen-space.
    const { x, y, scale } = toHostSpace(this.root, clientX, clientY);
    const rect = this.root.getBoundingClientRect();
    const width = rect.width / scale;
    const height = rect.height / scale;

    const host = this.root.offsetParent as HTMLElement | null;
    const boundsW = host?.offsetWidth ?? window.innerWidth;
    const boundsH = host?.offsetHeight ?? window.innerHeight;

    let left = x + offset;
    let top = y + offset;

    if (left + width > boundsW - 8) left = x - width - offset;
    if (top + height > boundsH - 8) top = y - height - offset;

    this.root.style.left = `${Math.max(8, left)}px`;
    this.root.style.top = `${Math.max(8, top)}px`;
    if (!this.comparisonRoot.hidden) this.moveComparisonTo();
  }

  hide(): void {
    this.active = null;
    this.hideComparison();
    this.root.hidden = true;
    this.root.setAttribute("aria-hidden", "true");
    this.root.replaceChildren();
  }

  private onKeyChange = (event: KeyboardEvent): void => {
    this.altHeld =
      event.type === "keydown"
        ? event.altKey || event.code === "Alt"
        : event.altKey;
    if (!this.active) return;
    this.renderActive();
  };

  private moveComparisonTo(): void {
    if (this.comparisonRoot.hidden) return;
    const host = this.root.offsetParent as HTMLElement | null;
    const boundsW = host?.offsetWidth ?? window.innerWidth;
    const boundsH = host?.offsetHeight ?? window.innerHeight;
    const { scale } = toHostSpace(this.root, 0, 0);
    const currentLeft = Number.parseFloat(this.root.style.left) || 8;
    const currentTop = Number.parseFloat(this.root.style.top) || 8;
    const currentWidth = this.root.getBoundingClientRect().width / scale;
    const comparisonWidth =
      this.comparisonRoot.getBoundingClientRect().width / scale;
    const comparisonHeight =
      this.comparisonRoot.getBoundingClientRect().height / scale;
    const gap = 10;
    const leftOfCurrent = currentLeft - comparisonWidth - gap;
    const left =
      leftOfCurrent >= 8
        ? leftOfCurrent
        : Math.min(
            boundsW - comparisonWidth - 8,
            currentLeft + currentWidth + gap,
          );
    this.comparisonRoot.style.left = `${Math.max(8, left)}px`;
    this.comparisonRoot.style.top = `${Math.max(8, Math.min(boundsH - comparisonHeight - 8, currentTop))}px`;
  }

  private hideComparison(): void {
    this.comparisonRoot.hidden = true;
    this.comparisonRoot.setAttribute("aria-hidden", "true");
    this.comparisonRoot.replaceChildren();
  }
}

type DisplayStat =
  "armor" | "damageMin" | "damageMax" | ItemInstance["affixes"][number]["stat"];

const COMPARED_STATS: Array<{ stat: DisplayStat; label: string }> = [
  { stat: "armor", label: "Pancerz" },
  { stat: "damageMin", label: "Obrażenia minimalne" },
  { stat: "damageMax", label: "Obrażenia maksymalne" },
  { stat: "strength", label: "Siła" },
  { stat: "agility", label: "Zręczność" },
  { stat: "stamina", label: "Wytrzymałość" },
  { stat: "intellect", label: "Inteligencja" },
  { stat: "spirit", label: "Duch" },
];

function comparisonHtml(
  item: ItemDefinition,
  instance: Pick<ItemInstance, "rarity" | "affixes"> | null,
  comparison: ItemTooltipComparison,
): string {
  const rows = COMPARED_STATS.flatMap(({ stat, label }) => {
    const next = statValue(item, instance, stat);
    const current = statValue(comparison.item, comparison.instance, stat);
    if (next === 0 && current === 0) return [];
    const delta = next - current;
    const deltaLabel =
      delta === 0 ? "bez zmian" : `${delta > 0 ? "+" : ""}${delta}`;
    const deltaClass =
      delta > 0 ? "positive" : delta < 0 ? "negative" : "neutral";
    return [
      `<p class="item-tooltip__compare-row"><span>${escapeHtml(label)}</span><strong>${next}</strong><em class="item-tooltip__delta item-tooltip__delta--${deltaClass}">(${deltaLabel})</em></p>`,
    ];
  });
  if (rows.length === 0) {
    rows.push(
      '<p class="item-tooltip__compare-empty">Brak różnic w statystykach.</p>',
    );
  }
  return `
    <section class="item-tooltip__compare">
      <p class="item-tooltip__compare-title">Po zamianie:</p>
      ${rows.join("")}
    </section>
  `;
}

function itemDetailsHtml(
  item: ItemDefinition,
  quantity: number,
  instance: Pick<
    ItemInstance,
    "rarity" | "affixes" | "durability" | "maxDurability"
  > | null,
): string {
  const rarity = itemRarity(item, instance);
  const affixes = instance?.affixes ?? [];
  return `
    <p class="item-tooltip__name item-tooltip__name--${rarity}">${escapeHtml(item.name)}</p>
    <p class="item-tooltip__meta">${escapeHtml(item.typeLabel)} · ${escapeHtml(itemRarityLabel(rarity))}</p>
    ${item.capacity > 0 ? `<p class="item-tooltip__stat">Pojemność: ${item.capacity} miejsc</p>` : ""}
    ${item.twoHanded ? `<p class="item-tooltip__stat">Dwuręczna</p>` : ""}
    ${item.requiredLevel > 0 ? `<p class="item-tooltip__stat">Wymagany poziom: ${item.requiredLevel}</p>` : ""}
    ${item.armor > 0 ? `<p class="item-tooltip__stat">Pancerz: ${item.armor}</p>` : ""}
    ${item.damageMax > 0 ? `<p class="item-tooltip__stat">Obrażenia: ${item.damageMin}–${item.damageMax}</p>` : ""}
    ${durabilityHtml(item, instance)}
    ${affixes.map((affix) => `<p class="item-tooltip__stat item-tooltip__stat--affix">${escapeHtml(affixLabel(affix))}</p>`).join("")}
    ${useStatsHtml(item)}
    <p class="item-tooltip__desc">${escapeHtml(item.description)}</p>
    ${
      quantity > 1
        ? `<p class="item-tooltip__qty">Ilość: ${quantity}${item.stackable ? ` / ${item.maxStack}` : ""}</p>`
        : item.stackable
          ? `<p class="item-tooltip__qty">Stos: max ${item.maxStack}</p>`
          : ""
    }
  `;
}

function durabilityHtml(
  item: Pick<ItemDefinition, "maxDurability">,
  instance: Pick<ItemInstance, "durability" | "maxDurability"> | null,
): string {
  const maxDurability =
    instance && instance.maxDurability > 0
      ? instance.maxDurability
      : item.maxDurability;
  if (maxDurability <= 0) return "";
  const durability =
    instance && instance.maxDurability > 0
      ? instance.durability
      : maxDurability;
  const ratio = Math.max(0, Math.min(1, durability / maxDurability));
  const broken = ratio <= 0;
  return `<p class="item-tooltip__durability ${broken ? "item-tooltip__durability--broken" : ""}">Trwałość: ${durability} / ${maxDurability}</p>
    <span class="item-tooltip__durability-track"><span style="width:${ratio * 100}%"></span></span>
    ${broken ? '<p class="item-tooltip__broken">Uszkodzony — nie daje statystyk.</p>' : ""}`;
}

function upgradeHtml(upgrade: number): string {
  if (upgrade === 0) {
    return '<p class="item-tooltip__upgrade item-tooltip__upgrade--neutral">→ bez zmiany</p>';
  }
  const positive = upgrade >= 0;
  const label = `${positive ? "↑" : "↓"} ${Math.abs(upgrade).toFixed(1)}% ${positive ? "ulepszenie" : "słabszy"}`;
  return `<p class="item-tooltip__upgrade item-tooltip__upgrade--${positive ? "positive" : "negative"}">${label}</p>`;
}

function upgradePercent(
  item: ItemDefinition,
  instance: Pick<ItemInstance, "rarity" | "affixes"> | null,
  comparison: ItemTooltipComparison,
): number {
  const candidate = gearScore(item, instance);
  const equipped = gearScore(comparison.item, comparison.instance);
  if (equipped <= 0) return candidate > 0 ? 100 : 0;
  return Math.round((candidate / equipped - 1) * 100 * 10) / 10;
}

/** Lightweight Pawn-like score for the current physical-combat itemization. */
function gearScore(
  item: ItemDefinition,
  instance: Pick<ItemInstance, "affixes"> | null,
): number {
  return (
    statValue(item, instance, "armor") * 1 +
    statValue(item, instance, "damageMin") * 1.4 +
    statValue(item, instance, "damageMax") * 1.8 +
    statValue(item, instance, "strength") * 2 +
    statValue(item, instance, "agility") * 1.1 +
    statValue(item, instance, "stamina") * 0.6 +
    statValue(item, instance, "intellect") * 0.9 +
    statValue(item, instance, "spirit") * 0.7
  );
}

function statValue(
  item: ItemDefinition,
  instance: Pick<ItemInstance, "affixes"> | null,
  stat: DisplayStat,
): number {
  const base =
    stat === "armor"
      ? item.armor
      : stat === "damageMin"
        ? item.damageMin
        : stat === "damageMax"
          ? item.damageMax
          : 0;
  return (
    base +
    (instance?.affixes ?? [])
      .filter((affix) => affix.stat === stat)
      .reduce((sum, affix) => sum + affix.value, 0)
  );
}

function useStatsHtml(item: ItemDefinition): string {
  const use = item.use;
  if (!use) return "";

  const lines: string[] = [];
  if (use.heal > 0) {
    lines.push(
      `<p class="item-tooltip__stat item-tooltip__stat--heal">Przywraca ${use.heal} życia</p>`,
    );
  }
  const buff = use.buff;
  if (buff) {
    const bonuses: string[] = [];
    if (buff.strength > 0) bonuses.push(`+${buff.strength} do Siły`);
    if (buff.agility > 0) bonuses.push(`+${buff.agility} do Zwinności`);
    if (buff.stamina > 0) bonuses.push(`+${buff.stamina} do Wytrzymałości`);
    if (buff.intellect > 0) bonuses.push(`+${buff.intellect} do Intelektu`);
    if (buff.spirit > 0) bonuses.push(`+${buff.spirit} do Ducha`);
    if (bonuses.length > 0) {
      const minutes = Math.round(buff.durationMs / 60000);
      const duration =
        minutes >= 60 ? `${Math.round(minutes / 60)} godz.` : `${minutes} min.`;
      lines.push(
        `<p class="item-tooltip__stat item-tooltip__stat--heal">${escapeHtml(bonuses.join(", "))} na ${duration}</p>`,
      );
      lines.push(
        `<p class="item-tooltip__stat">Zastępuje poprzedni efekt posiłku</p>`,
      );
    }
  }
  if (use.cooldownMs > 0) {
    const seconds = use.cooldownMs / 1000;
    const label = Number.isInteger(seconds)
      ? String(seconds)
      : seconds.toFixed(1);
    lines.push(`<p class="item-tooltip__stat">Czas odnowienia: ${label} s</p>`);
  }
  return lines.join("");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
