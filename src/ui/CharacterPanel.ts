import {
  getClassName,
  getClass,
  EQUIPMENT_SLOT_LABELS,
  ATTR_LABELS,
  describeAttribute,
} from "../classes/catalog";
import type { PlayerAttributes } from "../classes/catalog";
import {
  CHARACTER_PANEL_CLOSE_MS,
  DRAG_EQUIP_MIME,
  DRAG_SLOT_MIME,
} from "../config/constants";
import type { Inventory } from "../inventory/Inventory";
import {
  getItem,
  hasItem,
  type ItemAffix,
  type ItemRarity,
} from "../items/catalog";
import { ItemTooltip } from "./inventory/ItemTooltip";
import { makeDraggable } from "./makeDraggable";
import { formatHp, hpRatio, hpTier } from "./vitals";

export interface CharacterSheetData {
  name: string;
  classId: string;
  level: number;
  hp: number;
  maxHp: number;
  attackPower: number;
  damageMin: number;
  damageMax: number;
  moveSpeed: number;
  armor: number;
  strength: number;
  agility: number;
  stamina: number;
  intellect: number;
  spirit: number;
  unspentAttrPoints: number;
  portrait: string;
  equipment: Array<{
    slotId: string;
    itemId: string;
    quantity: number;
    instanceId: string;
    rarity: ItemRarity;
    affixes: ItemAffix[];
    durability: number;
    maxDurability: number;
  }>;
}

export interface EquipHandlers {
  /** Drag an item from the bag onto a doll slot. */
  onEquip: (inventoryIndex: number, slotId: string) => void;
  /** Right-click an occupied doll slot. */
  onUnequip: (slotId: string) => void;
  /** Spend one free attribute point. */
  onAllocateAttribute: (
    attr: "strength" | "agility" | "stamina" | "intellect" | "spirit",
  ) => void;
}

const ATTR_ORDER = [
  "strength",
  "agility",
  "stamina",
  "intellect",
  "spirit",
] as const;

/**
 * Paper-doll arrangement: two symmetric columns of armour slots flanking the
 * character figure, with weapons and trinkets on a rack underneath.
 */
const DOLL_LEFT = [
  "head",
  "neck",
  "shoulders",
  "back",
  "chest",
  "wrists",
] as const;
const DOLL_RIGHT = [
  "hands",
  "waist",
  "legs",
  "feet",
  "finger1",
  "finger2",
] as const;
const DOLL_BOTTOM = ["trinket1", "mainHand", "offHand", "trinket2"] as const;

/** Shown behind the equipment slots as the character silhouette. */
function figureSrc(classId: string): string {
  return classId === "knight"
    ? "/assets/players/leather-knight/knight-idle-down.png"
    : "/assets/players/human-warrior-v2/warrior-idle-down.png";
}

/** WoW-like character panel: paper-doll + attributes. Toggle with C. */
export class CharacterPanel {
  private readonly root: HTMLElement;
  private readonly identityEl: HTMLElement;
  private readonly portraitEl: HTMLImageElement;
  private readonly dollEl: HTMLElement;
  private readonly pointsEl: HTMLElement;
  private readonly attrsEl: HTMLElement;
  private readonly derivedEl: HTMLElement;
  private open = false;
  private lastKey = "";
  private closeTimer: number | null = null;
  private readonly tooltip: ItemTooltip;
  /** Latest worn gear, so hover/right-click can act without re-reading DOM. */
  private worn = new Map<string, CharacterSheetData["equipment"][number]>();
  private unspentAttrPoints = 0;
  private classId = "warrior";

  private constructor(
    root: HTMLElement,
    identityEl: HTMLElement,
    portraitEl: HTMLImageElement,
    dollEl: HTMLElement,
    pointsEl: HTMLElement,
    attrsEl: HTMLElement,
    derivedEl: HTMLElement,
    private readonly inventory: Inventory,
    private readonly handlers: EquipHandlers,
  ) {
    this.root = root;
    this.identityEl = identityEl;
    this.portraitEl = portraitEl;
    this.dollEl = dollEl;
    this.pointsEl = pointsEl;
    this.attrsEl = attrsEl;
    this.derivedEl = derivedEl;
    this.tooltip = ItemTooltip.create();
  }

  static create(
    inventory: Inventory,
    handlers: EquipHandlers,
    host: HTMLElement = document.getElementById("ui-root")!,
  ): CharacterPanel {
    const root = document.createElement("aside");
    root.id = "character-panel";
    root.className = "character-panel";
    root.hidden = true;
    root.setAttribute("aria-hidden", "true");
    root.setAttribute("aria-label", "Postać");
    root.innerHTML = `
      <div class="character-panel__frame">
        <header class="character-panel__header" data-header>
          <div class="character-panel__brand">
            <span class="character-panel__sigil" aria-hidden="true"><span>ᚱ</span></span>
            <div>
              <span class="character-panel__eyebrow">Kroniki bohatera</span>
              <h2 class="character-panel__title">Karta postaci</h2>
            </div>
          </div>
          <div class="character-panel__header-rule" aria-hidden="true"><span>◆</span></div>
          <button type="button" class="character-panel__close" data-close aria-label="Zamknij"><span aria-hidden="true">×</span></button>
        </header>
        <div class="character-panel__body">
          <div class="character-panel__identity">
            <div class="character-panel__portrait-wrap">
              <img class="character-panel__portrait" data-portrait src="" alt="" draggable="false" />
              <span class="character-panel__portrait-corner character-panel__portrait-corner--tl" aria-hidden="true"></span>
              <span class="character-panel__portrait-corner character-panel__portrait-corner--br" aria-hidden="true"></span>
            </div>
            <div class="character-panel__identity-copy">
              <span class="character-panel__identity-label">Profil bohatera</span>
              <div class="character-panel__identity-text" data-identity></div>
            </div>
            <div class="character-panel__identity-seal" aria-hidden="true">
              <span>✦</span>
              <small>CHWAŁA</small>
            </div>
          </div>
          <div class="character-panel__columns">
            <section class="character-panel__equipment">
              <div class="character-panel__section-heading">
                <div>
                  <span class="character-panel__section-kicker">Ekwipunek</span>
                  <h3>Wyposażenie</h3>
                </div>
                <span class="character-panel__section-mark" aria-hidden="true">❖</span>
              </div>
              <div class="character-panel__doll" data-doll></div>
              <p class="character-panel__equipment-hint">Przeciągnij przedmiot na slot · PPM, aby zdjąć</p>
            </section>
            <div class="character-panel__stats">
              <section class="character-panel__stat-card character-panel__stat-card--attributes">
                <div class="character-panel__section-heading character-panel__section-heading--compact">
                  <div>
                    <span class="character-panel__section-kicker">Rozwój</span>
                    <h3>Atrybuty</h3>
                  </div>
                  <div class="character-panel__points" data-points hidden></div>
                </div>
                <div class="character-panel__attrs" data-attrs></div>
              </section>
              <section class="character-panel__stat-card character-panel__stat-card--combat">
                <div class="character-panel__section-heading character-panel__section-heading--compact">
                  <div>
                    <span class="character-panel__section-kicker">Gotowość</span>
                    <h3>Parametry bojowe</h3>
                  </div>
                </div>
                <div class="character-panel__derived" data-derived></div>
              </section>
            </div>
          </div>
        </div>
      </div>
    `;
    host.appendChild(root);

    const panel = new CharacterPanel(
      root,
      root.querySelector("[data-identity]")!,
      root.querySelector("[data-portrait]")!,
      root.querySelector("[data-doll]")!,
      root.querySelector("[data-points]")!,
      root.querySelector("[data-attrs]")!,
      root.querySelector("[data-derived]")!,
      inventory,
      handlers,
    );

    root.querySelector("[data-close]")!.addEventListener("click", () => {
      panel.close();
    });

    makeDraggable(root, root.querySelector("[data-header]") as HTMLElement);
    panel.buildDoll();
    panel.bindSlots();
    panel.bindAttrClicks();
    panel.bindAttrHover();
    return panel;
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
    this.root.setAttribute("aria-hidden", "true");
    this.root.classList.remove("is-open");

    if (this.closeTimer !== null) window.clearTimeout(this.closeTimer);

    this.closeTimer = window.setTimeout(() => {
      this.closeTimer = null;
      if (!this.open) this.root.hidden = true;
    }, CHARACTER_PANEL_CLOSE_MS);
  }

  setSheet(data: CharacterSheetData): void {
    const key = JSON.stringify(data);
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.classId = data.classId;
    const figure = this.dollEl.querySelector<HTMLImageElement>(
      ".character-panel__figure-sprite",
    );
    if (figure) figure.src = figureSrc(data.classId);
    this.portraitEl.src = `/${data.portrait}`;
    this.portraitEl.alt = `Portret: ${data.name}`;
    this.identityEl.innerHTML = `
      <div class="character-panel__name">${escapeHtml(data.name)}</div>
      <div class="character-panel__meta">
        <span class="character-panel__level"><small>Poziom</small>${data.level}</span>
        <span class="character-panel__meta-divider" aria-hidden="true"></span>
        <span class="character-panel__class">${escapeHtml(getClassName(data.classId))}</span>
      </div>
    `;

    this.worn = new Map(
      data.equipment.filter((e) => e.itemId).map((e) => [e.slotId, e] as const),
    );
    this.renderDoll();

    this.unspentAttrPoints = Math.max(0, data.unspentAttrPoints);
    if (this.unspentAttrPoints > 0) {
      this.pointsEl.hidden = false;
      this.pointsEl.innerHTML = `<span>${this.unspentAttrPoints}</span><small>wolne</small>`;
    } else {
      this.pointsEl.hidden = true;
      this.pointsEl.replaceChildren();
    }

    this.attrsEl.innerHTML = ATTR_ORDER.map((key, index) => {
      const value = data[key];
      const plus =
        this.unspentAttrPoints > 0
          ? `<button type="button" class="character-panel__attr-plus" data-attr="${key}" aria-label="Dodaj punkt do ${ATTR_LABELS[key]}">+</button>`
          : "";
      return `
        <div class="character-panel__stat-row character-panel__stat-row--attr" data-attr-tip="${key}">
          <span class="character-panel__attr-index">${String(index + 1).padStart(2, "0")}</span>
          <span class="character-panel__attr-name">${ATTR_LABELS[key]}</span>
          <strong>${value}</strong>
          ${plus}
        </div>
      `;
    }).join("");

    const ratio = hpRatio(data.hp, data.maxHp);
    const durableEquipment = data.equipment.filter(
      (slot) => slot.itemId && slot.maxDurability > 0,
    );
    const durabilityCurrent = durableEquipment.reduce(
      (sum, slot) => sum + slot.durability,
      0,
    );
    const durabilityMaximum = durableEquipment.reduce(
      (sum, slot) => sum + slot.maxDurability,
      0,
    );
    const durabilityPercent =
      durabilityMaximum > 0
        ? Math.round((durabilityCurrent / durabilityMaximum) * 100)
        : 100;
    const brokenCount = durableEquipment.filter(
      (slot) => slot.durability <= 0,
    ).length;
    const durabilityTier =
      brokenCount > 0
        ? "broken"
        : durabilityPercent <= 30
          ? "critical"
          : durabilityPercent <= 65
            ? "worn"
            : "healthy";

    this.derivedEl.innerHTML = `
      <div class="character-panel__vitality">
        <div class="character-panel__vitality-heading">
          <span><i aria-hidden="true">✚</i> Życie</span>
          <strong>${formatHp(data.hp, data.maxHp)}</strong>
        </div>
        <div class="character-panel__hp-track">
          <div class="character-panel__hp-fill" data-tier="${hpTier(ratio)}" style="width:${ratio * 100}%"></div>
        </div>
      </div>
      <div class="character-panel__metrics">
        <div class="character-panel__metric character-panel__metric--wide">
          <span class="character-panel__metric-icon" aria-hidden="true">⚔</span>
          <span>Obrażenia</span>
          <strong>${data.damageMin}–${data.damageMax}</strong>
        </div>
        <div class="character-panel__metric">
          <span class="character-panel__metric-icon" aria-hidden="true">◆</span>
          <span>Siła ataku</span>
          <strong>${data.attackPower}</strong>
        </div>
        <div class="character-panel__metric">
          <span class="character-panel__metric-icon" aria-hidden="true">➶</span>
          <span>Szybkość</span>
          <strong>${data.moveSpeed}</strong>
        </div>
        <div class="character-panel__metric">
          <span class="character-panel__metric-icon" aria-hidden="true">◈</span>
          <span>Pancerz</span>
          <strong>${data.armor}</strong>
        </div>
        <div class="character-panel__metric">
          <span class="character-panel__metric-icon" aria-hidden="true">◇</span>
          <span>Redukcja</span>
          <strong>${armorReductionLabel(data.armor)}</strong>
        </div>
      </div>
      <div class="character-panel__gear-condition" data-tier="${durabilityTier}">
        <div class="character-panel__gear-condition-heading">
          <span><i aria-hidden="true">⬡</i> Stan wyposażenia</span><strong>${durabilityPercent}%</strong>
        </div>
        <div class="character-panel__gear-condition-track"><span style="width:${durabilityPercent}%"></span></div>
        <small>${brokenCount > 0 ? `${brokenCount} ${brokenCount === 1 ? "przedmiot uszkodzony" : "przedmioty uszkodzone"} — odwiedź kowala` : `${durabilityCurrent} / ${durabilityMaximum || 0} trwałości`}</small>
      </div>
    `;
  }

  /** Spend free points via + buttons (delegated — rows re-render on sheet sync). */
  private bindAttrClicks(): void {
    this.attrsEl.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const btn = target.closest<HTMLElement>("[data-attr]");
      if (!btn || !this.attrsEl.contains(btn)) return;
      const attr = btn.dataset.attr;
      if (!attr || !ATTR_ORDER.includes(attr as (typeof ATTR_ORDER)[number])) {
        return;
      }
      if (this.unspentAttrPoints <= 0) return;
      this.handlers.onAllocateAttribute(attr as (typeof ATTR_ORDER)[number]);
    });
  }

  /** Attribute name / value hover — shows what the stat does. */
  private bindAttrHover(): void {
    this.attrsEl.addEventListener("pointerover", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      // Don't steal focus from the + button's own aria label mid-click.
      if (target.closest(".character-panel__attr-plus")) return;
      const row = target.closest<HTMLElement>("[data-attr-tip]");
      if (!row || !this.attrsEl.contains(row)) return;
      const attr = row.dataset.attrTip as keyof PlayerAttributes | undefined;
      if (!attr || !(attr in ATTR_LABELS)) return;

      const tip = describeAttribute(attr, getClass(this.classId).derived);
      this.tooltip.showInfo(
        tip.title,
        tip.effect,
        tip.flavor,
        event.clientX,
        event.clientY,
      );
    });

    this.attrsEl.addEventListener("pointermove", (event) => {
      if (!(event.target instanceof HTMLElement)) return;
      if (!event.target.closest("[data-attr-tip]")) return;
      this.tooltip.moveTo(event.clientX, event.clientY);
    });

    this.attrsEl.addEventListener("pointerleave", () => this.tooltip.hide());
    this.attrsEl.addEventListener("pointerout", (event) => {
      const related = event.relatedTarget;
      if (related instanceof Node && this.attrsEl.contains(related)) return;
      this.tooltip.hide();
    });
  }

  /** Icons, tooltips and drag targets for the paper-doll slots. */
  private bindSlots(): void {
    for (const btn of this.dollEl.querySelectorAll<HTMLElement>(
      "[data-slot]",
    )) {
      const slotId = btn.dataset.slot!;

      btn.addEventListener("dragover", (event) => {
        if (!event.dataTransfer?.types.includes(DRAG_SLOT_MIME)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        btn.classList.add("character-panel__slot--drag-over");
      });
      btn.addEventListener("dragleave", () => {
        btn.classList.remove("character-panel__slot--drag-over");
      });
      btn.addEventListener("drop", (event) => this.onSlotDrop(slotId, event));

      // Double-click mirrors the bag's auto-equip; right-click is the shortcut
      // players coming from WoW reach for first.
      btn.addEventListener("dblclick", () => this.unequip(slotId));
      btn.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.unequip(slotId);
      });

      btn.addEventListener("dragstart", (event) =>
        this.onSlotDragStart(slotId, event),
      );
      btn.addEventListener("dragend", () => {
        btn.classList.remove("character-panel__slot--dragging");
      });

      btn.addEventListener("pointerenter", (event) => {
        const instance = this.worn.get(slotId);
        if (!instance || !hasItem(instance.itemId)) return;
        this.tooltip.show(
          getItem(instance.itemId),
          1,
          event.clientX,
          event.clientY,
          instance,
        );
      });
      btn.addEventListener("pointermove", (event) => {
        this.tooltip.moveTo(event.clientX, event.clientY);
      });
      btn.addEventListener("pointerleave", () => this.tooltip.hide());
    }
  }

  private onSlotDragStart(slotId: string, event: DragEvent): void {
    const instance = this.worn.get(slotId);
    if (!instance || !hasItem(instance.itemId) || !event.dataTransfer) {
      event.preventDefault();
      return;
    }

    this.tooltip.hide();
    this.dollEl
      .querySelector(`[data-slot="${slotId}"]`)
      ?.classList.add("character-panel__slot--dragging");

    // Payload is the slotId — the inventory side only needs to know what to
    // take off, not what it contains.
    event.dataTransfer.setData(DRAG_EQUIP_MIME, slotId);
    event.dataTransfer.effectAllowed = "move";

    const item = getItem(instance.itemId);
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

  private unequip(slotId: string): void {
    if (!this.worn.get(slotId)) return;
    this.tooltip.hide();
    this.handlers.onUnequip(slotId);
  }

  private onSlotDrop(slotId: string, event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dollEl
      .querySelector(`[data-slot="${slotId}"]`)
      ?.classList.remove("character-panel__slot--drag-over");

    const raw =
      event.dataTransfer?.getData(DRAG_SLOT_MIME) ||
      event.dataTransfer?.getData("text/plain");
    if (!raw) return;

    const fromIndex = Number(raw);
    if (!Number.isInteger(fromIndex)) return;

    const slot = this.inventory.getSlot(fromIndex);
    if (!slot?.itemId || !hasItem(slot.itemId)) return;
    // Reject the obvious mismatch here; the server validates it again anyway.
    if (getItem(slot.itemId).slot !== slotId) return;

    this.handlers.onEquip(fromIndex, slotId);
  }

  private renderDoll(): void {
    this.tooltip.hide();
    for (const btn of this.dollEl.querySelectorAll<HTMLElement>(
      "[data-slot]",
    )) {
      const slotId = btn.dataset.slot!;
      const label = EQUIPMENT_SLOT_LABELS[slotId] ?? slotId;
      const instance = this.worn.get(slotId);

      btn.replaceChildren();
      btn.classList.remove("character-panel__slot--uncommon");
      btn.classList.remove("character-panel__slot--broken");

      if (!instance || !hasItem(instance.itemId)) {
        btn.classList.remove("character-panel__slot--filled");
        btn.removeAttribute("draggable");
        btn.setAttribute("aria-label", label);
        const text = document.createElement("span");
        text.className = "character-panel__slot-label";
        text.textContent = shortLabel(slotId);
        btn.appendChild(text);
        btn.appendChild(createSlotName(label));
        continue;
      }

      const item = getItem(instance.itemId);
      btn.classList.add("character-panel__slot--filled");
      btn.classList.toggle(
        "character-panel__slot--uncommon",
        instance.rarity === "uncommon",
      );
      btn.setAttribute("aria-label", `${label}: ${item.name}`);
      const broken = instance.maxDurability > 0 && instance.durability <= 0;
      btn.classList.toggle("character-panel__slot--broken", broken);

      const icon = document.createElement("img");
      icon.className = "character-panel__slot-icon";
      icon.src = `/${item.icon}`;
      icon.alt = "";
      icon.draggable = false;
      btn.appendChild(icon);
      btn.appendChild(createSlotName(label));
      if (instance.maxDurability > 0) {
        const track = document.createElement("span");
        track.className = "character-panel__durability";
        const fill = document.createElement("span");
        fill.style.width = `${Math.max(0, Math.min(100, (instance.durability / instance.maxDurability) * 100))}%`;
        track.appendChild(fill);
        btn.appendChild(track);
        const value = document.createElement("span");
        value.className = "character-panel__durability-value";
        value.textContent = `${Math.round((instance.durability / instance.maxDurability) * 100)}%`;
        btn.appendChild(value);
      }
      btn.draggable = true;
    }
  }

  private buildDoll(): void {
    this.dollEl.innerHTML = `
      <div class="character-panel__doll-col character-panel__doll-col--left">
        ${DOLL_LEFT.map(slotMarkup).join("")}
      </div>
      <div class="character-panel__figure">
        <span class="character-panel__figure-rune" aria-hidden="true">ᛉ</span>
        <div class="character-panel__figure-stage" aria-hidden="true">
          <img class="character-panel__figure-sprite" src="${figureSrc(this.classId)}" alt="" draggable="false" />
        </div>
        <span class="character-panel__figure-caption">Sylwetka</span>
      </div>
      <div class="character-panel__doll-col character-panel__doll-col--right">
        ${DOLL_RIGHT.map(slotMarkup).join("")}
      </div>
      <div class="character-panel__doll-rack">
        ${DOLL_BOTTOM.map(slotMarkup).join("")}
      </div>
    `;
  }
}

function slotMarkup(slotId: string): string {
  const label = EQUIPMENT_SLOT_LABELS[slotId] ?? slotId;
  return `
    <button type="button" class="character-panel__slot" data-slot="${slotId}" aria-label="${escapeHtml(label)}">
      <span class="character-panel__slot-label">${shortLabel(slotId)}</span>
      <span class="character-panel__slot-name">${escapeHtml(label)}</span>
    </button>
  `;
}

function createSlotName(label: string): HTMLSpanElement {
  const name = document.createElement("span");
  name.className = "character-panel__slot-name";
  name.textContent = label;
  return name;
}

/** Mirrors damageReduction() in the server's armorConfig. */
function armorReductionLabel(armor: number): string {
  if (armor <= 0) return "0%";
  return `${Math.round((armor / (armor + 100)) * 100)}%`;
}

function shortLabel(slotId: string): string {
  const map: Record<string, string> = {
    head: "Gł",
    neck: "Sz",
    shoulders: "Ra",
    back: "Pl",
    chest: "To",
    wrists: "Na",
    hands: "Dl",
    waist: "Pa",
    legs: "No",
    feet: "St",
    finger1: "P1",
    finger2: "P2",
    trinket1: "T1",
    trinket2: "T2",
    mainHand: "B",
    offHand: "L",
  };
  return map[slotId] ?? "?";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
