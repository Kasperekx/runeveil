# Improvements plan

## Active
- Wspólne chrome paneli w `public/styles/panel.css` (koniec kopii `__frame` / `__header` w każdym panelu)
- `DialogueWindow` + `LootWindow` ze starego języka `__ornament` na wspólne chrome; dialog jako jedno okno o stałej szerokości
- Quest system: wspólny parser w `shared/quests/parse.ts`, teksty zadań w YAML, dostępność liczona tylko na serwerze, porzucanie zadań
- Szczegóły: `docs/plan-2026-08-16_16-37.md`, `docs/tasks-2026-08-16_16-37.md`

## Done / prior
- Placeable campfire uses `placeableCampfire.yaml` SSOT (colliders, light, anchors, placement)
- Placeable cooking campfire from ProfessionsPanel (ghost placement; 1 per player; runtime)
- Warrior restored to `human-warrior-v2` sprites
- Mining smelt loop: vein → copper_ore → recipe → copper_ingot at forge/campfire
- Skeleton walk/dead + cardinal-animated layout
