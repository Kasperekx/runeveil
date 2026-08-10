# NPC dialogue options (simple)

Date: 2026-08-02

## Goal
Merchant conversation starts with choice buttons; trade is one option; a short story is another.

## Behaviour
- On open: greeting + option list (when `dialogue` is present in YAML).
- Options:
  - `text` present → show that line, offer „Wróć” to root menu
  - `action: trade` → reveal existing buy/sell shop UI
  - `action: close` → close window
- No `dialogue` → legacy behaviour (greeting + shop if any).
- Client-only; server ignores dialogue fields.

## Data (`npcs.yaml`)
```yaml
dialogue:
  - id: story
    label: Opowiedz mi o sobie
    text: |
      ...
  - id: trade
    label: Pokaż towar
    action: trade
  - id: leave
    label: Do widzenia
    action: close
```
