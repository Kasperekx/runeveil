import type { KeyboardInput } from "../../input/KeyboardInput";
import type { DialogueWindow } from "./DialogueWindow";

/** Routes Esc to close the dialogue window (no dedicated open hotkey — click an NPC). */
export class DialogueHotkeys {
  constructor(
    private readonly dialogue: DialogueWindow,
    private readonly input: KeyboardInput,
  ) {}

  start(): void {
    this.input.onKeyDownPress((code, event) => {
      if (code === "Escape" && this.dialogue.isOpen) {
        event.preventDefault();
        this.dialogue.close();
      }
    });
  }
}
