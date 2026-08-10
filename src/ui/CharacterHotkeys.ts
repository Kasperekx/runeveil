import type { KeyboardInput } from "../input/KeyboardInput";
import type { CharacterPanel } from "./CharacterPanel";

/** Routes C / Esc for character panel. */
export class CharacterHotkeys {
  constructor(
    private readonly character: CharacterPanel,
    private readonly input: KeyboardInput,
  ) {}

  start(): void {
    this.input.onKeyDownPress((code, event) => {
      if (code === "KeyC") {
        event.preventDefault();
        this.character.toggle();
        return;
      }

      if (code === "Escape" && this.character.isOpen) {
        event.preventDefault();
        this.character.close();
      }
    });
  }
}
