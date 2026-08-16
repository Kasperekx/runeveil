import type { KeyboardInput } from "../../input/KeyboardInput";
import type { DialogueWindow } from "./DialogueWindow";
import type { MerchantWindow } from "./MerchantWindow";

/** Esc closes merchant first, then gossip. */
export class DialogueHotkeys {
  constructor(
    private readonly dialogue: DialogueWindow,
    private readonly merchant: MerchantWindow,
    private readonly input: KeyboardInput,
  ) {}

  start(): void {
    this.input.onKeyDownPress((code, event) => {
      if (code !== "Escape") return;
      if (this.merchant.isOpen) {
        event.preventDefault();
        this.merchant.close();
        return;
      }
      if (this.dialogue.isOpen) {
        event.preventDefault();
        this.dialogue.close();
      }
    });
  }
}
