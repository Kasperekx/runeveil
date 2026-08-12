import {
  DRAG_ACTION_MIME,
  DRAG_SKILL_MIME,
  DRAG_SLOT_MIME,
} from "../config/constants";
import type { KeyboardInput } from "../input/KeyboardInput";
import type { Inventory } from "../inventory/Inventory";
import {
  getItem,
  hasItem,
  isUsableItem,
  itemIdsMatch,
  canonicalItemId,
  type ItemId,
} from "../items/catalog";
import {
  getSkill,
  hasSkill,
  skillDamageRange,
  skillUsableByClass,
  type SkillId,
} from "../skills/catalog";
import { getClass } from "../classes/catalog";
import { RESOURCE_LABELS, parseResourceKind } from "../config/resource";
import type { ItemCooldowns } from "./ItemCooldowns";
import type { SkillCooldowns } from "./SkillCooldowns";
import { ItemTooltip } from "./inventory/ItemTooltip";

const SLOT_COUNT = 10;
const STORAGE_KEY = "mmo.actionBar";
const DEFAULT_SKILL_ID = "sweeping_strike";
/** Displayed key cap per slot; the tenth slot is bound to 0. */
const KEY_CAPS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

export type ActionBarAssignment =
  { type: "item"; id: ItemId } | { type: "skill"; id: SkillId } | null;

/**
 * Heraldic wing flanking the bar — the project has no gryphon art, so the
 * end caps are drawn inline and mirrored for the right-hand side.
 *
 * The gradient id is per-instance: two copies sharing one id would be invalid
 * markup, and every reference would resolve to whichever landed first.
 */
function emblemSvg(id: string): string {
  return `
  <svg class="action-bar__emblem-svg" viewBox="0 0 44 60" aria-hidden="true">
    <defs>
      <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f0d492" />
        <stop offset="0.45" stop-color="#b8954a" />
        <stop offset="1" stop-color="#5c4620" />
      </linearGradient>
    </defs>
    <g fill="url(#${id})" stroke="#241a09" stroke-width="1.4"
       stroke-linejoin="round">
      <path d="M35 5c-13 5-23 17-25 33-.6 5 1.4 8.6 5.4 9.8 8 2 17.4-6.6 21-19.4C38.8 20 38.4 11.4 35 5Z" />
      <circle cx="35.5" cy="7" r="4.6" />
    </g>
    <g stroke="#3a2c14" stroke-width="1.1" stroke-linecap="round" fill="none"
       opacity="0.75">
      <path d="M31 13c-8 5-14 14-16 24" />
      <path d="M34 21c-7 4-12 11-14 19" />
      <path d="M35 30c-5 3-9 8-11 14" />
    </g>
  </svg>
`;
}

export type UseSlotHandler = (inventoryIndex: number) => void;
export type UseSkillHandler = (skillId: SkillId) => boolean;

export interface ActionBarProgress {
  level: number;
  experience: number;
  experienceToLevel: number;
}

interface SlotView {
  root: HTMLButtonElement;
  icon: HTMLImageElement;
  qty: HTMLElement;
  cooldown: HTMLElement;
}

/**
 * Hotbar of item and skill shortcuts plus the XP bar.
 *
 * Item slots bind an *item id* rather than an inventory index: stacks move
 * around the bag as things are picked up and consumed.
 */
export class ActionBar {
  private readonly slots: SlotView[] = [];
  private readonly assignments: ActionBarAssignment[] =
    Array(SLOT_COUNT).fill(null);
  private readonly tooltip: ItemTooltip;
  private hoverIndex: number | null = null;
  private dragFromActionIndex: number | null = null;
  private readonly storageKey: string;
  private hasStoredAssignments = false;
  private hasSeededDefaults = false;
  private classId = "warrior";
  private strength = 0;
  private weaponDamageMin = 0;
  private weaponDamageMax = 0;
  private resourceCurrent = 0;

  private constructor(
    private readonly root: HTMLElement,
    private readonly slotsEl: HTMLElement,
    private readonly xpFill: HTMLElement,
    private readonly xpLabel: HTMLElement,
    private readonly levelEl: HTMLElement,
    private readonly inventory: Inventory,
    private readonly onUseItem: UseSlotHandler,
    private readonly onUseSkill: UseSkillHandler,
    private readonly input: KeyboardInput,
    private readonly itemCooldowns: ItemCooldowns,
    private readonly skillCooldowns: SkillCooldowns,
    characterId: string,
  ) {
    this.tooltip = ItemTooltip.create();
    this.storageKey = `${STORAGE_KEY}.${characterId}`;
    this.loadAssignments();
    this.buildSlots();
    this.render();
    window.addEventListener("dragover", this.onWindowDragOver);
    window.addEventListener("drop", this.onWindowDrop);
    this.inventory.onChange(() => this.render());
    this.itemCooldowns.onChange(() => this.renderCooldowns());
    this.skillCooldowns.onChange(() => this.renderCooldowns());
  }

  static create(
    inventory: Inventory,
    onUseItem: UseSlotHandler,
    onUseSkill: UseSkillHandler,
    input: KeyboardInput,
    itemCooldowns: ItemCooldowns,
    skillCooldowns: SkillCooldowns,
    characterId: string,
    host: HTMLElement = document.getElementById("ui-root")!,
  ): ActionBar {
    const root = document.createElement("div");
    root.id = "action-bar";
    root.className = "action-bar";
    root.setAttribute("aria-label", "Pasek akcji");
    root.innerHTML = `
      <div class="action-bar__rail">
        <span class="action-bar__emblem action-bar__emblem--left">${emblemSvg("ab-brass-l")}</span>
        <div class="action-bar__panel">
          <div class="action-bar__slots" data-slots role="toolbar" aria-label="Skróty akcji"></div>
          <div class="action-bar__xp">
            <span class="action-bar__xp-level" data-level>1</span>
            <div class="action-bar__xp-track">
              <div class="action-bar__xp-fill" data-xp-fill></div>
            </div>
            <span class="action-bar__xp-label" data-xp-label></span>
          </div>
        </div>
        <span class="action-bar__emblem action-bar__emblem--right">${emblemSvg("ab-brass-r")}</span>
      </div>
    `;
    host.appendChild(root);

    return new ActionBar(
      root,
      root.querySelector("[data-slots]")!,
      root.querySelector("[data-xp-fill]")!,
      root.querySelector("[data-xp-label]")!,
      root.querySelector("[data-level]")!,
      inventory,
      onUseItem,
      onUseSkill,
      input,
      itemCooldowns,
      skillCooldowns,
      characterId,
    );
  }

  /** Activates a slot by its zero-based position; ignores empty slots. */
  activate(index: number): void {
    const assignment = this.assignments[index];
    if (!assignment) return;

    if (assignment.type === "skill") {
      if (!hasSkill(assignment.id)) {
        this.flashSlot(index);
        return;
      }
      const skill = getSkill(assignment.id);
      if (!skillUsableByClass(skill, this.classId)) {
        this.flashSlot(index);
        return;
      }
      if (this.skillCooldowns.remaining(assignment.id) > 0) {
        this.flashSlot(index);
        return;
      }
      if (!this.onUseSkill(assignment.id)) {
        this.flashSlot(index);
        return;
      }
      this.skillCooldowns.start(assignment.id, skill.cooldownMs);
      return;
    }

    if (this.itemCooldowns.remaining(assignment.id) > 0) {
      this.flashSlot(index);
      return;
    }

    const inventoryIndex = this.findInventoryIndex(assignment.id);
    if (inventoryIndex === null) {
      this.flashSlot(index);
      return;
    }

    this.onUseItem(inventoryIndex);
  }

  setProgress({
    level,
    experience,
    experienceToLevel,
  }: ActionBarProgress): void {
    this.levelEl.textContent = String(level);

    if (experienceToLevel <= 0) {
      this.xpFill.style.width = "100%";
      this.xpLabel.textContent = "MAKS.";
      return;
    }

    const ratio = Math.max(0, Math.min(1, experience / experienceToLevel));
    this.xpFill.style.width = `${ratio * 100}%`;
    this.xpLabel.textContent = `${experience} / ${experienceToLevel} PD`;
  }

  /** Starts the sweep on every slot bound to this item. */
  startCooldown(itemId: ItemId, durationMs: number): void {
    this.itemCooldowns.start(itemId, durationMs);
  }

  /** Filters skill bindings / default bind to this class. */
  setClassId(classId: string): void {
    this.classId = classId;
    if (!this.hasStoredAssignments && !this.hasSeededDefaults) {
      this.hasSeededDefaults = true;
      this.ensureDefaultSkillBind();
    }
    this.render();
  }

  /** Live stats for skill damage tooltips (strength + weapon range). */
  setCombatStats(stats: {
    strength: number;
    weaponDamageMin: number;
    weaponDamageMax: number;
  }): void {
    this.strength = Math.max(0, stats.strength);
    this.weaponDamageMin = Math.max(0, stats.weaponDamageMin);
    this.weaponDamageMax = Math.max(
      this.weaponDamageMin,
      stats.weaponDamageMax,
    );
    if (this.hoverIndex !== null) {
      const view = this.slots[this.hoverIndex];
      if (view) {
        const rect = view.root.getBoundingClientRect();
        this.showTooltip(this.hoverIndex, rect.left + rect.width / 2, rect.top);
      }
    }
  }

  /** Keep skill affordability (rage/mana) in sync with the HUD bar. */
  setResource(resource: number): void {
    const next = Math.max(0, Math.floor(resource));
    if (next === this.resourceCurrent) return;
    this.resourceCurrent = next;
    this.renderAffordability();
  }

  dispose(): void {
    window.removeEventListener("dragover", this.onWindowDragOver);
    window.removeEventListener("drop", this.onWindowDrop);
    this.finishActionDrag();
    this.tooltip.hide();
    this.root.remove();
  }

  private buildSlots(): void {
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < SLOT_COUNT; i++) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "action-bar__slot";
      button.dataset.index = String(i);
      button.draggable = false;

      button.innerHTML = `
        <span class="action-bar__well" aria-hidden="true"></span>
        <img class="action-bar__icon" alt="" draggable="false" hidden />
        <span class="action-bar__cooldown" aria-hidden="true"></span>
        <span class="action-bar__gloss" aria-hidden="true"></span>
        <span class="action-bar__qty" aria-hidden="true"></span>
        <span class="action-bar__key" aria-hidden="true">${KEY_CAPS[i]}</span>
      `;

      button.addEventListener("click", () => this.activate(i));
      button.addEventListener("dragstart", (event) =>
        this.onActionDragStart(i, event),
      );
      button.addEventListener("dragend", () => this.finishActionDrag());

      // Right-click clears the binding; the bag keeps the item either way.
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.assign(i, null);
      });

      button.addEventListener("dragover", (event) => this.onDragOver(i, event));
      button.addEventListener("dragleave", () => this.onDragLeave(i));
      button.addEventListener("drop", (event) => this.onDrop(i, event));

      button.addEventListener("pointerenter", (event) => {
        this.hoverIndex = i;
        this.showTooltip(i, event.clientX, event.clientY);
      });
      button.addEventListener("pointermove", (event) =>
        this.tooltip.moveTo(event.clientX, event.clientY),
      );
      button.addEventListener("pointerleave", () => {
        this.hoverIndex = null;
        this.tooltip.hide();
      });

      fragment.appendChild(button);
      this.slots.push({
        root: button,
        icon: button.querySelector(".action-bar__icon")!,
        qty: button.querySelector(".action-bar__qty")!,
        cooldown: button.querySelector(".action-bar__cooldown")!,
      });
    }

    this.slotsEl.replaceChildren(fragment);
  }

  private onDragOver(index: number, event: DragEvent): void {
    const types = event.dataTransfer?.types ?? [];
    // Browsers expose custom MIME types inconsistently; text/plain is the fallback.
    const ok =
      [...types].includes(DRAG_SLOT_MIME) ||
      [...types].includes(DRAG_SKILL_MIME) ||
      [...types].includes(DRAG_ACTION_MIME) ||
      this.dragFromActionIndex !== null ||
      [...types].includes("text/plain");
    if (!ok) return;

    event.preventDefault();
    event.stopPropagation();
    // Must match inventory dragstart effectAllowed ("move") or the drop is rejected.
    // Skills use "copy"; browsers still accept move|copy when we set dropEffect.
    const isExternalSkill =
      [...types].includes(DRAG_SKILL_MIME) &&
      ![...types].includes(DRAG_ACTION_MIME);
    event.dataTransfer!.dropEffect = isExternalSkill ? "copy" : "move";
    this.root.classList.remove("action-bar--discarding");
    this.slots[index]?.root.classList.add("action-bar__slot--drag-over");
  }

  private onDragLeave(index: number): void {
    this.slots[index]?.root.classList.remove("action-bar__slot--drag-over");
  }

  private onDrop(index: number, event: DragEvent): void {
    const actionSource = this.readActionDragIndex(event.dataTransfer);
    const skillId =
      event.dataTransfer?.getData(DRAG_SKILL_MIME) ||
      (hasSkill(event.dataTransfer?.getData("text/plain") ?? "")
        ? event.dataTransfer!.getData("text/plain")
        : "");
    this.slots[index]?.root.classList.remove("action-bar__slot--drag-over");

    if (actionSource !== null) {
      event.preventDefault();
      event.stopPropagation();
      this.input.clear();
      this.moveAssignment(actionSource, index);
      this.finishActionDrag();
      return;
    }

    if (skillId && hasSkill(skillId)) {
      event.preventDefault();
      event.stopPropagation();
      const skill = getSkill(skillId);
      if (!skillUsableByClass(skill, this.classId)) {
        this.flashSlot(index);
        return;
      }
      this.input.clear();
      this.assign(index, { type: "skill", id: skillId });
      return;
    }

    const raw =
      event.dataTransfer?.getData(DRAG_SLOT_MIME) ||
      event.dataTransfer?.getData("text/plain");
    if (!raw) return;

    // Stop the window-level handler that would drop the stack into the world.
    event.preventDefault();
    event.stopPropagation();

    const fromIndex = Number(raw);
    const slot = this.inventory.getSlot(fromIndex);
    if (!slot?.itemId) return;

    if (!isUsableItem(slot.itemId)) {
      this.flashSlot(index);
      return;
    }

    this.input.clear();
    this.assign(index, { type: "item", id: slot.itemId });
  }

  private onActionDragStart(index: number, event: DragEvent): void {
    if (!this.assignments[index] || !event.dataTransfer) {
      event.preventDefault();
      return;
    }

    this.dragFromActionIndex = index;
    this.hoverIndex = null;
    this.tooltip.hide();
    this.input.clear();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_ACTION_MIME, String(index));
    event.dataTransfer.setData("text/plain", `action:${index}`);
    this.root.classList.add("action-bar--dragging");
    this.slots[index]?.root.classList.add("action-bar__slot--dragging");
  }

  private readonly onWindowDragOver = (event: DragEvent): void => {
    if (this.dragFromActionIndex === null) return;
    const target = event.target;
    const overActionBar = target instanceof Node && this.root.contains(target);
    this.root.classList.toggle("action-bar--discarding", !overActionBar);
    if (overActionBar) return;

    // Make the rest of the game a valid drop target for removing only the bind.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  };

  private readonly onWindowDrop = (event: DragEvent): void => {
    const source = this.dragFromActionIndex;
    if (source === null) return;
    const target = event.target;
    if (target instanceof Node && this.root.contains(target)) return;

    event.preventDefault();
    event.stopPropagation();
    this.input.clear();
    this.assign(source, null);
    this.finishActionDrag();
  };

  private readActionDragIndex(
    dataTransfer: DataTransfer | null,
  ): number | null {
    const custom = dataTransfer?.getData(DRAG_ACTION_MIME) ?? "";
    const fallback = dataTransfer?.getData("text/plain") ?? "";
    const raw =
      custom || (fallback.startsWith("action:") ? fallback.slice(7) : "");
    if (!raw) return this.dragFromActionIndex;
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed < SLOT_COUNT) {
      return parsed;
    }
    return this.dragFromActionIndex;
  }

  private moveAssignment(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    const source = this.assignments[fromIndex];
    if (!source) return;

    const target = this.assignments[toIndex];
    this.assignments[toIndex] = source;
    this.assignments[fromIndex] = target;
    this.saveAssignments();
    this.render();
  }

  private finishActionDrag(): void {
    this.dragFromActionIndex = null;
    this.root.classList.remove(
      "action-bar--dragging",
      "action-bar--discarding",
    );
    for (const slot of this.slots) {
      slot.root.classList.remove(
        "action-bar__slot--dragging",
        "action-bar__slot--drag-over",
      );
    }
  }

  private assign(index: number, value: ActionBarAssignment): void {
    if (value?.type === "item") {
      this.assignments[index] = {
        type: "item",
        id: canonicalItemId(value.id),
      };
    } else {
      this.assignments[index] = value;
    }
    this.saveAssignments();
    this.render();
  }

  private findInventoryIndex(itemId: ItemId): number | null {
    const slots = this.inventory.getSlots();
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (
        slot?.itemId &&
        slot.quantity > 0 &&
        itemIdsMatch(slot.itemId, itemId)
      ) {
        return i;
      }
    }
    return null;
  }

  private countItem(itemId: ItemId): number {
    let total = 0;
    for (const slot of this.inventory.getSlots()) {
      if (slot?.itemId && itemIdsMatch(slot.itemId, itemId)) {
        total += slot.quantity;
      }
    }
    return total;
  }

  private render(): void {
    this.slots.forEach((view, index) => {
      const assignment = this.assignments[index];

      if (!assignment) {
        view.root.draggable = false;
        view.icon.hidden = true;
        view.icon.removeAttribute("src");
        view.qty.textContent = "";
        view.root.classList.remove(
          "action-bar__slot--filled",
          "action-bar__slot--empty-stack",
          "action-bar__slot--unusable",
        );
        view.root.setAttribute("aria-label", `Pusty slot ${KEY_CAPS[index]}`);
        return;
      }

      if (assignment.type === "skill") {
        if (!hasSkill(assignment.id)) {
          view.root.draggable = false;
          view.icon.hidden = true;
          view.icon.removeAttribute("src");
          view.qty.textContent = "";
          view.root.classList.remove(
            "action-bar__slot--filled",
            "action-bar__slot--empty-stack",
            "action-bar__slot--unusable",
          );
          return;
        }
        const skill = getSkill(assignment.id);
        const unaffordable =
          skill.resourceCost > 0 && this.resourceCurrent < skill.resourceCost;
        view.root.draggable = true;
        view.icon.hidden = false;
        view.icon.src = `/${skill.icon}`;
        view.icon.alt = skill.name;
        view.qty.textContent = "";
        view.root.classList.add("action-bar__slot--filled");
        view.root.classList.remove("action-bar__slot--empty-stack");
        view.root.classList.toggle("action-bar__slot--unusable", unaffordable);
        view.root.setAttribute(
          "aria-label",
          unaffordable ? `${skill.name} — za mało zasobu` : skill.name,
        );
        return;
      }

      if (!hasItem(assignment.id)) {
        view.root.draggable = false;
        view.icon.hidden = true;
        view.icon.removeAttribute("src");
        view.qty.textContent = "";
        view.root.classList.remove(
          "action-bar__slot--filled",
          "action-bar__slot--empty-stack",
          "action-bar__slot--unusable",
        );
        view.root.setAttribute("aria-label", `Pusty slot ${KEY_CAPS[index]}`);
        return;
      }

      const item = getItem(assignment.id);
      const count = this.countItem(assignment.id);

      view.root.draggable = true;
      view.icon.hidden = false;
      view.icon.src = `/${item.icon}`;
      view.icon.alt = item.name;
      view.qty.textContent = count > 1 ? String(count) : "";
      view.root.classList.add("action-bar__slot--filled");
      view.root.classList.remove("action-bar__slot--unusable");
      view.root.classList.toggle("action-bar__slot--empty-stack", count === 0);
      view.root.setAttribute(
        "aria-label",
        `${item.name}${count > 0 ? ` (${count})` : " — brak"}`,
      );
    });

    this.renderCooldowns();
    this.renderAffordability();

    if (this.hoverIndex !== null) {
      const assignment = this.assignments[this.hoverIndex];
      if (assignment?.type === "item" && this.countItem(assignment.id) <= 0) {
        this.hoverIndex = null;
        this.tooltip.hide();
      }
    }
  }

  private renderCooldowns(): void {
    this.slots.forEach((view, index) => {
      const assignment = this.assignments[index];
      if (!assignment) {
        view.cooldown.style.height = "0%";
        return;
      }

      if (assignment.type === "skill") {
        if (!hasSkill(assignment.id)) {
          view.cooldown.style.height = "0%";
          return;
        }
        const skill = getSkill(assignment.id);
        const total = skill.cooldownMs;
        const remaining = this.skillCooldowns.remaining(assignment.id);
        view.cooldown.style.height =
          total > 0 && remaining > 0
            ? `${Math.min(100, (remaining / total) * 100)}%`
            : "0%";
        return;
      }

      const item = hasItem(assignment.id) ? getItem(assignment.id) : null;
      const total = item?.use?.cooldownMs ?? 0;
      const remaining = this.itemCooldowns.remaining(assignment.id);

      view.cooldown.style.height =
        total > 0 && remaining > 0
          ? `${Math.min(100, (remaining / total) * 100)}%`
          : "0%";
    });
  }

  /** Grey out skills the player cannot afford right now. */
  private renderAffordability(): void {
    this.slots.forEach((view, index) => {
      const assignment = this.assignments[index];
      if (!assignment || assignment.type !== "skill" || !hasSkill(assignment.id)) {
        view.root.classList.remove("action-bar__slot--unusable");
        return;
      }
      const skill = getSkill(assignment.id);
      const unaffordable =
        skill.resourceCost > 0 && this.resourceCurrent < skill.resourceCost;
      view.root.classList.toggle("action-bar__slot--unusable", unaffordable);
    });
  }

  private flashSlot(index: number): void {
    const view = this.slots[index];
    if (!view) return;
    view.root.classList.remove("action-bar__slot--denied");
    void view.root.offsetWidth;
    view.root.classList.add("action-bar__slot--denied");
  }

  private showTooltip(index: number, clientX: number, clientY: number): void {
    const assignment = this.assignments[index];
    if (!assignment) {
      this.tooltip.hide();
      return;
    }

    if (assignment.type === "skill") {
      if (!hasSkill(assignment.id)) {
        this.tooltip.hide();
        return;
      }
      const skill = getSkill(assignment.id);
      const range = skillDamageRange(
        skill,
        this.strength,
        this.weaponDamageMin,
        this.weaponDamageMax,
      );
      const lines = [
        `Obrażenia: ${range.min}–${range.max}`,
        `Odnowienie: ${(skill.cooldownMs / 1000).toFixed(0)} s`,
      ];
      if (skill.resourceCost > 0) {
        const kind = parseResourceKind(getClass(this.classId).resource);
        const label = RESOURCE_LABELS[kind] || "zasób";
        lines.push(`Koszt: ${skill.resourceCost} ${label}`);
      }
      this.tooltip.showInfo(
        skill.name,
        lines,
        skill.description,
        clientX,
        clientY,
      );
      return;
    }

    if (!hasItem(assignment.id)) {
      this.tooltip.hide();
      return;
    }
    this.tooltip.show(
      getItem(assignment.id),
      this.countItem(assignment.id),
      clientX,
      clientY,
    );
  }

  private loadAssignments(): void {
    try {
      const ownRaw = localStorage.getItem(this.storageKey);
      const raw = ownRaw ?? localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          this.hasStoredAssignments = true;
          for (let i = 0; i < SLOT_COUNT; i++) {
            this.assignments[i] = parseAssignment(parsed[i]);
          }
          // Preserve existing players' layout while moving to character-scoped storage.
          if (ownRaw === null) this.saveAssignments();
        }
      }
    } catch {
      // Corrupt or unavailable storage just means an empty bar.
    }
  }

  private ensureDefaultSkillBind(): void {
    if (this.assignments[0] !== null) return;
    if (!hasSkill(DEFAULT_SKILL_ID)) return;
    const skill = getSkill(DEFAULT_SKILL_ID);
    if (!skillUsableByClass(skill, this.classId)) return;
    this.assignments[0] = { type: "skill", id: DEFAULT_SKILL_ID };
    this.saveAssignments();
  }

  private saveAssignments(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.assignments));
      this.hasStoredAssignments = true;
    } catch {
      // Non-fatal: bindings simply won't survive a reload.
    }
  }
}

function parseAssignment(value: unknown): ActionBarAssignment {
  if (value == null) return null;
  if (typeof value === "string" && value.length > 0) {
    return { type: "item", id: canonicalItemId(value) };
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "id" in value
  ) {
    const v = value as { type: string; id: string };
    if (v.type === "item" && typeof v.id === "string" && v.id.length > 0) {
      return { type: "item", id: canonicalItemId(v.id) };
    }
    if (v.type === "skill" && typeof v.id === "string" && hasSkill(v.id)) {
      return { type: "skill", id: v.id };
    }
  }
  return null;
}
