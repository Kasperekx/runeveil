import {
  DRAG_ACTION_MIME,
  DRAG_SKILL_MIME,
  DRAG_SLOT_MIME,
} from "../../../config/constants";

/** What was dropped on a slot, before the bar decides whether it is legal. */
export type DropIntent =
  | { kind: "binding"; fromIndex: number }
  | { kind: "skill"; skillId: string }
  | { kind: "inventory"; inventoryIndex: number };

export interface DragCallbacks {
  onDragStart(index: number): void;
  onDrop(index: number, intent: DropIntent): void;
  /** A bound slot was released outside the bar — the bind goes away. */
  onDropOutside(index: number): void;
}

export interface DragConfig {
  root: HTMLElement;
  slotCount: number;
  /** Recognises a skill id inside the text/plain fallback payload. */
  isSkillId(raw: string): boolean;
}

/**
 * All hotbar drag plumbing: MIME sniffing, drop effects and the classes that
 * show what is happening. It reports intents and never touches the bindings,
 * so the rules about what may go where stay in {@link ActionBar}.
 */
export class ActionBarDrag {
  private sourceIndex: number | null = null;

  constructor(
    private readonly config: DragConfig,
    private readonly callbacks: DragCallbacks,
  ) {
    window.addEventListener("dragover", this.onWindowDragOver);
    window.addEventListener("drop", this.onWindowDrop);
  }

  /** Wires one slot button as the bar builds its DOM. */
  attach(index: number, button: HTMLElement, isBound: () => boolean): void {
    button.addEventListener("dragstart", (event) => {
      if (!isBound() || !event.dataTransfer) {
        event.preventDefault();
        return;
      }
      this.sourceIndex = index;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(DRAG_ACTION_MIME, String(index));
      event.dataTransfer.setData("text/plain", `action:${index}`);
      this.config.root.classList.add("action-bar--dragging");
      button.classList.add("action-bar__slot--dragging");
      this.callbacks.onDragStart(index);
    });

    button.addEventListener("dragend", () => this.end());
    button.addEventListener("dragover", (event) =>
      this.onSlotDragOver(button, event),
    );
    button.addEventListener("dragleave", () =>
      button.classList.remove("action-bar__slot--drag-over"),
    );
    button.addEventListener("drop", (event) =>
      this.onSlotDrop(index, button, event),
    );
  }

  /** Clears the drag classes; safe to call when no drag is running. */
  end(): void {
    this.sourceIndex = null;
    this.config.root.classList.remove(
      "action-bar--dragging",
      "action-bar--discarding",
    );
    for (const slot of this.config.root.querySelectorAll(
      ".action-bar__slot--dragging, .action-bar__slot--drag-over",
    )) {
      slot.classList.remove(
        "action-bar__slot--dragging",
        "action-bar__slot--drag-over",
      );
    }
  }

  dispose(): void {
    window.removeEventListener("dragover", this.onWindowDragOver);
    window.removeEventListener("drop", this.onWindowDrop);
    this.end();
  }

  private onSlotDragOver(button: HTMLElement, event: DragEvent): void {
    const types = [...(event.dataTransfer?.types ?? [])];
    // Browsers expose custom MIME types inconsistently; text/plain is the fallback.
    const accepted =
      types.includes(DRAG_SLOT_MIME) ||
      types.includes(DRAG_SKILL_MIME) ||
      types.includes(DRAG_ACTION_MIME) ||
      types.includes("text/plain") ||
      this.sourceIndex !== null;
    if (!accepted) return;

    event.preventDefault();
    event.stopPropagation();
    // Must match the inventory's effectAllowed ("move") or the drop is rejected.
    // Skills use "copy"; browsers still accept move|copy once dropEffect is set.
    const externalSkill =
      types.includes(DRAG_SKILL_MIME) && !types.includes(DRAG_ACTION_MIME);
    event.dataTransfer!.dropEffect = externalSkill ? "copy" : "move";
    this.config.root.classList.remove("action-bar--discarding");
    button.classList.add("action-bar__slot--drag-over");
  }

  private onSlotDrop(
    index: number,
    button: HTMLElement,
    event: DragEvent,
  ): void {
    button.classList.remove("action-bar__slot--drag-over");
    const intent = this.readIntent(event.dataTransfer);
    if (!intent) return;

    // Stop the window handler that would drop the stack into the world.
    event.preventDefault();
    event.stopPropagation();
    this.callbacks.onDrop(index, intent);
    if (intent.kind === "binding") this.end();
  }

  private readIntent(data: DataTransfer | null): DropIntent | null {
    const fallback = data?.getData("text/plain") ?? "";

    const fromIndex = this.readSourceIndex(data, fallback);
    if (fromIndex !== null) return { kind: "binding", fromIndex };

    const skillId =
      data?.getData(DRAG_SKILL_MIME) ||
      (this.config.isSkillId(fallback) ? fallback : "");
    if (skillId) return { kind: "skill", skillId };

    const raw = data?.getData(DRAG_SLOT_MIME) || fallback;
    if (!raw) return null;
    return { kind: "inventory", inventoryIndex: Number(raw) };
  }

  private readSourceIndex(
    data: DataTransfer | null,
    fallback: string,
  ): number | null {
    const raw =
      (data?.getData(DRAG_ACTION_MIME) ?? "") ||
      (fallback.startsWith("action:") ? fallback.slice(7) : "");
    if (!raw) return this.sourceIndex;

    const parsed = Number(raw);
    const valid =
      Number.isInteger(parsed) && parsed >= 0 && parsed < this.config.slotCount;
    return valid ? parsed : this.sourceIndex;
  }

  private readonly onWindowDragOver = (event: DragEvent): void => {
    if (this.sourceIndex === null) return;
    const target = event.target;
    const overBar = target instanceof Node && this.config.root.contains(target);
    this.config.root.classList.toggle("action-bar--discarding", !overBar);
    if (overBar) return;

    // Make the rest of the game a valid drop target for removing the bind.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  };

  private readonly onWindowDrop = (event: DragEvent): void => {
    const source = this.sourceIndex;
    if (source === null) return;
    const target = event.target;
    if (target instanceof Node && this.config.root.contains(target)) return;

    event.preventDefault();
    event.stopPropagation();
    this.callbacks.onDropOutside(source);
    this.end();
  };
}
