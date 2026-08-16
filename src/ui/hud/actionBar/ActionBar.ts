import type { KeyboardInput } from "../../../input/KeyboardInput";
import type { Inventory } from "../../../inventory/Inventory";
import { isUsableItem, type ItemId } from "../../../content/items";
import {
  getSkill,
  hasSkill,
  skillUsableByClass,
} from "../../../content/skills";
import type { ItemCooldowns } from "../ItemCooldowns";
import type { SkillCooldowns } from "../SkillCooldowns";
import { ItemTooltip } from "../../inventory/ItemTooltip";
import { ActionBarBindings, type ActionBarAssignment } from "./bindings";
import {
  actionCooldownRatio,
  actionCooldownRemaining,
  countItem,
  describeAction,
  findInventoryIndex,
  type ActionContext,
  type ActionEntry,
} from "./actionEntry";
import { ActionBarDrag, type DropIntent } from "./drag";
import { showActionTooltip, type TooltipStats } from "./tooltip";
import { ExperienceBar, type ActionBarProgress } from "./ExperienceBar";

export type { ActionBarAssignment } from "./bindings";
export type { ActionBarProgress } from "./ExperienceBar";

const SLOT_COUNT = 10;
const DEFAULT_SKILL_ID = "sweeping_strike";
/** Displayed key cap per slot; the tenth slot is bound to 0. */
const KEY_CAPS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

export type UseSlotHandler = (inventoryIndex: number) => void;
export type UseSkillHandler = (skillId: string) => boolean;

interface SlotView {
  root: HTMLButtonElement;
  icon: HTMLImageElement;
  qty: HTMLElement;
  cooldown: HTMLElement;
  timer: HTMLElement;
}

/**
 * Hotbar of item and skill shortcuts plus the XP strip.
 *
 * This class owns the DOM and the rules — what may be bound, what a press
 * does. The saved layout lives in {@link ActionBarBindings}, what a slot shows
 * comes from {@link describeAction} and the pointer plumbing is
 * {@link ActionBarDrag}'s job.
 */
export class ActionBar {
  private readonly slots: SlotView[] = [];
  private readonly bindings: ActionBarBindings;
  private readonly drag: ActionBarDrag;
  private readonly xp: ExperienceBar;
  private readonly tooltip: ItemTooltip;
  private hoverIndex: number | null = null;
  private hasSeededDefaults = false;
  private classId = "warrior";
  private strength = 0;
  private weaponDamageMin = 0;
  private weaponDamageMax = 0;
  private resourceCurrent = 0;

  private constructor(
    private readonly root: HTMLElement,
    private readonly slotsEl: HTMLElement,
    private readonly inventory: Inventory,
    private readonly onUseItem: UseSlotHandler,
    private readonly onUseSkill: UseSkillHandler,
    private readonly input: KeyboardInput,
    private readonly itemCooldowns: ItemCooldowns,
    private readonly skillCooldowns: SkillCooldowns,
    characterId: string,
  ) {
    this.tooltip = ItemTooltip.create();
    this.bindings = new ActionBarBindings(characterId, SLOT_COUNT);
    this.xp = ExperienceBar.create();
    this.drag = new ActionBarDrag(
      { root, slotCount: SLOT_COUNT, isSkillId: hasSkill },
      {
        onDragStart: () => {
          this.hideTooltip();
          this.input.clear();
        },
        onDrop: (index, intent) => this.applyDrop(index, intent),
        onDropOutside: (index) => {
          this.input.clear();
          this.assign(index, null);
        },
      },
    );

    (this.slotsEl.parentElement ?? this.root).appendChild(this.xp.element);
    this.buildSlots();
    this.render();
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
      <p class="action-bar__notice" aria-hidden="true">
        <span class="action-bar__notice-keep">Upuść poza paskiem, aby usunąć skrót</span>
        <span class="action-bar__notice-drop">Puść, aby usunąć skrót</span>
      </p>
      <div class="action-bar__rail">
        <span class="action-bar__cap action-bar__cap--left" aria-hidden="true"></span>
        <div class="action-bar__panel">
          <div class="action-bar__slots" data-slots role="toolbar" aria-label="Skróty akcji"></div>
        </div>
        <span class="action-bar__cap action-bar__cap--right" aria-hidden="true"></span>
      </div>
    `;
    host.appendChild(root);

    return new ActionBar(
      root,
      root.querySelector("[data-slots]")!,
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
    const assignment = this.bindings.get(index);
    if (!assignment) return;

    if (assignment.type === "skill") {
      this.castSkill(index, assignment.id);
      return;
    }

    if (this.itemCooldowns.remaining(assignment.id) > 0) {
      this.flashSlot(index);
      return;
    }

    const inventoryIndex = findInventoryIndex(this.inventory, assignment.id);
    if (inventoryIndex === null) {
      this.flashSlot(index);
      return;
    }

    this.onUseItem(inventoryIndex);
  }

  setProgress(progress: ActionBarProgress): void {
    this.xp.setProgress(progress);
  }

  /** Starts the sweep on every slot bound to this item. */
  startCooldown(itemId: ItemId, durationMs: number): void {
    this.itemCooldowns.start(itemId, durationMs);
  }

  /** Filters skill bindings / default bind to this class. */
  setClassId(classId: string): void {
    this.classId = classId;
    if (!this.bindings.hasStored && !this.hasSeededDefaults) {
      this.hasSeededDefaults = true;
      this.seedDefaultSkill();
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

    if (this.hoverIndex === null) return;
    const view = this.slots[this.hoverIndex]?.root;
    if (!view) return;
    const rect = view.getBoundingClientRect();
    this.showTooltip(this.hoverIndex, rect.left + rect.width / 2, rect.top);
  }

  /** Keep skill affordability (rage/mana) in sync with the HUD bar. */
  setResource(resource: number): void {
    const next = Math.max(0, Math.floor(resource));
    if (next === this.resourceCurrent) return;
    this.resourceCurrent = next;
    this.render();
  }

  dispose(): void {
    this.drag.dispose();
    this.tooltip.hide();
    this.root.remove();
  }

  private get context(): ActionContext {
    return {
      inventory: this.inventory,
      itemCooldowns: this.itemCooldowns,
      skillCooldowns: this.skillCooldowns,
      resource: this.resourceCurrent,
    };
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
        <span class="action-bar__key" aria-hidden="true">${KEY_CAPS[i]}</span>
        <img class="action-bar__icon" alt="" draggable="false" hidden />
        <span class="action-bar__cooldown" aria-hidden="true"></span>
        <span class="action-bar__timer" aria-hidden="true"></span>
        <span class="action-bar__gloss" aria-hidden="true"></span>
        <span class="action-bar__qty" aria-hidden="true"></span>
      `;

      button.addEventListener("click", () => this.activate(i));

      // Right-click clears the binding; the bag keeps the item either way.
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.assign(i, null);
      });

      button.addEventListener("pointerenter", (event) => {
        this.hoverIndex = i;
        this.showTooltip(i, event.clientX, event.clientY);
      });
      button.addEventListener("pointermove", (event) =>
        this.tooltip.moveTo(event.clientX, event.clientY),
      );
      button.addEventListener("pointerleave", () => this.hideTooltip());

      this.drag.attach(i, button, () => this.bindings.get(i) !== null);

      fragment.appendChild(button);
      this.slots.push({
        root: button,
        icon: button.querySelector(".action-bar__icon")!,
        qty: button.querySelector(".action-bar__qty")!,
        cooldown: button.querySelector(".action-bar__cooldown")!,
        timer: button.querySelector(".action-bar__timer")!,
      });
    }

    this.slotsEl.replaceChildren(fragment);
  }

  private render(): void {
    const ctx = this.context;

    this.slots.forEach((view, index) => {
      const entry = describeAction(this.bindings.get(index), ctx);
      view.root.draggable = entry !== null;
      view.root.classList.toggle("action-bar__slot--filled", entry !== null);
      view.root.classList.toggle(
        "action-bar__slot--empty-stack",
        entry?.count === 0,
      );
      view.root.classList.toggle(
        "action-bar__slot--unusable",
        entry?.unaffordable ?? false,
      );
      view.root.setAttribute(
        "aria-label",
        entry ? slotLabel(entry) : `Pusty slot ${KEY_CAPS[index]}`,
      );

      view.icon.hidden = entry === null;
      view.qty.textContent =
        entry && entry.count !== null && entry.count > 1
          ? String(entry.count)
          : "";
      if (!entry) {
        view.icon.removeAttribute("src");
        return;
      }
      view.icon.src = `/${entry.icon}`;
      view.icon.alt = entry.name;
    });

    this.renderCooldowns();
    this.hideStaleTooltip();
  }

  private renderCooldowns(): void {
    const ctx = this.context;

    for (const [index, view] of this.slots.entries()) {
      const assignment = this.bindings.get(index);
      const ratio = actionCooldownRatio(assignment, ctx);
      view.cooldown.style.height = `${ratio * 100}%`;

      const remaining =
        ratio > 0 ? actionCooldownRemaining(assignment, ctx) : 0;
      // Under a second the sweep alone reads better than a flickering "0".
      view.timer.textContent =
        remaining >= 1000 ? String(Math.ceil(remaining / 1000)) : "";
    }
  }

  private castSkill(index: number, skillId: string): void {
    if (!hasSkill(skillId)) {
      this.flashSlot(index);
      return;
    }
    const skill = getSkill(skillId);
    const blocked =
      !skillUsableByClass(skill, this.classId) ||
      this.skillCooldowns.remaining(skillId) > 0;
    if (blocked || !this.onUseSkill(skillId)) {
      this.flashSlot(index);
      return;
    }
    this.skillCooldowns.start(skillId, skill.cooldownMs);
  }

  /** Turns a drop reported by {@link ActionBarDrag} into a binding change. */
  private applyDrop(index: number, intent: DropIntent): void {
    if (intent.kind === "binding") {
      this.input.clear();
      this.bindings.swap(intent.fromIndex, index);
      this.render();
      return;
    }

    if (intent.kind === "skill") {
      if (
        !hasSkill(intent.skillId) ||
        !skillUsableByClass(getSkill(intent.skillId), this.classId)
      ) {
        this.flashSlot(index);
        return;
      }
      this.input.clear();
      this.assign(index, { type: "skill", id: intent.skillId });
      return;
    }

    const slot = this.inventory.getSlot(intent.inventoryIndex);
    if (!slot?.itemId) return;
    if (!isUsableItem(slot.itemId)) {
      this.flashSlot(index);
      return;
    }
    this.input.clear();
    this.assign(index, { type: "item", id: slot.itemId });
  }

  private assign(index: number, value: ActionBarAssignment): void {
    this.bindings.set(index, value);
    this.render();
  }

  private seedDefaultSkill(): void {
    if (this.bindings.get(0) !== null) return;
    if (!hasSkill(DEFAULT_SKILL_ID)) return;
    if (!skillUsableByClass(getSkill(DEFAULT_SKILL_ID), this.classId)) return;
    this.bindings.set(0, { type: "skill", id: DEFAULT_SKILL_ID });
  }

  private flashSlot(index: number): void {
    const view = this.slots[index];
    if (!view) return;
    view.root.classList.remove("action-bar__slot--denied");
    void view.root.offsetWidth;
    view.root.classList.add("action-bar__slot--denied");
  }

  private showTooltip(index: number, clientX: number, clientY: number): void {
    const stats: TooltipStats = {
      classId: this.classId,
      strength: this.strength,
      weaponDamageMin: this.weaponDamageMin,
      weaponDamageMax: this.weaponDamageMax,
    };
    showActionTooltip(
      this.tooltip,
      this.bindings.get(index),
      { inventory: this.inventory, stats },
      { x: clientX, y: clientY },
    );
  }

  private hideTooltip(): void {
    this.hoverIndex = null;
    this.tooltip.hide();
  }

  /** Drop the tooltip when the hovered slot's stack runs out mid-hover. */
  private hideStaleTooltip(): void {
    if (this.hoverIndex === null) return;
    const assignment = this.bindings.get(this.hoverIndex);
    if (
      assignment?.type === "item" &&
      countItem(this.inventory, assignment.id) <= 0
    ) {
      this.hideTooltip();
    }
  }
}

function slotLabel(entry: ActionEntry): string {
  if (entry.count === null) {
    return entry.unaffordable ? `${entry.name} — za mało zasobu` : entry.name;
  }
  return `${entry.name}${entry.count > 0 ? ` (${entry.count})` : " — brak"}`;
}
