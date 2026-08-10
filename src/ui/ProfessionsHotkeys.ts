import type { KeyboardInput } from "../input/KeyboardInput";
import type { ProfessionsPanel } from "./ProfessionsPanel";

/** Routes L / Esc for the professions journal. */
export class ProfessionsHotkeys {
  constructor(
    private readonly professions: ProfessionsPanel,
    private readonly input: KeyboardInput,
  ) {}

  start(): void {
    this.input.onKeyDownPress((code, event) => {
      if (code === "KeyL") {
        event.preventDefault();
        this.professions.toggle();
      } else if (code === "Escape" && this.professions.isOpen) {
        event.preventDefault();
        this.professions.close();
      }
    });
  }
}
