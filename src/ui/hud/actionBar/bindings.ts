import { canonicalItemId, type ItemId } from "../../../content/items";
import { hasSkill, type SkillId } from "../../../content/skills";

export type ActionBarAssignment =
  { type: "item"; id: ItemId } | { type: "skill"; id: SkillId } | null;

/** Pre-character-scoped key; still read once so old layouts survive. */
const LEGACY_KEY = "mmo.actionBar";

/**
 * The saved hotbar layout: the in-memory list and its localStorage mirror.
 *
 * Item slots hold an *item id* rather than an inventory index, because stacks
 * move around the bag as things are picked up and consumed.
 */
export class ActionBarBindings {
  private readonly list: ActionBarAssignment[];
  private readonly storageKey: string;
  private stored = false;

  constructor(characterId: string, count: number) {
    this.storageKey = `${LEGACY_KEY}.${characterId}`;
    this.list = Array<ActionBarAssignment>(count).fill(null);
    this.load();
  }

  /** False for a fresh character, which is what gates the default skill bind. */
  get hasStored(): boolean {
    return this.stored;
  }

  get(index: number): ActionBarAssignment {
    return this.list[index] ?? null;
  }

  set(index: number, value: ActionBarAssignment): void {
    if (index < 0 || index >= this.list.length) return;
    this.list[index] =
      value?.type === "item"
        ? { type: "item", id: canonicalItemId(value.id) }
        : value;
    this.save();
  }

  /** Swap rather than overwrite, so a drag never destroys the target bind. */
  swap(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    const source = this.get(fromIndex);
    if (!source) return;
    this.list[fromIndex] = this.get(toIndex);
    this.list[toIndex] = source;
    this.save();
  }

  private load(): void {
    try {
      const ownRaw = localStorage.getItem(this.storageKey);
      const raw = ownRaw ?? localStorage.getItem(LEGACY_KEY);
      if (!raw) return;

      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;

      this.stored = true;
      for (let i = 0; i < this.list.length; i++) {
        this.list[i] = parseAssignment(parsed[i]);
      }
      if (ownRaw === null) this.save();
    } catch {
      // Corrupt or unavailable storage just means an empty bar.
    }
  }

  private save(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.list));
      this.stored = true;
    } catch {
      // Non-fatal: bindings simply won't survive a reload.
    }
  }
}

export function parseAssignment(value: unknown): ActionBarAssignment {
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
