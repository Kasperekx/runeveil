# Merchant trade (buy / sell) — design

Date: 2026-08-02

## Goal

Production-ready vendor at `dark_merchant`: player buys from NPC shop and sells inventory items for gold. Server-authoritative; client UI in `DialogueWindow`.

## Data

- `items.yaml`: `buyPrice` (required to buy), optional `sellPrice` (else `floor(buyPrice * 0.35)`).
- `npcs.yaml`: `shop: [{ item, stock }]` — `stock: -1` = infinite.
- Player: `gold` in Colyseus `PlayerState` + SQLite `players.gold` (default starter **50**).

## Server

- Load NPC catalog + map NPC placements (id, npcId, x, y).
- Room-local shop stock (clone from YAML on first use / room start).
- Messages:
  - `buyFromNpc` `{ npcInstanceId, itemId, quantity? }`
  - `sellToNpc` `{ npcInstanceId, inventoryIndex, quantity? }`
- Validate: talk range (128), shop offers item, stock, gold, inventory space / ownership.
- Notices: `not_enough_gold`, `inventory_full`, `out_of_stock`, `cannot_sell`, `too_far`.
- `tradeResult` on success for toast + stock refresh.

## Client

- Dialogue: greeting + gold + tabs **Kup** / **Sprzedaj**.
- Buy list from NPC `shop`; sell list = inventory slots with `sellPrice`/`buyPrice`.
- Network calls + gold on sheet sync; improve dialogue layout (wider, rows, tabs).

## Out of scope

- Blacksmith / repairs, haggling, auction, gold drops from mobs.
