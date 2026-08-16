import type { Application } from "pixi.js";
import { MAX_DELTA_MS, PLAYER_COLLISION_RADIUS } from "../../config/constants";
import type { Environment } from "../../render/Environment";
import type { KeyboardInput } from "../../input/KeyboardInput";
import type { MapPlayableBounds } from "../../maps/types";
import { resolveCircleMove } from "../../physics/resolveCircleMove";
import type { Player } from "./Player";

/** Applies keyboard axis to the player each frame (SRP: movement only). */
export class PlayerMovement {
  constructor(
    private readonly app: Application,
    private readonly player: Player,
    private readonly input: KeyboardInput,
    private environment: Environment,
    private playable: MapPlayableBounds,
    private readonly onMoved?: () => void,
    private readonly isBlocked: () => boolean = () => false,
  ) {}

  /** Swap collision context after an interior / outdoor map transition. */
  setWorldContext(environment: Environment, playable: MapPlayableBounds): void {
    this.environment = environment;
    this.playable = playable;
  }

  start(): void {
    this.app.ticker.add(this.update);
  }

  private update = (): void => {
    const dt = Math.min(this.app.ticker.deltaMS, MAX_DELTA_MS) / 1000;
    if (this.isBlocked()) {
      this.player.updateAnimation(dt, false);
      return;
    }
    const { x, y } = this.input.getMovementAxis();
    const attacking = this.player.isAttacking;

    if (x === 0 && y === 0) {
      this.player.updateAnimation(dt, false);
      return;
    }

    const length = Math.hypot(x, y);
    const distance = (this.player.moveSpeed * dt) / length;
    const moveX = x * distance;
    const moveY = y * distance;

    const from = this.player.position;
    // Creatures are not solid — circle-strafe freely. Props still block.
    const blockers = this.environment.colliders;

    const resolved = resolveCircleMove(
      from.x,
      from.y,
      from.x + moveX,
      from.y + moveY,
      PLAYER_COLLISION_RADIUS,
      blockers,
      this.playable,
    );

    const movedX = resolved.x - from.x;
    const movedY = resolved.y - from.y;
    if (movedX === 0 && movedY === 0) {
      if (!attacking) {
        this.player.faceToward(from.x + moveX, from.y + moveY);
      }
      this.player.updateAnimation(dt, false);
      return;
    }

    this.player.setPosition(resolved.x, resolved.y);
    // During a swing, combat keeps facing on the target.
    if (!attacking) {
      this.player.faceToward(resolved.x + moveX, resolved.y + moveY);
    }
    this.player.updateAnimation(dt, true);
    this.onMoved?.();
  };
}
