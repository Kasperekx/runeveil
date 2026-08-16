# Dialogue gossip + Merchant window — design

Date: 2026-08-16

## Goal

Split NPC interaction into two surfaces that match classic MMO patterns (WoW /
Tibia hybrid):

1. **DialogueWindow** — gossip only (portrait, text, choice buttons).
2. **MerchantWindow** — buy / sell / repair as a dedicated work panel.
3. Opening trade or repair **auto-opens Inventory**; closing the merchant does
   not force-close the bag.

Also migrate both windows onto shared `panel__*` chrome (Dialogue still uses the
old `__ornament` language).

## Non-goals (this cycle)

- Sell-from-bag (right-click sell while vendor open) — later.
- Separate Repair-only window — repair is a Merchant tab/mode.
- `LootWindow` chrome migration — separate follow-up.
- Quest offer UX inside dialogue (accept / decline texts) — already tracked in
  the quest-foundation plan; keep gossip able to host quest buttons.

## Current state

`DialogueWindow` owns four modes (`root` | `story` | `trade` | `repair`) in one
DOM tree. Trade and repair morph the same frame (including
`dialogue-window--repair` width/palette swap). Network handlers
(`tradeResult`, stock, gold, repair refresh) all target `DialogueWindow`.

`NpcInteraction` binds buy/sell/repair onto the dialogue and opens it on NPC
click.

## Target UX flow

1. Click NPC in range → **Dialogue** opens (greeting + options).
2. Choose **Handel** → Dialogue closes → **Merchant** opens on Buy tab →
   **Inventory** opens if closed.
3. Choose **Naprawa** → same, Merchant opens on Repair tab/mode.
4. Esc / X on Merchant → Merchant closes; Inventory stays as the player left it.
5. Esc on Dialogue → Dialogue closes (unchanged).
6. Walk out of talk range / click away → close Dialogue and Merchant (same
   distance rules as today).
7. Legacy NPCs with shop but empty `dialogue[]` → skip gossip, open Merchant
   directly (+ inventory), matching today’s “straight into trade” behaviour.

## Window responsibilities

### DialogueWindow (slim)

- Markup on `panel__*`: brand eyebrow = NPC role, title = NPC name, portrait in
  body, greeting, option list.
- Options: talk/story, trade, repair, quest actions, close/back.
- No shop list, no repair workshop DOM.
- API: `open(view)`, `close()`, `isOpen`; quest action callbacks stay on the
  view. Drop `bindTrade` / `bindRepair` / `setStock` / `refreshRepair` from this
  class (moved to Merchant).

### MerchantWindow (new)

- File: `src/ui/panels/MerchantWindow.ts` + `public/styles/merchant-window.css`.
- Chrome: `panel__*` (shared with other panels).
- Header: NPC name / role (or “Handel”), gold as `panel__chip`.
- Tabs: **Kup** | **Sprzedaj** | **Naprawa** (repair tab only if the NPC
  exposes repair — wire from the same flags we use for the repair dialogue
  option today).
- Body: list rows ported from current dialogue trade/repair renderers
  (buy offers, sellable bag slots, repairable gear + “Napraw wszystko”).
- API:
  - `open(context)` with npc instance id, name, shop offers, gold, mode tab
  - `close()`, `isOpen`
  - `bindTrade` / `bindRepair` (moved from Dialogue)
  - `setGold`, `setStock`, `refreshRepair`
- Position: centered or slightly left-of-center so the bag on the right/bottom
  remains usable (match inventory placement; do not cover the whole bag).

### Inventory auto-open

- When Merchant opens: if `!inventoryPanel.isOpen`, call `open()` and remember
  `openedByMerchant = true`.
- When Merchant closes: **do not** auto-close inventory (player may keep
  looting/organizing). The flag is only for telemetry/optional future use —
  default policy is leave bag open.

## Wiring

| Caller | Change |
|--------|--------|
| `NpcInteraction` | On trade/repair option → `dialogue.close()` then `merchant.open(...)` + inventory open. Bind trade/repair to Merchant. |
| `Game.ts` / `bindHud` | Construct Merchant; treat `merchant.isOpen` like dialogue for input-blocking / Esc. |
| `DialogueHotkeys` | Esc closes Merchant first if open, else Dialogue (or a small shared closer). |
| `bindNetwork` | `tradeResult` / stock / gold / repair events → Merchant when relevant; gold may still update Dialogue if somehow open. |

Server trade/repair messages stay unchanged.

## Visual / CSS

- Dialogue: remove `__ornament`, `--repair` variant, shop + repair sections from
  markup; delete obsolete rules from `style.css` once `dialogue-window.css`
  (or panel-scoped rules) exists.
- Merchant: new stylesheet; reuse list-row patterns from current dialogue shop
  CSS where they still fit the brass/ink language (no brown repair-only theme).

## Migration notes

- Move render helpers for buy/sell/repair lists with the Merchant class — do not
  leave dead trade DOM in Dialogue.
- Update `docs/superpowers/specs/2026-08-02-merchant-trade-design.md` pointer:
  UI home is MerchantWindow, not DialogueWindow.
- Keep Polish copy.

## Success criteria

- Gossip never shows buy/sell/repair lists.
- Handel opens Merchant + Inventory; living mob corpse/loot behaviour unrelated.
- Respawn/vendor stock/gold toasts still work with Merchant open.
- Esc and out-of-range close the right window.
- Both windows match Character/Quest panel chrome.
