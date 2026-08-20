# Anico 🎴

A self-hosted, multi-player anime character collecting game: no Discord, no commands,
just a web app you run on your own box. Summon characters, claim your favourites, build a
collection, and spend the credits it earns on a badge tree that makes the next summon
worth more.

One deployment is an **instance**. Players share the instance but their collections are
independent: two people can each own the same character, and nothing one player does can
take a character away from another.

Character data and images come from the [AniList GraphQL API](https://docs.anilist.co/),
fetched by the server and cached in the instance's own database.

## Running an instance

Every push to `master` publishes a multi-arch image to GHCR, so a server needs
**two files**: `docker-compose.yml` and `setup.sh`. A `.env` beside them is optional,
holding overrides only.

The repo is private, so copy them from your checkout rather than fetching them over HTTP:

```sh
ssh server 'mkdir -p /srv/anico'
scp docker-compose.yml setup.sh .env.example server:/srv/anico/
ssh server 'cd /srv/anico && ./setup.sh && docker compose up -d'
```

[`setup.sh`](./setup.sh) is the part worth not skipping. It checks Docker is reachable,
writes a `.env` from the example, and — the reason it exists — creates `./anico-data`
owned by the uid the container actually runs as. It asks the image rather than assuming,
and it is safe to re-run.

The image itself is a public package, so the server pulls it anonymously and needs no
`docker login`. Package visibility is set separately from the repo's, which is why this
works while `RakkenTi/anico` stays private.

If you ever set the package back to private, the server needs to log in once with a
personal access token carrying the `read:packages` scope:

```sh
echo $GHCR_TOKEN | docker login ghcr.io -u RakkenTi --password-stdin
```

Upgrading is `docker compose pull && docker compose up -d`, or nothing at all if you
leave watchtower running (see below). The database lives in `./anico-data` and is
untouched by an image change.

**Building from source instead** (no GHCR needed): clone the repo and overlay the
build file:

```sh
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Either way, once it is up:

1. Open the instance and **create the first account**. It becomes the **admin** and
   gets sandbox access. No credentials are baked into the image.
2. The catalog starts filling in the background. It walks AniList in four sweeps — anime
   then manga, headline cast then supporting — 800 requests 15s apart, so a **complete**
   catalog takes about **3½ hours** and resumes where it left off if you restart. The
   pace is deliberate: it keeps the instance well inside AniList's request budget and
   leaves room for player searches. You can play immediately; the first sweep is
   most-popular-first, so the characters people actually hunt land in the first hour.
3. Invite the others: **Settings, Instance, Create an invite link**. Each invite works
   once, and registration is closed to anyone without one.

### Behind Caddy

The instance speaks plain HTTP and binds to localhost, so it is only reachable through
your reverse proxy. Copy the block from [`Caddyfile.example`](./Caddyfile.example):

```caddy
anico.example.com {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8080
}
```

Running on a LAN with no TLS at all? Publish the port directly and set
`COOKIE_SECURE: "false"` in `docker-compose.yml`, or the browser drops the session cookie
and login appears to do nothing.

### Configuration

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `8080` | Port the server listens on |
| `DATA_DIR` | `/data` | Where `anico.db` lives. Back this directory up |
| `COOKIE_SECURE` | `true` | Session cookie's `Secure` flag. `false` for plain-HTTP LAN |
| `CRAWL_ON_BOOT` | `true` | Fill the character catalog on startup |
| `CRAWL_DELAY_MS` | `15000` | Gap between catalog requests. The default walks all four sweeps in about 3½ hours at ~4 requests/minute, leaving AniList's budget to player searches |
| `MAX_DB_BYTES` | `1073741824` | The crawl stops rather than grow the database past this. A full four-sweep catalog settles well under 100 MB, so the 1 GB default is headroom, not a limit you meet |
| `CLIENT_DIR` | `/app/dist/client` | Where the built client is served from |

`ANICO_IMAGE`, `COOKIE_SECURE` and `WATCHTOWER_POLL_INTERVAL` are read from `.env` by
compose itself; the rest are container environment variables. All of them have defaults,
so an instance runs with no `.env` at all.

`ANICO_IMAGE` defaults to `ghcr.io/rakkenti/anico:latest`. The package is public, so the
server pulls it anonymously. Override it only to **pin a tag** — with watchtower following
`:latest` every minute, pinning is how you freeze on a known-good build or roll back after
a bad one, and watchtower will not move you off a pinned tag:

```sh
ANICO_IMAGE=ghcr.io/rakkenti/anico:sha-1a2b3c4
```

GHCR image names are lowercase, so it is `rakkenti/anico` even though the repo is
`RakkenTi/anico`. The publish workflow lowercases it for you; typing it by hand is where
it bites.

### Where the data lives

The compose file bind-mounts a directory beside itself, so the database is somewhere you
can see, back up and rsync without going through Docker:

| | |
| --- | --- |
| On the host | `./anico-data` |
| In the container | `/data`, holding `anico.db` and its `-wal` / `-shm` sidecars |

It survives `docker compose down`, image upgrades and container recreation, and unlike a
named volume it is not removed by `docker compose down -v`.

The container runs as **uid 1000**, and a bind mount keeps the host directory's ownership
rather than the image's. A directory created by root leaves the server unable to write its
own database, which is what `setup.sh` exists to prevent. By hand it is:

```sh
mkdir -p anico-data && sudo chown -R 1000:1000 anico-data
```

Coming from an older instance that used the `anico_anico-data` named volume? Copy it
across once before switching:

```sh
docker compose down
docker run --rm -v anico_anico-data:/from -v "$PWD/anico-data":/to \
  alpine sh -c 'cp -a /from/. /to/'
sudo chown -R 1000:1000 anico-data
docker compose up -d
```

### Backups

The entire instance is one SQLite file, so **stop the container and copy `./anico-data`**.
Nothing more elaborate is needed, and a host-level backup that shuts containers down one
at a time and archives their directories covers this instance correctly as-is.

Stopping first is what makes it safe rather than merely convenient. The server closes the
database on `SIGTERM`, which folds the write-ahead log into `anico.db` and removes the
`-wal` / `-shm` sidecars, leaving one self-contained file:

```console
$ ls anico-data          # running
anico.db  anico.db-shm  anico.db-wal
$ docker compose stop && ls anico-data
anico.db
```

The close takes about 10 ms, so it lands well inside the 10 s Docker allows before it
resorts to `SIGKILL`. Copying `anico.db` from a **running** instance is the case to
avoid: in WAL mode recent writes may still be in `anico.db-wal`, so the copy can silently
miss everything since the last checkpoint.

Restoring is the reverse — drop the file back with the container stopped:

```sh
docker compose stop
cp /path/to/backup/anico.db anico-data/anico.db
rm -f anico-data/anico.db-wal anico-data/anico.db-shm
sudo chown 1000:1000 anico-data/anico.db
docker compose start
```

### Staying up to date, and staying up

The compose file ships two small helpers beside the instance:

| | |
| --- | --- |
| **watchtower** | Checks for a newer image every 60 s and recreates the containers using it |
| **autoheal** | Restarts any container whose healthcheck has gone unhealthy |

Autoheal earns its place because Docker's own `restart: unless-stopped` only reacts to a
container that has *exited*. A process that has wedged while still holding its port stays
"up" forever. The image ships a healthcheck; autoheal is what acts on it.

Watchtower polls every minute, which suits pushing to `master` often and wanting the
instance to follow: a push is live a minute or two after the image publishes. Raise
`WATCHTOWER_POLL_INTERVAL` in `.env` to slow it down. Note that
`WATCHTOWER_POLL_INTERVAL` and `WATCHTOWER_SCHEDULE` are mutually exclusive — set both
and watchtower refuses to start.

Both are scoped by label, so neither touches anything else on the box — watchtower runs
with `WATCHTOWER_LABEL_ENABLE`, and only the three containers in this file carry the
label. Two things to know before leaving them on:

- Both need `/var/run/docker.sock`, which is **equivalent to root on the host**. They are
  not reachable from the network, but that is the trade being made.
- Watchtower updating `:latest` means **database migrations run unattended**, and at a
  60 s poll they land within a minute or two of a push. Migrations are forward-only with
  no automatic rollback, so a bad one reaches the instance before you do. Pin a version
  tag in `.env` if you would rather approve each upgrade.

Drop either service from `docker-compose.yml` if you would rather not run it.

## Development

```sh
npm install
npm run build         # client into dist/client, server into dist/server
npm start             # run the built server on :8080
npm run dev           # Vite dev server on :5173, proxying /api to :8080
```

Run `npm start` and `npm run dev` together for hot reload against a live API. `npm run
lint` runs oxlint.

`npm run shots` drives the running instance with a real browser and writes screenshots to
`shots/` at a desktop, a phone and a small phone size: the summon screen, a pack being
torn open, the collection in bulk mode, the wishlist and the shop. Every mobile problem
this app has had was found by looking rather than by reasoning, and it captures the
states that only exist mid-gesture — a pack half torn, a card mid-throw — which are
exactly the ones that went wrong. It needs an account that already owns Sapphire to reach
the pack states; without one it shoots the single-summon screen and moves on. It uses `playwright-core`, which ships no browsers of its own and borrows a
Chromium already on the machine; `npx playwright install chromium` provides one if there
is none, or point `PLAYWRIGHT_CHROMIUM` at an existing binary.

## How it fits together

- **Client**: React 19 + Zustand + Vite. Holds a mirror of the server's snapshot plus
  browser-only state (which card is selected, deal animations, toasts). Installable as a
  PWA; the shell is cached, gameplay needs the instance. Icons are Kenney's CC0 art,
  painted as CSS masks so one file follows every theme.
- **Server**: Hono on Node, one process serving both the API and the built client. Owns
  every rule that could otherwise be cheated
  ([ADR 0003](./docs/adr/0003-the-server-owns-the-rules.md)).
- **Database**: SQLite in the app container, no separate service
  ([ADR 0001](./docs/adr/0001-sqlite-in-one-container.md)).
- **Catalog**: the instance's own table of characters, filled from AniList in four
  sweeps, because no single query can paginate past 5000 entries. Rolls are a local
  `SELECT`, so play does not depend on AniList being reachable, and one instance never
  has to share its ~90 requests/minute among its players.

The project's vocabulary is in [`CONTEXT.md`](./CONTEXT.md); the decisions worth not
re-litigating are in [`docs/adr/`](./docs/adr/).

## The game

**Summon.** One card at a time, free and unlimited: nothing is on a cooldown
and there is no allowance to spend ([ADR 0004](./docs/adr/0004-nothing-is-paced.md)).
Claim the ones you want, sell the ones you do not, and pick who shows up in
*Settings, Roll for* (Waifus / Husbandos / Everyone).

**Packs are what credits are for.** A fresh account has the single summon and
nothing else. The **Sapphire** badge unlocks a sealed ×10 and grows it to ×15,
×20 and ×25; the **Deeper Packs** upgrade takes it to ×50, ×75, ×100 and past
that. A pack costs twelve credits a card — always less than the cards inside
are worth, so opening one and selling what you did not want is the loop
([ADR 0005](./docs/adr/0005-credits-buy-packs.md)).

A pack comes wrapped in seamless foil, tinted by the best card inside: drag
across it and a rip travels along the seam, accumulating as you pull — a
partial tear stays torn, so you can saw at it exactly as you would a real one.
Underneath, the cards are face up in a stack showing a sliver of each; throw the
top one aside to reach the next, as fast as you like. <kbd>Space</kbd> before
the tear opens the whole thing for you; after a hand tear it throws one card a
press — and past two dozen cards it lays the rest out at once rather than making
you watch. **Every card in a pack is yours the moment it is rolled**, however
you choose to open it, so how you open it is ceremony; the next summon waits
until this one is out of the wrapper. Once it is laid out, *Best first* sorts
the spread by value so the one card worth finding in a hundred is at the top.

**The shop is the whole progression**, and it is deliberately long. Every price
is a multiple of the one below it, so the first hour is generous and the tenth
is deliberate.

*Upgrades* are the long game — each level costs a multiple of the last:

| Upgrade | What each level buys |
| --- | --- |
| **Deeper Packs** | +25 cards a pack |
| **Both Hands** | One more pack torn at the same press |
| **Swift Hands** | Packs deal and throw 10% faster, compounding |
| **Appraisal** | +5% on everything you sell and every duplicate |
| **Fortune** | Coins fall more often and are worth more |
| **The Automaton** | Presses the summon button for you, faster each level |

*Badges* are six short ladders, four rungs each, every rung three times the last:

| Badge | What it buys |
| --- | --- |
| **Bronze** | Wish slots, and +100 credits when you claim a wished character |
| **Silver** | The chance your wishes barge into a roll, and double duplicate compensation |
| **Gold** | Coin drop chance, and a doubled daily offering |
| **Sapphire** | **Packs**: ×10 at I, then ×15, ×20, ×25 · at IV, every pack drops a coin |
| **Ruby** | More wish slots, wish chance and coin chance · at IV, everything in the shop costs 25% less |
| **Emerald** | A **guarantee**: every pack holds a Rare or better, rising to Mythic · at IV, claims pay back a quarter of a character's value |

Sapphire, Ruby and Emerald need progress in the first three lines, or any two
badges raised to IV.

**Everything else.**

- **Credit value**: a character's worth, from its AniList favourites on a power
  curve (≈35 for obscure picks, ≈865 for Levi). Rarity frame, sell price and
  duplicate compensation all descend from it
- **Rarity tiers**: Common / Rare / Epic / Legendary / Mythic frames, with a foil
  shimmer on Mythic
- **Wishes**: pin characters by name. A wish barging into a roll is rare on
  purpose — roughly one pack of a hundred in seven with three pinned, better
  with the badges that improve the odds, and never more than one to a summon
- **Duplicates stack.** A second copy of a character joins its stack instead of
  paying out, and every doubling merges the stack a star higher: ★1 at two
  copies, ★2 at four, ★3 at eight. A star multiplies what the whole stack
  sells for, so holding beats selling by a wide margin
  ([ADR 0006](./docs/adr/0006-duplicates-are-copies.md))
- **Auto-sell**: pick a rarity in the summon view and anything below it is sold
  as it lands. It never sells a wish, and never a stack that has begun to merge
- **Coins**: one coin, worth a band of credits, landing on about one summon in
  fifty. Gathered where they fall
- **Selling**: any character, at what Appraisal says it is worth. **Bulk mode**
  in the Collection picks many at once — with *select all* honouring whatever
  the filters are showing — and sells the lot in one go
- **Series sets**: claiming 3 / 5 / 10 characters from one series pays one-time
  bonuses
- **Daily offering**: every 20 h, with a streak bonus
- **Stats page**: animated charts over your collection, rolls and claims
- **Sandbox**: an admin-granted privilege to switch into a *scratch profile* with
  its own credits and its own empty collection. Nothing done in it touches the
  collection you care about, and none of it is kept: leaving deletes it, and so
  does restarting the instance. Packs are free and a hundred cards wide in there

*This is an unaffiliated fan project. Character data © their respective owners, served by
AniList. Icons and sound effects (CC0) by [Kenney](https://kenney.nl/assets); the icons are
vendored in [`src/assets/icons`](./src/assets/icons) with their licence.*
