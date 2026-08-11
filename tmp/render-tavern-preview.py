import json
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
MAP = json.loads((ROOT / "public/maps/hunters-tavern.json").read_text())


def asset_path(url: str) -> Path:
    return ROOT / "public" / url.split("?", 1)[0].lstrip("/")


canvas = Image.new("RGBA", (MAP["width"], MAP["height"]), (0, 0, 0, 255))
floor = Image.open(asset_path(MAP["ground"]["texture"])).convert("RGBA")
for y in range(0, MAP["height"], floor.height):
    for x in range(0, MAP["width"], floor.width):
        canvas.alpha_composite(floor, (x, y))


def scaled_image(definition: dict) -> Image.Image:
    image = Image.open(asset_path(definition["texture"])).convert("RGBA")
    scale = definition.get("scale", 1)
    if scale != 1:
        image = image.resize(
            (round(image.width * scale), round(image.height * scale)),
            Image.Resampling.NEAREST,
        )
    return image


def draw_prop(prop: dict) -> None:
    definition = MAP["propTypes"][prop["type"]]
    image = scaled_image(definition)
    left = round(prop["x"] - image.width * definition["anchorX"])
    top = round(prop["y"] - image.height * definition["anchorY"])
    canvas.alpha_composite(image, (left, top))


ground_props = [
    prop
    for prop in MAP["props"]
    if MAP["propTypes"][prop["type"]].get("layer") == "ground"
]
world_props = [
    prop
    for prop in MAP["props"]
    if MAP["propTypes"][prop["type"]].get("layer") != "ground"
]

for prop in ground_props:
    draw_prop(prop)

shadow_layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
shadow_draw = ImageDraw.Draw(shadow_layer)
for prop in world_props:
    shadow = MAP["propTypes"][prop["type"]].get("shadow")
    if not shadow:
        continue
    alpha = round(255 * shadow.get("alpha", 0.35))
    rx, ry = shadow["radiusX"], shadow["radiusY"]
    shadow_draw.ellipse(
        (prop["x"] - rx, prop["y"] + 2 - ry, prop["x"] + rx, prop["y"] + 2 + ry),
        fill=(10, 12, 8, alpha),
    )
canvas.alpha_composite(shadow_layer)

for prop in sorted(world_props, key=lambda item: item["y"]):
    draw_prop(prop)

player_path = ROOT / "public/assets/players/human-warrior-v2/warrior-idle-down.png"
player = Image.open(player_path).convert("RGBA")
spawn = MAP["spawns"]["player"]
canvas.alpha_composite(player, (round(spawn["x"] - player.width / 2), round(spawn["y"] - player.height * 0.82)))

preview = ROOT / "tmp/tavern-layout-preview.png"
canvas.save(preview)
print(preview)
