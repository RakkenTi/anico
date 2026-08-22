# Anico

A self-hosted incremental anime character collecting game. 

![Anico: one free card, a first pack, then ten packs of nineteen hundred](./docs/img/hero.gif)

**[Play the demo](https://demo.anico.markmartinez.ca/)**: note that the demo does not save your data. If you'd like to play the full game, you'll have to host an instance.

## Features

### Pull packs

A single summon is free. Packs cost credits and hold more, from ten cards to millions.

![Opening a pack](./docs/img/opening.gif)

### Merging

Whenever you get a duplicate card, it is merged with your existing collection, which increases the value of the character exponentially, until it is sold.

![A pack laid out](./docs/img/spread.jpg)

### Incremental Scaling

Some upgrades have limits, others don't. It's an incremental game, so numbers do get pretty massive. 

![The shop](./docs/img/shop.jpg)

### Contracts
Contracts are a side mechanic that pays you extra for holding a specific set of characters based on a series at a certain rank.

![Contracts](./docs/img/contracts.jpg)

### Leaderboard
Compare your progress with other players on the same instance!

![The leaderboard](./docs/img/ranks.jpg)

### The rest
- **Auto Summon**: tired of clicking? The automaton upgrade is for you.
- **Offline Earnings:** earn while you're offline!
- **Wishes**: wish for a character, and you may find them appearing more often!

![Collection](./docs/img/collection.jpg)

## Running an instance

One container and one directory. You need Docker with the compose plugin, and nothing else.
On the machine that will host it:

```sh
curl -fsSL https://raw.githubusercontent.com/RakkenTi/anico/master/install.sh | bash
```

That puts the compose file in `./anico` and starts the instance on port 8080. Safe to re-run:
it leaves your `.env` and database alone. Read it first if you like, it is
[short](./install.sh).

Building the image yourself instead:

```sh
git clone https://github.com/RakkenTi/anico && cd anico
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Open `http://localhost:8080` and **create the first account**: it becomes the admin, and on
an empty database the first person to register wins, so do it before the port is reachable
from anywhere else. Then **Settings → Instance → Create an invite link** to let anyone else
in. Nobody can register without one.

The character catalog fills in over a few hours and resumes if you restart. You can play
immediately; early rolls just draw from a smaller pool.

### Behind a reverse proxy

The instance speaks plain HTTP on localhost. See [`Caddyfile.example`](./Caddyfile.example):

```caddy
anico.example.com {
	reverse_proxy 127.0.0.1:8080
}
```

Caddy in Docker too? Same network, container name: `reverse_proxy anico:8080`.

On a LAN with no TLS, set `COOKIE_SECURE: "false"`, or the browser drops the session cookie
and login silently fails.

### Configuration

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `8080` | Port the server listens on |
| `DATA_DIR` | `/data` | Where `anico.db` and `backups/` live |
| `COOKIE_SECURE` | `true` | Session cookie's `Secure` flag. `false` for plain-HTTP LAN |
| `CRAWL_ON_BOOT` | `true` | Fill the character catalog on startup |
| `CRAWL_DELAY_MS` | `15000` | Gap between catalog requests |
| `MAX_DB_BYTES` | `1073741824` | The crawl stops rather than grow past this |
| `CLIENT_DIR` | `/app/dist/client` | Where the built client is served from |

`ANICO_IMAGE` defaults to `ghcr.io/rakkenti/anico:latest`. Override it to pin a tag, which is
how you freeze or roll back; watchtower will not move you off a pinned tag.

### Backups

**Settings → Instance → Backups.** Everyone's data is copied into `anico-data/backups/` on a
timer, oldest dropped once you are over the count or the size you set, five always kept.
Download or restore any of them from the panel.

The catalog is left out: it is the big half of the database and AniList will hand it back for
free. The cards people own do travel with the file.

Restoring replaces **every** player's collection, credits and purchases, so it asks for the
admin password, saves a copy of the present first, and signs everybody out.

For the whole file instead, stop the container and copy `anico-data/`. Stopping is what makes
it safe.

### Watchtower and autoheal

Both ship in the compose file, labelled so they touch nothing else on the box. Watchtower
keeps the image current; autoheal restarts a container whose healthcheck has gone bad. They
need `/var/run/docker.sock`, which is root on the host, and following `:latest` means
**migrations run unattended**. Pin a tag in `.env` if you would rather approve each upgrade.

Open tabs reload themselves when the container comes back on a new image.

# Development

```sh
npm install
npm run dev           # a whole game: instance on :8090, client on :5173
npm run build         # client into dist/client, server into dist/server
npm start             # the built server on :8080
npm run lint          # oxlint
npm test              # the demo's SQLite shim, and the drift guards
```

`npm run dev` is the only one you need: it starts the server and Vite together, both
watching. Its database is `devdata/`, gitignored and disposable, so **delete the directory to
start the game over**. It comes seeded from the demo's catalog, so your first summon deals a
real character and the crawl never runs. Port 8090 on purpose: 8080 is where a real instance
lives.

```sh
ANICO_DEV_PORT=9001 npm run dev              # the instance somewhere else
ANICO_DEV_CRAWL=true npm run dev             # fill the dev catalog from AniList
ANICO_API=http://127.0.0.1:8080 npm run dev  # no instance; client against that one
npm run dev:client                           # Vite alone
```

`npm run shots` writes screenshots at desktop and phone sizes. `npm run stress` plays the end
game, eleven million cards a pull in forty-one wrappers against a collection of sixty-five
thousand, and exits non-zero on anything over budget. Both need a Chromium:
`npx playwright install chromium`.

## Branches

`master` publishes `:latest`, which is what instances follow. `dev` publishes `:dev`, which
nothing follows unless you point it there, so it is where a build goes to be tried before
anybody else gets it.

```sh
docker compose -f docker-compose.dev.yml up -d   # :dev, on port 8081
```

Give it its own data. Migrations only run forwards, so a dev build that adds one leaves that
database unopenable by the released image. Copy a backup in rather than sharing the real
directory.

## The demo

[demo.anico.markmartinez.ca](https://demo.anico.markmartinez.ca/) is a static page hosted on
GitHub Pages. It lacks many of the features an instance has, but it is useful for testing the
summoning system. There is no server: the whole thing is compiled to WebAssembly and runs in
the tab.

```sh
npm run bake:catalog   # crawls AniList once into demo/public/catalog.db
npm run build:demo     # into dist/demo
npm run smoke:demo     # boots it in a real browser and plays it
```

`npm test` runs the demo's SQLite shim against real better-sqlite3, plus the guards that keep
the demo honest: a second path to `/api` or a Node import in the rules fails the suite rather
than the demo.

## Stack

React 19, Zustand and Vite on the client. Hono on Node for the server, one process serving
both the API and the built client. SQLite in the same container, no separate service.

The server owns every rule, so nothing worth cheating at happens in the browser, and every
change is pushed to your other devices over SSE. Characters are crawled from AniList once
into a local table, so play never depends on AniList being up.

# Licence

[AGPL-3.0](./LICENSE). Run it, change it, host it for your friends. If you run a modified
version as a service for other people, publish your changes.

*An unaffiliated fan project. Character data © their respective owners, served by AniList.
Icons and sound effects (CC0) by [Kenney](https://kenney.nl/assets), vendored in
[`src/assets/icons`](./src/assets/icons) with their licence.*
