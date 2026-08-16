import {
  getItem,
  hasItem,
  itemIdsMatch,
  type ItemId,
} from "../../../content/items";
import { getSkill, hasSkill } from "../../../content/skills";
import type { Inventory } from "../../../inventory/Inventory";
import type { ItemCooldowns } from "../ItemCooldowns";
import type { SkillCooldowns } from "../SkillCooldowns";
import type { ActionBarAssignment } from "./bindings";

export interface ActionContext {
  inventory: Inventory;
  itemCooldowns: ItemCooldowns;
  skillCooldowns: SkillCooldowns;
  /** Current rage/mana/energy, for skill affordability. */
  resource: number;
}

/**
 * What a slot needs to draw itself. Skills and items collapse into one shape so
 * the view has a single code path instead of a branch per assignment type.
 */
export interface ActionEntry {
  icon: string;
  name: string;
  /** Carried amount for items; null for skills, which have no stack. */
  count: number | null;
  /** Not enough resource to cast — the icon greys out. */
  unaffordable: boolean;
}

/** Null means the slot is empty or points at content that no longer exists. */
export function describeAction(
  assignment: ActionBarAssignment,
  ctx: ActionContext,
): ActionEntry | null {
  if (!assignment) return null;

  if (assignment.type === "skill") {
    if (!hasSkill(assignment.id)) return null;
    const skill = getSkill(assignment.id);
    return {
      icon: skill.icon,
      name: skill.name,
      count: null,
      unaffordable: skill.resourceCost > 0 && ctx.resource < skill.resourceCost,
    };
  }

  if (!hasItem(assignment.id)) return null;
  const item = getItem(assignment.id);
  return {
    icon: item.icon,
    name: item.name,
    count: countItem(ctx.inventory, assignment.id),
    unaffordable: false,
  };
}

/** 0 when ready, 1 when the sweep just started. */
export function actionCooldownRatio(
  assignment: ActionBarAssignment,
  ctx: ActionContext,
): number {
  if (!assignment) return 0;

  if (assignment.type === "skill") {
    if (!hasSkill(assignment.id)) return 0;
    return ratio(
      ctx.skillCooldowns.remaining(assignment.id),
      getSkill(assignment.id).cooldownMs,
    );
  }

  if (!hasItem(assignment.id)) return 0;
  return ratio(
    ctx.itemCooldowns.remaining(assignment.id),
    getItem(assignment.id).use?.cooldownMs ?? 0,
  );
}

/** Milliseconds left on the bound action, for the countdown readout. */
export function actionCooldownRemaining(
  assignment: ActionBarAssignment,
  ctx: ActionContext,
): number {
  if (!assignment) return 0;
  return assignment.type === "skill"
    ? ctx.skillCooldowns.remaining(assignment.id)
    : ctx.itemCooldowns.remaining(assignment.id);
}

export function countItem(inventory: Inventory, itemId: ItemId): number {
  let total = 0;
  for (const slot of inventory.getSlots()) {
    if (slot?.itemId && itemIdsMatch(slot.itemId, itemId)) {
      total += slot.quantity;
    }
  }
  return total;
}

export function findInventoryIndex(
  inventory: Inventory,
  itemId: ItemId,
): number | null {
  const slots = inventory.getSlots();
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

function ratio(remaining: number, total: number): number {
  if (total <= 0 || remaining <= 0) return 0;
  return Math.min(1, remaining / total);
}
