import type { Application, Container } from "pixi.js";
import type { GameNetwork } from "../../network/GameNetwork";
import { SyncedRemotePlayerView } from "./SyncedRemotePlayerView";
import { listClasses } from "../../content/classes";
import type { PlayerSprites } from "./PlayerSprites";

/**
 * Renders other players from Colyseus state (pose + attack swings).
 */
export class NetworkPlayerSystem {
  private readonly views = new Map<string, SyncedRemotePlayerView>();
  private readonly spritesByClass = new Map<string, PlayerSprites>();

  constructor(
    private readonly app: Application,
    private readonly world: Container,
    private readonly network: GameNetwork,
  ) {}

  async init(): Promise<void> {
    await Promise.all(
      listClasses().map(async (cls) => {
        this.spritesByClass.set(
          cls.id,
          await SyncedRemotePlayerView.loadSprites(cls.id),
        );
      }),
    );
  }

  start(): void {
    this.app.ticker.add(this.update);
  }

  private update = (): void => {
    if (this.spritesByClass.size === 0) return;
    const deltaMS = this.app.ticker.deltaMS;
    const players = this.network.listOtherPlayers();
    const seen = new Set<string>();

    for (const snap of players) {
      seen.add(snap.sessionId);
      let view = this.views.get(snap.sessionId);
      if (!view) {
        const sprites =
          this.spritesByClass.get(snap.classId) ??
          this.spritesByClass.get("warrior");
        if (!sprites) continue;
        view = new SyncedRemotePlayerView(this.world, sprites, snap.name);
        this.views.set(snap.sessionId, view);
      }
      view.setServerState(snap);
      view.update(deltaMS);
    }

    for (const [id, view] of this.views) {
      if (seen.has(id)) continue;
      view.destroy();
      this.views.delete(id);
    }
  };
}
