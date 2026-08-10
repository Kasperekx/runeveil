import type { QuestObjectiveType } from "./questConfig.js";

/** A trusted world event that may advance any matching accepted quest. */
export interface QuestProgressEvent {
  type: QuestObjectiveType;
  target: string;
  amount?: number;
}
