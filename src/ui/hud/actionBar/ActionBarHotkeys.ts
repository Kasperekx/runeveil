import type { KeyboardInput } from "../../../input/KeyboardInput";
import type { ActionBar } from "./ActionBar";

/** Digit1..Digit9 then Digit0 map to action slots 0..9. */
const SLOT_BY_CODE: Record<string, number> = {
  Digit1: 0,
  Digit2: 1,
  Digit3: 2,
  Digit4: 3,
  Digit5: 4,
  Digit6: 5,
  Digit7: 6,
  Digit8: 7,
  Digit9: 8,
  Digit0: 9,
};

/** Routes number keys (1–9, 0) to the action currently assigned to each slot. */
export class ActionBarHotkeys {
  constructor(
    private readonly bar: ActionBar,
    private readonly input: KeyboardInput,
  ) {}

  start(): void {
    this.input.onKeyDownPress((code, event) => {
      const index = SLOT_BY_CODE[code];
      if (index === undefined) return;
      // Ignore when typing into an input / with modifiers (browser shortcuts).
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      this.bar.activate(index);
    });
  }
}
