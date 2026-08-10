# Serwer MMO

Trwały stan graczy jest przechowywany wyłącznie w PostgreSQL. Definicje contentu
(przedmioty, profesje i questy) pozostają plikami YAML w repozytorium.

## Lokalny start

1. Uruchom bazę: `docker compose up -d db`
2. Skopiuj `server/.env.example` do `server/.env`.
3. Uruchom migracje: `npm --prefix server run db:migrate`
4. Uruchom serwer: `npm --prefix server run dev`

Serwer uruchamia migracje również automatycznie przed rozpoczęciem nasłuchiwania.
W środowisku produkcyjnym ustaw `DATABASE_URL` w sekretach platformy; nie zapisuj
hasła w repozytorium.

## Logowanie i sesje

REST API kont działa pod `/api/auth`. Hasła są haszowane przez Argon2id, a
przeglądarka otrzymuje wyłącznie sesję w ciasteczku `HttpOnly`. Klient pobiera
krótkotrwały, jednorazowy bilet przed wejściem do pokoju Colyseus — identyfikator
postaci przesłany przez przeglądarkę nigdy nie jest traktowany jako dowód
tożsamości.

W produkcji ustaw `NODE_ENV=production`, `CLIENT_ORIGIN` na dokładny adres HTTPS
klienta i `TRUST_PROXY=1` tylko za zaufanym reverse proxy. Klient może wskazać
osobne adresy przez `VITE_API_URL` oraz `VITE_COLYSEUS_URL`.

## Migracje

Każdą zmianę schematu dodaj jako nowy, kolejno numerowany plik SQL w
`server/migrations/`, np. `002_add_mail.sql`. Wykonane migracje są zapisywane w
tabeli `schema_migrations`, więc można bezpiecznie uruchamiać je wielokrotnie.

## Przeniesienie poprzednich zapisów SQLite

Na pustej bazie PostgreSQL wykonaj najpierw migracje, a następnie:

`npm --prefix server run db:import-sqlite -- /ścieżka/do/players.sqlite`

Domyślna ścieżka importera to `server/data/players.sqlite`. Importer nie nadpisuje
niepustej bazy i nie jest używany przez uruchomiony serwer.
