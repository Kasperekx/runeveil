# Edycja map w Tiled

Mapy edytujemy w darmowej aplikacji [Tiled](https://www.mapeditor.org/). Plik
źródłowy terenów łowieckich to `public/maps/hunting_grounds.tmj`.

## Pierwsze uruchomienie na macOS

```bash
brew install --cask tiled
npm run map:edit
```

Po zapisaniu mapy zbuduj dokument runtime i uruchom ponownie serwer gry:

```bash
npm run maps:build
```

`npm run dev` i `npm run build` wykonują kompilację map automatycznie.

## Warstwy

- `ground` — powtarzane tło mapy.
- `terrain-overlays` — skalowalne fragmenty nawierzchni, np. kamienny plac.
- `props` — budynki, drzewa, kuźnia, karawana i palenisko.
- `gameplay/playable` — granice ruchu gracza.
- `gameplay/player-spawns` — start gracza; wymagany obiekt `player`.
- `gameplay/creature-spawns` — spawny stworzeń; nazwa jest ich unikalnym id,
  a właściwość `kind` wskazuje definicję stworzenia.
- `gameplay/npcs` — punkty NPC; nazwa jest id instancji, właściwość `npcId`
  wskazuje katalog NPC.
- `gameplay/cooking-stations` — elipsy zasięgu stanowisk gotowania.
- `gameplay/homes` — punkty wskrzeszenia.

## Ważne zasady

1. Prop przesuwamy, ale nie zmieniamy jego rozmiaru. Skala i anchor są częścią
   katalogu `propTypes` w `public/maps/hunting_grounds.json`.
2. Każdy NPC, spawn, home i station musi mieć unikalną nazwę.
3. Po zmianie warstw gameplay uruchamiamy `npm run maps:build` i restartujemy
   serwer, ponieważ serwer jest autorytatywny dla kolizji oraz spawnów.
4. Nie edytujemy ręcznie `public/maps/generated/*.json`; to wynik kompilacji.

Kompilator przerywa pracę przy brakujących warstwach, typach propów lub
powtórzonych identyfikatorach. W CI można sprawdzić aktualność wygenerowanych
map poleceniem `npm run maps:check`.
