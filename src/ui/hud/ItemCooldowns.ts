import { canonicalItemId, type ItemId } from "../../content/items";

/**
 * Shared consumable cooldown clock for the action bar and bag.
 * Keys are canonical item ids so legacy aliases share one sweep.
 */
export class ItemCooldowns {
  private readonly until = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private timer: number | null = null;

  start(itemId: ItemId, durationMs: number): void {
    if (durationMs <= 0) return;
    this.until.set(canonicalItemId(itemId), Date.now() + durationMs);
    this.ensureTicker();
    this.notify();
  }

  remaining(itemId: ItemId): number {
    const key = canonicalItemId(itemId);
    const end = this.until.get(key);
    if (end === undefined) return 0;
    const left = end - Date.now();
    if (left <= 0) {
      this.until.delete(key);
      return 0;
    }
    return left;
  }

  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  private ensureTicker(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => {
      let active = false;
      for (const [key, end] of this.until) {
        if (end <= Date.now()) this.until.delete(key);
        else active = true;
      }
      this.notify();
      if (!active && this.timer !== null) {
        window.clearInterval(this.timer);
        this.timer = null;
      }
    }, 100);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
