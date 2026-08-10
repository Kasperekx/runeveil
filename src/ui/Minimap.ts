import type { Application } from "pixi.js";
import type { NetworkAnimalSystem } from "../creatures/NetworkAnimalSystem";
import type { Camera } from "../game/Camera";
import type { MapDocument, MapNpcInstance } from "../maps/types";

const WIDTH = 220;
const HEIGHT = 130;
const UPDATE_INTERVAL_MS = 80;
const WAYPOINT_REACHED_DISTANCE = 22;

interface Point {
  x: number;
  y: number;
}

type Waypoint = Point;

/**
 * Compact, north-up world map. It intentionally renders from map data rather
 * than the game canvas, keeping it crisp and inexpensive while still exposing
 * living creatures, landmarks, the current viewport and a user waypoint.
 */
export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly coordinatesEl: HTMLElement;
  private readonly waypointEl: HTMLElement;
  private readonly clearWaypointButton: HTMLButtonElement;
  private readonly toggleButton: HTMLButtonElement;
  private readonly scale: number;
  private readonly offset: Point;
  private expanded = true;
  private elapsed = UPDATE_INTERVAL_MS;
  private waypoint: Waypoint | null = null;

  private constructor(
    private readonly app: Application,
    private readonly root: HTMLElement,
    private readonly map: MapDocument,
    private readonly camera: Camera,
    private readonly getPlayerPosition: () => Point,
    private readonly animals: NetworkAnimalSystem,
  ) {
    this.canvas = root.querySelector("[data-minimap-canvas]")!;
    this.context = this.canvas.getContext("2d")!;
    this.coordinatesEl = root.querySelector("[data-minimap-coordinates]")!;
    this.waypointEl = root.querySelector("[data-minimap-waypoint]")!;
    this.clearWaypointButton = root.querySelector("[data-minimap-clear]")!;
    this.toggleButton = root.querySelector("[data-minimap-toggle]")!;

    const mapScale = Math.min(WIDTH / map.width, HEIGHT / map.height);
    this.scale = mapScale;
    this.offset = {
      x: (WIDTH - map.width * mapScale) / 2,
      y: (HEIGHT - map.height * mapScale) / 2,
    };

    this.draw();
  }

  static create(
    app: Application,
    map: MapDocument,
    camera: Camera,
    getPlayerPosition: () => Point,
    animals: NetworkAnimalSystem,
    host: HTMLElement = document.getElementById("ui-root")!,
  ): Minimap {
    const root = document.createElement("aside");
    root.id = "minimap";
    root.className = "minimap";
    root.setAttribute("aria-label", "Minimapa");
    root.innerHTML = `
      <header class="minimap__header">
        <span class="minimap__sigil" aria-hidden="true">⌖</span>
        <strong>${escapeHtml(mapName(map.id))}</strong>
        <button type="button" class="minimap__toggle" data-minimap-toggle aria-label="Zwiń minimapę" title="Zwiń minimapę">−</button>
      </header>
      <div class="minimap__body">
        <div class="minimap__surface">
          <canvas class="minimap__canvas" data-minimap-canvas width="${WIDTH}" height="${HEIGHT}" aria-label="Mapa okolicy. Kliknij, aby ustawić punkt orientacyjny."></canvas>
          <span class="minimap__north" aria-hidden="true">N</span>
          <button type="button" class="minimap__clear" data-minimap-clear hidden aria-label="Usuń punkt orientacyjny" title="Usuń punkt orientacyjny">×</button>
        </div>
        <footer class="minimap__footer">
          <span data-minimap-coordinates></span>
          <span data-minimap-waypoint></span>
        </footer>
      </div>
    `;
    host.appendChild(root);

    const minimap = new Minimap(
      app,
      root,
      map,
      camera,
      getPlayerPosition,
      animals,
    );
    minimap.bindEvents();
    app.ticker.add(minimap.update);
    return minimap;
  }

  get isExpanded(): boolean {
    return this.expanded;
  }

  toggle(): void {
    this.expanded = !this.expanded;
    this.root.classList.toggle("is-collapsed", !this.expanded);
    this.toggleButton.textContent = this.expanded ? "−" : "+";
    this.toggleButton.setAttribute(
      "aria-label",
      this.expanded ? "Zwiń minimapę" : "Rozwiń minimapę",
    );
    this.toggleButton.title = this.toggleButton.getAttribute("aria-label")!;
  }

  private bindEvents(): void {
    this.toggleButton.addEventListener("click", () => this.toggle());
    this.clearWaypointButton.addEventListener("click", () => {
      this.waypoint = null;
      this.draw();
    });
    this.canvas.addEventListener("click", this.setWaypointFromPointer);
    this.canvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.waypoint = null;
      this.draw();
    });
    this.canvas.addEventListener("pointermove", this.updateHoverLabel);
    this.canvas.addEventListener("pointerleave", () => this.updateFooter());
  }

  private readonly update = (): void => {
    this.elapsed += Math.min(this.app.ticker.deltaMS, 100);
    if (this.elapsed < UPDATE_INTERVAL_MS) return;
    this.elapsed = 0;

    const player = this.getPlayerPosition();
    if (
      this.waypoint &&
      Math.hypot(player.x - this.waypoint.x, player.y - this.waypoint.y) <=
        WAYPOINT_REACHED_DISTANCE
    ) {
      this.waypoint = null;
    }
    this.draw();
  };

  private draw(): void {
    const context = this.context;
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.fillStyle = "#060a08";
    context.fillRect(0, 0, WIDTH, HEIGHT);

    this.drawTerrain(context);
    this.drawViewport(context);
    this.drawLandmarks(context);
    this.drawAnimals(context);
    this.drawWaypoint(context);
    this.drawPlayer(context);
    this.updateFooter();
  }

  private drawTerrain(context: CanvasRenderingContext2D): void {
    const { x, y } = this.offset;
    const width = this.map.width * this.scale;
    const height = this.map.height * this.scale;

    context.fillStyle = "#28391f";
    context.fillRect(x, y, width, height);
    context.strokeStyle = "#687246";
    context.globalAlpha = 0.7;
    context.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
    context.globalAlpha = 1;

    for (const patch of this.map.groundPatches ?? []) {
      const topLeft = this.project(patch.x, patch.y);
      context.fillStyle = "#3a4650";
      context.fillRect(
        topLeft.x,
        topLeft.y,
        patch.width * this.scale,
        patch.height * this.scale,
      );
      context.strokeStyle = "rgba(139, 157, 160, 0.45)";
      context.strokeRect(
        topLeft.x + 0.5,
        topLeft.y + 0.5,
        patch.width * this.scale - 1,
        patch.height * this.scale - 1,
      );
    }

    const playable = this.map.playable;
    const topLeft = this.project(playable.minX, playable.minY);
    context.save();
    context.setLineDash([2, 2]);
    context.strokeStyle = "rgba(222, 198, 116, 0.38)";
    context.strokeRect(
      topLeft.x + 0.5,
      topLeft.y + 0.5,
      (playable.maxX - playable.minX) * this.scale - 1,
      (playable.maxY - playable.minY) * this.scale - 1,
    );
    context.restore();
  }

  private drawViewport(context: CanvasRenderingContext2D): void {
    const viewport = this.camera.getViewportBounds();
    const topLeft = this.project(viewport.x, viewport.y);
    context.save();
    context.strokeStyle = "rgba(243, 232, 173, 0.72)";
    context.lineWidth = 1;
    context.strokeRect(
      topLeft.x + 0.5,
      topLeft.y + 0.5,
      viewport.width * this.scale,
      viewport.height * this.scale,
    );
    context.restore();
  }

  private drawLandmarks(context: CanvasRenderingContext2D): void {
    for (const prop of this.map.props) {
      const definition = this.map.propTypes[prop.type];
      if (!definition) continue;
      if (definition.interaction?.kind === "cooking") {
        this.drawDiamond(context, this.project(prop.x, prop.y), "#f0a34e", 4);
      } else if (prop.type.includes("merchant")) {
        this.drawSquare(context, this.project(prop.x, prop.y), "#d4bd6f", 4);
      } else if (prop.type.includes("forge")) {
        this.drawDiamond(context, this.project(prop.x, prop.y), "#d16d40", 4);
      }
    }

    for (const npc of this.map.npcs ?? []) {
      this.drawNpc(context, npc);
    }
  }

  private drawNpc(
    context: CanvasRenderingContext2D,
    npc: MapNpcInstance,
  ): void {
    const point = this.project(npc.x, npc.y);
    const merchant = npc.npcId.includes("merchant");
    this.drawCircle(context, point, merchant ? "#e2c66e" : "#e48149", 2.6);
    context.fillStyle = "rgba(235, 221, 165, 0.84)";
    context.font = "7px Georgia, serif";
    context.textAlign = "center";
    context.fillText(merchant ? "Kupiec" : "Kuźnia", point.x, point.y - 5);
  }

  private drawAnimals(context: CanvasRenderingContext2D): void {
    for (const animal of this.animals.listAlivePositions()) {
      const color = animal.kind === "deer" ? "#cfad65" : "#bb5e51";
      this.drawCircle(context, this.project(animal.x, animal.y), color, 1.9);
    }
  }

  private drawWaypoint(context: CanvasRenderingContext2D): void {
    if (!this.waypoint) return;
    const point = this.project(this.waypoint.x, this.waypoint.y);
    context.save();
    context.strokeStyle = "#ffe38e";
    context.fillStyle = "#d69b3d";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(point.x, point.y - 5);
    context.lineTo(point.x + 4, point.y);
    context.lineTo(point.x, point.y + 5);
    context.lineTo(point.x - 4, point.y);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
  }

  private drawPlayer(context: CanvasRenderingContext2D): void {
    const point = this.project(
      this.getPlayerPosition().x,
      this.getPlayerPosition().y,
    );
    context.save();
    context.fillStyle = "#8ee7ef";
    context.strokeStyle = "#e6fff6";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(point.x, point.y - 5);
    context.lineTo(point.x + 3.7, point.y + 4);
    context.lineTo(point.x, point.y + 2.3);
    context.lineTo(point.x - 3.7, point.y + 4);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
  }

  private drawCircle(
    context: CanvasRenderingContext2D,
    point: Point,
    color: string,
    radius: number,
  ): void {
    context.fillStyle = color;
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fill();
  }

  private drawSquare(
    context: CanvasRenderingContext2D,
    point: Point,
    color: string,
    size: number,
  ): void {
    context.fillStyle = color;
    context.fillRect(point.x - size / 2, point.y - size / 2, size, size);
  }

  private drawDiamond(
    context: CanvasRenderingContext2D,
    point: Point,
    color: string,
    size: number,
  ): void {
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(point.x, point.y - size / 2);
    context.lineTo(point.x + size / 2, point.y);
    context.lineTo(point.x, point.y + size / 2);
    context.lineTo(point.x - size / 2, point.y);
    context.closePath();
    context.fill();
  }

  private readonly setWaypointFromPointer = (event: MouseEvent): void => {
    const point = this.eventPoint(event);
    if (!this.isInsideMap(point)) return;
    this.waypoint = this.unproject(point.x, point.y);
    this.draw();
  };

  private readonly updateHoverLabel = (event: PointerEvent): void => {
    const point = this.eventPoint(event);
    if (!this.isInsideMap(point)) {
      this.updateFooter();
      return;
    }
    const world = this.unproject(point.x, point.y);
    this.coordinatesEl.textContent = `${Math.round(world.x)}, ${Math.round(world.y)}`;
  };

  private eventPoint(event: MouseEvent | PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * HEIGHT,
    };
  }

  private isInsideMap(point: Point): boolean {
    return (
      point.x >= this.offset.x &&
      point.x <= this.offset.x + this.map.width * this.scale &&
      point.y >= this.offset.y &&
      point.y <= this.offset.y + this.map.height * this.scale
    );
  }

  private project(x: number, y: number): Point {
    return {
      x: this.offset.x + x * this.scale,
      y: this.offset.y + y * this.scale,
    };
  }

  private unproject(x: number, y: number): Point {
    return {
      x: Math.max(
        0,
        Math.min(this.map.width, (x - this.offset.x) / this.scale),
      ),
      y: Math.max(
        0,
        Math.min(this.map.height, (y - this.offset.y) / this.scale),
      ),
    };
  }

  private updateFooter(): void {
    const player = this.getPlayerPosition();
    this.coordinatesEl.textContent = `${Math.round(player.x)}, ${Math.round(player.y)}`;
    if (this.waypoint) {
      const distance = Math.round(
        Math.hypot(player.x - this.waypoint.x, player.y - this.waypoint.y),
      );
      this.waypointEl.textContent = `Cel · ${distance}`;
      this.clearWaypointButton.hidden = false;
    } else {
      this.waypointEl.textContent = "";
      this.clearWaypointButton.hidden = true;
    }
  }
}

function mapName(id: string): string {
  if (id === "hunting_grounds") return "Tereny łowieckie";
  return id.replace(/[_-]+/g, " ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
