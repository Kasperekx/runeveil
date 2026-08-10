import type { KeyboardInput } from "../../input/KeyboardInput";
import type { InventoryPanel } from "./InventoryPanel";

/** Binds inventory hotkeys to the panel (SRP: input routing for this UI). */
export class InventoryHotkeys {
  constructor(
    private readonly panel: InventoryPanel,
    private readonly input: KeyboardInput,
  ) {}

  start(): void {
    this.input.onKeyDownPress((code, event) => {
      if (code === "KeyI") {
        event.preventDefault();
        this.panel.toggle();
        return;
      }

      if (code === "Escape" && this.panel.isOpen) {
        event.preventDefault();
        this.panel.close();
      }
    });
  }
}
