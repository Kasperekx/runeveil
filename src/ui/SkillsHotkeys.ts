import type { KeyboardInput } from "../input/KeyboardInput";
import type { SkillsPanel } from "./SkillsPanel";

/** Routes P / Esc for the skills panel. */
export class SkillsHotkeys {
  constructor(
    private readonly skills: SkillsPanel,
    private readonly input: KeyboardInput,
  ) {}

  start(): void {
    this.input.onKeyDownPress((code, event) => {
      if (code === "KeyP") {
        event.preventDefault();
        this.skills.toggle();
        return;
      }

      if (code === "Escape" && this.skills.isOpen) {
        event.preventDefault();
        this.skills.close();
      }
    });
  }
}
