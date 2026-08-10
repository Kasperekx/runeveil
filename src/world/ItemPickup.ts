import { Application, Assets, Sprite } from "pixi.js";
import { getItem, type ItemId } from "../items/catalog";

/** Collectible item sitting in the world. */
export class ItemPickup {
  readonly itemId: ItemId;
  readonly quantity: number;
  private readonly sprite: Sprite;
  private collected = false;
  private readonly collectableAt: number;

  private constructor(
    itemId: ItemId,
    quantity: number,
    sprite: Sprite,
    collectableAt: number,
  ) {
    this.itemId = itemId;
    this.quantity = quantity;
    this.sprite = sprite;
    this.collectableAt = collectableAt;
  }

  static async create(
    app: Application,
    itemId: ItemId,
    x: number,
    y: number,
    quantity = 1,
    collectDelayMs = 0,
  ): Promise<ItemPickup> {
    const def = getItem(itemId);
    const texture = await Assets.load(def.icon);
    texture.source.scaleMode = "nearest";

    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.roundPixels = true;
    sprite.scale.set(def.worldScale);
    sprite.position.set(x, y);
    app.stage.addChild(sprite);

    return new ItemPickup(
      itemId,
      quantity,
      sprite,
      performance.now() + collectDelayMs,
    );
  }

  get position(): { x: number; y: number } {
    return { x: this.sprite.position.x, y: this.sprite.position.y };
  }

  get isCollected(): boolean {
    return this.collected;
  }

  get isCollectable(): boolean {
    return !this.collected && performance.now() >= this.collectableAt;
  }

  collect(): void {
    if (this.collected) return;
    this.collected = true;
    this.sprite.destroy();
  }
}
