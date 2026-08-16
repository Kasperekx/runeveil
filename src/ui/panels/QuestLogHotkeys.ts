import type { KeyboardInput } from "../../input/KeyboardInput";
import type { QuestLog } from "./QuestLog";

/** Routes Q / Escape to the quest journal. */
export class QuestLogHotkeys {
  constructor(
    private readonly log: QuestLog,
    private readonly input: KeyboardInput,
  ) {}

  start(): void {
    this.input.onKeyDownPress((code, event) => {
      if (code === "KeyQ") {
        event.preventDefault();
        this.log.toggle();
      } else if (code === "Escape" && this.log.isOpen) {
        event.preventDefault();
        this.log.close();
      }
    });
  }
}
