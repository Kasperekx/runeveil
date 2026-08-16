import {
  getClass,
  EQUIPMENT_SLOT_LABELS,
  ATTR_LABELS,
  describeAttribute,
} from "../../content/classes";
import type { AttrId, PlayerAttributes } from "../../content/classes";
import {
  CHARACTER_PANEL_CLOSE_MS,
  DRAG_EQUIP_MIME,
  DRAG_SLOT_MIME,
} from "../../config/constants";
import { RESOURCE_LABELS, parseResourceKind } from "../../config/resource";
import type { Inventory } from "../../inventory/Inventory";
import {
  getItem,
  hasItem,
  type ItemAffix,
  type ItemRarity,
} from "../../content/items";
import { ItemTooltip } from "../inventory/ItemTooltip";
import { makeDraggable } from "../makeDraggable";
import { formatHp, hpRatio, hpTier } from "../hud/vitals";

export interface CharacterSheetData {
  name: string;
  classId: string;
  level: number;
  experience: number;
  experienceToLevel: number;
  hp: number;
  maxHp: number;
  resourceKind: string;
  resource: number;
  maxResource: number;
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
  /** Gear + food contribution already included in the totals above. */
  bonusAttributes: PlayerAttributes;
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
  onAllocateAttribute: (attr: AttrId) => void;
}

interface Tip {
  title: string;
  effect: string | string[];
  flavor: string;
}

const ATTR_ORDER: AttrId[] = [
  "strength",
  "agility",
  "stamina",
  "intellect",
  "spirit",
];

/** Left rail of the figure, top to bottom. */
const DOLL_LEFT = [
  "head",
  "neck",
  "shoulders",
  "back",
  "chest",
  "wrists",
] as const;

/** Right rail of the figure, top to bottom. */
const DOLL_RIGHT = [
  "hands",
  "waist",
  "legs",
  "feet",
  "finger1",
  "finger2",
] as const;

/** Bottom rack: weapons centred, trinkets flanking them. */
const DOLL_RACK = ["trinket1", "mainHand", "offHand", "trinket2"] as const;

const SLOT_COUNT = DOLL_LEFT.length + DOLL_RIGHT.length + DOLL_RACK.length;

/**
 * Engraved into every empty well so the sheet reads as a wardrobe map rather
 * than a grid of holes. Paired slots share a caption — position tells them apart.
 */
const SLOT_CAPTIONS: Record<string, string> = {
  head: "Głowa",
  neck: "Szyja",
  shoulders: "Barki",
  back: "Plecy",
  chest: "Tors",
  wrists: "Karwasze",
  hands: "Dłonie",
  waist: "Pas",
  legs: "Nogi",
  feet: "Stopy",
  finger1: "Sygnet",
  finger2: "Sygnet",
  trinket1: "Talizman",
  trinket2: "Talizman",
  mainHand: "Broń",
  offHand: "Lewa ręka",
};

/** Hover copy for empty wells: what actually goes in there. */
const SLOT_HINTS: Record<string, string> = {
  head: "Hełmy, kaptury i korony.",
  neck: "Amulety i naszyjniki.",
  shoulders: "Naramienniki i płytki barkowe.",
  back: "Płaszcze i peleryny.",
  chest: "Kolczugi, kaftany i szaty.",
  wrists: "Karwasze i bransolety.",
  hands: "Rękawice i mitenki.",
  waist: "Pasy i przepaski.",
  legs: "Nogawice, spodnie i kilty.",
  feet: "Buty, ciżmy i sandały.",
  finger1: "Pierścienie i sygnety.",
  finger2: "Pierścienie i sygnety.",
  trinket1: "Talizmany i drobne relikwie.",
  trinket2: "Talizmany i drobne relikwie.",
  mainHand: "Miecze, topory i kilofy.",
  offHand: "Tarcze i broń drugoręczna.",
};

const EQUIP_HOWTO =
  "Przeciągnij przedmiot z plecaka albo kliknij go dwukrotnie.";

/** Shown in the stone niche as the character silhouette. */
function figureSrc(classId: string): string {
  return classId === "knight"
    ? "/assets/players/leather-knight/knight-idle-down.png"
    : "/assets/players/human-warrior-v2/warrior-idle-down.png";
}

/**
 * Paper-doll sheet: engraved wells label every gear placement, the register on
 * the right spells out attributes and combat readiness, and dragging a wearable
 * out of the bag lights up the one well it fits. Toggle with C.
 */
export class CharacterPanel {
  private readonly root: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly dollEl: HTMLElement;
  private readonly gearEl: HTMLElement;
  private readonly pointsEl: HTMLElement;
  private readonly attrsEl: HTMLElement;
  private readonly combatEl: HTMLElement;
  private readonly vitalsEl: HTMLElement;
  private open = false;
  private lastKey = "";
  private closeTimer: number | null = null;
  private readonly tooltip: ItemTooltip;
  /** Latest worn gear, so hover/right-click can act without re-reading DOM. */
  private worn = new Map<string, CharacterSheetData["equipment"][number]>();
  /** Hover copy for attribute and combat rows, refreshed on every sync. */
  private readonly tips = new Map<string, Tip>();
  private unspentAttrPoints = 0;
  private classId = "warrior";
  private level = 1;

  private constructor(
    root: HTMLElement,
    private readonly inventory: Inventory,
    private readonly handlers: EquipHandlers,
  ) {
    this.root = root;
    this.bodyEl = root.querySelector("[data-body]")!;
    this.dollEl = root.querySelector("[data-doll]")!;
    this.gearEl = root.querySelector("[data-gear]")!;
    this.pointsEl = root.querySelector("[data-points]")!;
    this.attrsEl = root.querySelector("[data-attrs]")!;
    this.combatEl = root.querySelector("[data-combat]")!;
    this.vitalsEl = root.querySelector("[data-vitals]")!;
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
        <span class="character-panel__corner character-panel__corner--tl" aria-hidden="true"></span>
        <span class="character-panel__corner character-panel__corner--tr" aria-hidden="true"></span>
        <span class="character-panel__corner character-panel__corner--bl" aria-hidden="true"></span>
        <span class="character-panel__corner character-panel__corner--br" aria-hidden="true"></span>
        <header class="character-panel__header" data-header>
          <span class="character-panel__sigil" aria-hidden="true"><span>ᚲ</span></span>
          <div class="character-panel__titles">
            <span class="character-panel__eyebrow" data-eyebrow>Karta postaci</span>
            <h2 class="character-panel__title">Postać</h2>
          </div>
          <span class="character-panel__rule" aria-hidden="true"></span>
          <button type="button" class="character-panel__close" data-close aria-label="Zamknij">
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div class="character-panel__body" data-body>
          <section class="character-panel__gear-side">
            <div class="character-panel__identity">
              <span class="character-panel__portrait-well">
                <img class="character-panel__portrait" data-portrait alt="" draggable="false" hidden />
                <b class="character-panel__level" data-level>1</b>
              </span>
              <div class="character-panel__identity-copy">
                <span class="character-panel__class" data-class></span>
                <h3 class="character-panel__name" data-name></h3>
                <div class="character-panel__xp">
                  <span class="character-panel__xp-track" aria-hidden="true">
                    <span class="character-panel__xp-fill" data-xp-fill></span>
                  </span>
                  <span class="character-panel__xp-text" data-xp-text></span>
                </div>
              </div>
            </div>
            <div class="character-panel__doll" data-doll></div>
            <div class="character-panel__gear" data-gear></div>
          </section>
          <section class="character-panel__register">
            <div class="character-panel__heading">
              <span>Rdzeń</span>
              <h4>Atrybuty</h4>
              <b class="character-panel__points" data-points hidden></b>
            </div>
            <div class="character-panel__rows" data-attrs></div>
            <div class="character-panel__heading">
              <span>Walka</span>
              <h4>Gotowość</h4>
            </div>
            <div class="character-panel__rows" data-combat></div>
            <div class="character-panel__heading">
              <span>Ciało</span>
              <h4>Żywotność</h4>
            </div>
            <div class="character-panel__vitals" data-vitals></div>
          </section>
        </div>
      </div>
    `;
    host.appendChild(root);

    const panel = new CharacterPanel(root, inventory, handlers);

    root.querySelector("[data-close]")!.addEventListener("click", () => {
      panel.close();
    });

    makeDraggable(root, root.querySelector("[data-header]") as HTMLElement);
    panel.buildDoll();
    panel.bindSlots();
    panel.bindAttrClicks();
    panel.bindHover();
    panel.bindBagDragCallout();
    panel.renderDoll();
    panel.renderGearSummary();
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
    this.level = data.level;
    this.renderIdentity(data);

    this.worn = new Map(
      data.equipment.filter((e) => e.itemId).map((e) => [e.slotId, e] as const),
    );
    this.renderDoll();
    this.renderGearSummary();

    this.unspentAttrPoints = Math.max(0, data.unspentAttrPoints);
    this.renderAttributes(data);
    this.renderCombat(data);
    this.renderVitals(data);
  }

  private renderIdentity(data: CharacterSheetData): void {
    const cls = getClass(data.classId);
    const set = (selector: string, text: string) => {
      const el = this.root.querySelector<HTMLElement>(selector);
      if (el) el.textContent = text;
    };
    set("[data-name]", data.name);
    set("[data-class]", `${cls.name} · ${cls.selection.role}`);
    set("[data-eyebrow]", "Karta postaci");
    set("[data-level]", String(data.level));

    const levelEl = this.root.querySelector<HTMLElement>("[data-level]");
    levelEl?.setAttribute("aria-label", `Poziom ${data.level}`);

    const portraitEl =
      this.root.querySelector<HTMLImageElement>("[data-portrait]");
    if (portraitEl) {
      const src = data.portrait
        ? data.portrait.startsWith("/")
          ? data.portrait
          : `/${data.portrait}`
        : "";
      if (src && portraitEl.getAttribute("src") !== src) portraitEl.src = src;
      portraitEl.hidden = !src;
    }

    const figure = this.dollEl.querySelector<HTMLImageElement>(
      ".character-panel__figure-sprite",
    );
    if (figure) figure.src = figureSrc(data.classId);

    const xpFill = this.root.querySelector<HTMLElement>("[data-xp-fill]");
    const xpText = this.root.querySelector<HTMLElement>("[data-xp-text]");
    const capped = data.experienceToLevel <= 0;
    const xpRatio = capped
      ? 1
      : Math.max(0, Math.min(1, data.experience / data.experienceToLevel));
    if (xpFill) xpFill.style.width = `${xpRatio * 100}%`;
    if (xpText) {
      xpText.textContent = capped
        ? "Szczyt poziomów"
        : `${data.experience} / ${data.experienceToLevel} PD · ${Math.floor(xpRatio * 100)}%`;
      xpText.title = capped
        ? ""
        : `Do ${data.level + 1} poziomu brakuje ${Math.max(0, data.experienceToLevel - data.experience)} PD`;
    }
  }

  private renderAttributes(data: CharacterSheetData): void {
    const derived = getClass(this.classId).derived;

    this.attrsEl.innerHTML = ATTR_ORDER.map((attr) => {
      const total = data[attr];
      const bonus = Math.max(0, data.bonusAttributes[attr] ?? 0);
      const info = describeAttribute(attr, derived);
      const effect = [info.effect];
      if (bonus > 0) {
        effect.push(
          `Baza ${total - bonus} + ${bonus} z ekwipunku i posiłków = ${total}.`,
        );
      }
      this.tips.set(`attr:${attr}`, {
        title: info.title,
        effect,
        flavor: info.flavor,
      });

      const plus =
        this.unspentAttrPoints > 0
          ? `<button type="button" class="character-panel__plus" data-attr="${attr}" aria-label="Dodaj punkt do ${escapeHtml(ATTR_LABELS[attr])}">+</button>`
          : "";
      return `
        <div class="character-panel__row character-panel__row--attr" data-tip="attr:${attr}">
          <span class="character-panel__row-label">${escapeHtml(ATTR_LABELS[attr])}</span>
          <strong class="character-panel__row-value">${total}</strong>
          <em class="character-panel__row-bonus">${bonus > 0 ? `+${bonus}` : ""}</em>
          ${plus}
        </div>
      `;
    }).join("");

    this.attrsEl.classList.toggle(
      "character-panel__rows--spending",
      this.unspentAttrPoints > 0,
    );

    if (this.unspentAttrPoints > 0) {
      this.pointsEl.hidden = false;
      this.pointsEl.textContent = `${this.unspentAttrPoints} pkt`;
      this.pointsEl.setAttribute(
        "aria-label",
        `${this.unspentAttrPoints} wolnych punktów atrybutów`,
      );
      this.attrsEl.insertAdjacentHTML(
        "beforeend",
        `<p class="character-panel__note">Kliknij <b>+</b>, aby rozdać wolne punkty.</p>`,
      );
    } else {
      this.pointsEl.hidden = true;
      this.pointsEl.textContent = "";
      this.pointsEl.removeAttribute("aria-label");
    }
  }

  private renderCombat(data: CharacterSheetData): void {
    const reduction = armorReductionLabel(data.armor);
    const rows: Array<{ id: string; label: string; value: string; tip: Tip }> =
      [
        {
          id: "damage",
          label: "Obrażenia",
          value: `${data.damageMin}–${data.damageMax}`,
          tip: {
            title: "Obrażenia",
            effect: [
              "Zakres jednego uderzenia auto-ataku.",
              "Sumuje broń w głównej dłoni i premię z Siły.",
            ],
            flavor: "Każdy cios losuje wartość z tego zakresu.",
          },
        },
        {
          id: "attack",
          label: "Moc ataku",
          value: String(data.attackPower),
          tip: {
            title: "Moc ataku",
            effect: [
              "Średnia siła ciosu wyliczona z klasy, Siły i broni.",
              "Umiejętności skalują się z tą wartością.",
            ],
            flavor: "Miara tego, jak mocno bijesz bez szczęścia w rzucie.",
          },
        },
        {
          id: "armor",
          label: "Pancerz",
          value: String(data.armor),
          tip: {
            title: "Pancerz",
            effect: [
              "Suma pancerza sprawnych części ekwipunku.",
              `Obecnie tnie obrażenia o ${reduction}.`,
            ],
            flavor: "Zepsute części nie liczą się do sumy.",
          },
        },
        {
          id: "reduction",
          label: "Redukcja",
          value: reduction,
          tip: {
            title: "Redukcja obrażeń",
            effect: [
              `Pancerz ${data.armor} zmniejsza otrzymywane obrażenia o ${reduction}.`,
              "Wzór: pancerz / (pancerz + 100).",
            ],
            flavor: "Każdy kolejny punkt pancerza daje trochę mniej.",
          },
        },
        {
          id: "speed",
          label: "Szybkość",
          value: `${data.moveSpeed} px/s`,
          tip: {
            title: "Szybkość marszu",
            effect: ["Tempo poruszania się po świecie.", "Rośnie z poziomem."],
            flavor: "Ucieczka też jest taktyką.",
          },
        },
      ];

    for (const row of rows) this.tips.set(`combat:${row.id}`, row.tip);

    this.combatEl.innerHTML = rows
      .map(
        (row) => `
        <div class="character-panel__row" data-tip="combat:${row.id}">
          <span class="character-panel__row-label">${escapeHtml(row.label)}</span>
          <strong class="character-panel__row-value">${escapeHtml(row.value)}</strong>
        </div>
      `,
      )
      .join("");
  }

  private renderVitals(data: CharacterSheetData): void {
    const ratio = hpRatio(data.hp, data.maxHp);
    const kind = parseResourceKind(data.resourceKind);
    const hasResource = kind !== "none" && data.maxResource > 0;
    const resourceRatio = hasResource
      ? Math.max(0, Math.min(1, data.resource / data.maxResource))
      : 0;

    this.vitalsEl.innerHTML = `
      <div class="character-panel__bar">
        <span class="character-panel__bar-label">Życie</span>
        <strong class="character-panel__bar-value">${formatHp(data.hp, data.maxHp)}</strong>
        <span class="character-panel__bar-track">
          <span class="character-panel__bar-fill" data-tier="${hpTier(ratio)}" style="width:${ratio * 100}%"></span>
        </span>
      </div>
      ${
        hasResource
          ? `<div class="character-panel__bar">
        <span class="character-panel__bar-label">${escapeHtml(RESOURCE_LABELS[kind])}</span>
        <strong class="character-panel__bar-value">${data.resource} / ${data.maxResource}</strong>
        <span class="character-panel__bar-track">
          <span class="character-panel__bar-fill character-panel__bar-fill--${kind}" style="width:${resourceRatio * 100}%"></span>
        </span>
      </div>`
          : ""
      }
    `;
  }

  /** Equipment ledger under the doll: coverage, wear and broken pieces. */
  private renderGearSummary(): void {
    const worn = [...this.worn.values()].filter((e) => hasItem(e.itemId));
    const wearing = worn.filter((e) => e.maxDurability > 0);
    const broken = wearing.filter((e) => e.durability <= 0).length;
    const wear =
      wearing.length === 0
        ? null
        : Math.round(
            (wearing.reduce(
              (sum, e) => sum + e.durability / e.maxDurability,
              0,
            ) /
              wearing.length) *
              100,
          );

    const chips = [
      `<span class="character-panel__chip"><i>Założone</i><b>${worn.length} / ${SLOT_COUNT}</b></span>`,
      wear === null
        ? ""
        : `<span class="character-panel__chip"><i>Trwałość</i><b>${wear}%</b></span>`,
      broken > 0
        ? `<span class="character-panel__chip character-panel__chip--alert"><i>Zepsute</i><b>${broken}</b></span>`
        : "",
    ];

    this.gearEl.innerHTML = chips.filter(Boolean).join("");
  }

  /** Spend free points via + buttons (delegated — rows re-render on sheet sync). */
  private bindAttrClicks(): void {
    this.attrsEl.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const btn = target.closest<HTMLElement>("[data-attr]");
      if (!btn || !this.attrsEl.contains(btn)) return;
      const attr = btn.dataset.attr as AttrId | undefined;
      if (!attr || !ATTR_ORDER.includes(attr)) return;
      if (this.unspentAttrPoints <= 0) return;
      this.handlers.onAllocateAttribute(attr);
    });
  }

  /** One delegated hover for gear wells, attribute rows and combat rows. */
  private bindHover(): void {
    this.bodyEl.addEventListener("pointerover", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if (target.closest(".character-panel__plus")) {
        this.tooltip.hide();
        return;
      }

      const slot = target.closest<HTMLElement>("[data-slot]");
      if (slot) {
        this.showSlotTip(slot.dataset.slot!, event.clientX, event.clientY);
        return;
      }

      const row = target.closest<HTMLElement>("[data-tip]");
      const tip = row ? this.tips.get(row.dataset.tip!) : undefined;
      if (tip) {
        this.tooltip.showInfo(
          tip.title,
          tip.effect,
          tip.flavor,
          event.clientX,
          event.clientY,
        );
        return;
      }

      this.tooltip.hide();
    });

    this.bodyEl.addEventListener("pointermove", (event) => {
      this.tooltip.moveTo(event.clientX, event.clientY);
    });
    this.bodyEl.addEventListener("pointerleave", () => this.tooltip.hide());
  }

  private showSlotTip(slotId: string, clientX: number, clientY: number): void {
    const instance = this.worn.get(slotId);
    if (instance && hasItem(instance.itemId)) {
      this.tooltip.show(
        getItem(instance.itemId),
        1,
        clientX,
        clientY,
        instance,
      );
      return;
    }

    const label = EQUIPMENT_SLOT_LABELS[slotId] ?? slotId;
    this.tooltip.showInfo(
      `${label} — puste`,
      [SLOT_HINTS[slotId] ?? "Gniazdo ekwipunku."],
      EQUIP_HOWTO,
      clientX,
      clientY,
    );
  }

  /**
   * Dragging a wearable out of the bag lights up the well it belongs to and
   * dims the rest, so nobody has to guess where a new piece goes.
   */
  private bindBagDragCallout(): void {
    document.addEventListener("dragstart", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const raw =
        target.closest<HTMLElement>("[data-slot-index]")?.dataset.slotIndex;
      if (raw === undefined) return;

      const bagSlot = this.inventory.getSlot(Number(raw));
      if (!bagSlot?.itemId || !hasItem(bagSlot.itemId)) return;
      const item = getItem(bagSlot.itemId);
      if (!item.slot) return;

      this.root.classList.add("is-fitting");
      const fits = this.dollEl.querySelector<HTMLElement>(
        `[data-slot="${item.slot}"]`,
      );
      const locked = item.requiredLevel > this.level;
      fits?.classList.add(
        locked ? "character-panel__slot--locked" : "character-panel__slot--fit",
      );
      if (item.twoHanded && !locked) {
        this.dollEl
          .querySelector('[data-slot="offHand"]')
          ?.classList.add("character-panel__slot--yield");
      }
    });

    document.addEventListener("dragend", () => this.clearDragCallout());
    document.addEventListener("drop", () => this.clearDragCallout());
  }

  private clearDragCallout(): void {
    this.root.classList.remove("is-fitting");
    for (const btn of this.dollEl.querySelectorAll<HTMLElement>(
      "[data-slot]",
    )) {
      btn.classList.remove(
        "character-panel__slot--fit",
        "character-panel__slot--locked",
        "character-panel__slot--yield",
      );
    }
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
      btn.classList.remove(
        "character-panel__slot--uncommon",
        "character-panel__slot--rare",
        "character-panel__slot--epic",
        "character-panel__slot--broken",
        "character-panel__slot--worn",
      );

      if (!instance || !hasItem(instance.itemId)) {
        btn.classList.remove("character-panel__slot--filled");
        btn.removeAttribute("draggable");
        btn.setAttribute("aria-label", `${label}: puste`);
        const caption = document.createElement("span");
        caption.className = "character-panel__slot-caption";
        caption.textContent = SLOT_CAPTIONS[slotId] ?? label;
        btn.appendChild(caption);
        continue;
      }

      const item = getItem(instance.itemId);
      btn.classList.add("character-panel__slot--filled");
      if (instance.rarity === "uncommon" || instance.rarity === "rare") {
        btn.classList.add(`character-panel__slot--${instance.rarity}`);
      } else if (instance.rarity === "epic") {
        btn.classList.add("character-panel__slot--epic");
      }
      btn.setAttribute("aria-label", `${label}: ${item.name}`);

      const icon = document.createElement("img");
      icon.className = "character-panel__slot-icon";
      icon.src = `/${item.icon}`;
      icon.alt = "";
      icon.draggable = false;
      btn.appendChild(icon);

      if (instance.maxDurability > 0) {
        const ratio = Math.max(
          0,
          Math.min(1, instance.durability / instance.maxDurability),
        );
        btn.classList.toggle("character-panel__slot--broken", ratio <= 0);
        btn.classList.toggle(
          "character-panel__slot--worn",
          ratio > 0 && ratio <= 0.25,
        );
        const track = document.createElement("span");
        track.className = "character-panel__durability";
        const fill = document.createElement("span");
        fill.style.width = `${ratio * 100}%`;
        track.appendChild(fill);
        btn.appendChild(track);
      }
      btn.draggable = true;
    }
  }

  private buildDoll(): void {
    this.dollEl.innerHTML = `
      <div class="character-panel__rail character-panel__rail--left">
        ${DOLL_LEFT.map(slotMarkup).join("")}
      </div>
      <div class="character-panel__figure">
        <div class="character-panel__figure-stage" aria-hidden="true">
          <img class="character-panel__figure-sprite" src="${figureSrc(this.classId)}" alt="" draggable="false" />
        </div>
      </div>
      <div class="character-panel__rail character-panel__rail--right">
        ${DOLL_RIGHT.map(slotMarkup).join("")}
      </div>
      <div class="character-panel__rack">
        ${DOLL_RACK.map(slotMarkup).join("")}
      </div>
    `;
  }
}

function slotMarkup(slotId: string): string {
  const label = EQUIPMENT_SLOT_LABELS[slotId] ?? slotId;
  return `<button type="button" class="character-panel__slot" data-slot="${slotId}" aria-label="${escapeHtml(label)}: puste"></button>`;
}

/** Mirrors damageReduction() in the server's armorConfig. */
function armorReductionLabel(armor: number): string {
  if (armor <= 0) return "0%";
  return `${Math.round((armor / (armor + 100)) * 100)}%`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
