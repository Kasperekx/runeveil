import { getClass } from "../../../content/classes";
import { getItem, hasItem } from "../../../content/items";
import { getSkill, hasSkill, skillDamageRange } from "../../../content/skills";
import { RESOURCE_LABELS, parseResourceKind } from "../../../config/resource";
import type { Inventory } from "../../../inventory/Inventory";
import type { ItemTooltip } from "../../inventory/ItemTooltip";
import { countItem } from "./actionEntry";
import type { ActionBarAssignment } from "./bindings";

/** Live values a skill tooltip needs to quote real numbers. */
export interface TooltipStats {
  classId: string;
  strength: number;
  weaponDamageMin: number;
  weaponDamageMax: number;
}

/** The bag tooltip for items, a damage/cost sheet for skills. */
export function showActionTooltip(
  tooltip: ItemTooltip,
  assignment: ActionBarAssignment,
  ctx: { inventory: Inventory; stats: TooltipStats },
  at: { x: number; y: number },
): void {
  if (!assignment) {
    tooltip.hide();
    return;
  }

  if (assignment.type === "skill") {
    if (!hasSkill(assignment.id)) {
      tooltip.hide();
      return;
    }
    const skill = getSkill(assignment.id);
    tooltip.showInfo(
      skill.name,
      skillLines(skill, ctx.stats),
      skill.description,
      at.x,
      at.y,
    );
    return;
  }

  if (!hasItem(assignment.id)) {
    tooltip.hide();
    return;
  }
  tooltip.show(
    getItem(assignment.id),
    countItem(ctx.inventory, assignment.id),
    at.x,
    at.y,
  );
}

function skillLines(
  skill: ReturnType<typeof getSkill>,
  stats: TooltipStats,
): string[] {
  const range = skillDamageRange(
    skill,
    stats.strength,
    stats.weaponDamageMin,
    stats.weaponDamageMax,
  );
  const lines = [
    `Obrażenia: ${range.min}–${range.max}`,
    `Odnowienie: ${(skill.cooldownMs / 1000).toFixed(0)} s`,
  ];

  if (skill.resourceCost > 0) {
    const kind = parseResourceKind(getClass(stats.classId).resource);
    lines.push(
      `Koszt: ${skill.resourceCost} ${RESOURCE_LABELS[kind] || "zasób"}`,
    );
  }
  return lines;
}
