import type { Application } from "pixi.js";
import type { Player } from "../player/Player";
import type { PickupSystem } from "../world/PickupSystem";
import type { WanderingAnimal } from "./WanderingAnimal";

/** Updates wandering animals and resolves player bump → kill → drop. */
export class AnimalSystem {
  private readonly animals: WanderingAnimal[] = [];

  constructor(
    private readonly app: Application,
    private readonly player: Player,
    private readonly pickups: PickupSystem,
  ) {}

  add(animal: WanderingAnimal): void {
    this.animals.push(animal);
  }

  start(): void {
    this.app.ticker.add(this.update);
  }

  private update = (): void => {
    const deltaMS = this.app.ticker.deltaMS;
    const { x: px, y: py } = this.player.position;

    for (const animal of this.animals) {
      animal.update(this.app, deltaMS);
      if (!animal.isAlive) continue;

      const { x, y } = animal.position;
      if (Math.hypot(x - px, y - py) > animal.hitRadius) continue;

      const { dropItem, dropQuantity } = animal.config;
      animal.kill();
      void this.pickups.dropItem(dropItem, dropQuantity, x, y);
    }
  };
}
