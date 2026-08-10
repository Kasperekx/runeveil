import { Assets, Container, Sprite } from "pixi.js";
import { getItem, type ItemId } from "../items/catalog";

/** Client visual for a server-driven world pickup. */
export class SyncedPickupView {
  readonly id: string;
  readonly itemId: ItemId;
  readonly quantity: number;
  private readonly sprite: Sprite;

  private constructor(
    id: string,
    itemId: ItemId,
    quantity: number,
    sprite: Sprite,
  ) {
    this.id = id;
    this.itemId = itemId;
    this.quantity = quantity;
    this.sprite = sprite;
  }

  static async create(
    world: Container,
    id: string,
    itemId: ItemId,
    quantity: number,
    x: number,
    y: number,
  ): Promise<SyncedPickupView> {
    const def = getItem(itemId);
    const texture = await Assets.load(def.icon);
    texture.source.scaleMode = "nearest";

    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.roundPixels = true;
    sprite.scale.set(def.worldScale);
    sprite.position.set(x, y);
    sprite.zIndex = Math.round(y);
    world.addChild(sprite);

    return new SyncedPickupView(id, itemId, quantity, sprite);
  }

  get position(): { x: number; y: number } {
    return { x: this.sprite.position.x, y: this.sprite.position.y };
  }

  setPosition(x: number, y: number): void {
    this.sprite.position.set(x, y);
    this.sprite.zIndex = Math.round(y);
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
