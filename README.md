# Anico 🎴

A self-hosted, multi-player reimagining of **Mudae** as a standalone collecting game: no
Discord, no commands, just a web app you run on your own box. Roll for anime characters,
claim your favourites, build a collection, and grow a credit economy.

One deployment is an **instance**. Players share the instance but their collections are
independent: two people can each own the same character, and nothing one player does can
take a character away from another.

Character data and images come from the [AniList GraphQL API](https://docs.anilist.co/),
fetched by the server and cached in the instance's own database.

## Running an instance

Every push to `master` publishes a multi-arch image to GHCR, so a server needs
**two files**: `docker-compose.yml` and a `.env` next to it.

The repo is private, so copy the two files from your checkout rather than fetching
them over HTTP:

```sh
ssh server 'mkdir -p /srv/anico'
scp docker-compose.yml server:/srv/anico/
scp .env.example server:/srv/anico/.env      # already points at ghcr.io/rakkenti/anico:latest
ssh server 'cd /srv/anico && docker compose up -d'
```

The image itself is a public package, so the server pulls it anonymously and needs no
`docker login`. Package visibility is set separately from the repo's, which is why this
works while `RakkenTi/anico` stays private.

If you ever set the package back to private, the server needs to log in once with a
personal access token carrying the `read:packages` scope:

```sh
echo $GHCR_TOKEN | docker login ghcr.io -u RakkenTi --password-stdin
```

Upgrading is `docker compose pull && docker compose up -d`. The database lives in a
named volume and is untouched by an image change.

**Building from source instead** (no GHCR needed): clone the repo and overlay the
build file:

```sh
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Either way, once it is up:

1. Open the instance and **create the first account**. It becomes the **admin** and
   gets sandbox access. No credentials are baked into the image.
2. The catalog starts filling in the background. It walks the reachable AniList pool
   (330 pages, ~1.1s apart) in about **six minutes**, and resumes where it left off if
   you restart. You can play immediately; early rolls just draw from a smaller pool.
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
| `CLIENT_DIR` | `/app/dist/client` | Where the built client is served from |

`ANICO_IMAGE` and `COOKIE_SECURE` are read from `.env` by compose itself; the rest are
container environment variables.

### Where the data lives

The compose file mounts a **named volume**, not a host directory:

| | |
| --- | --- |
| Volume | `anico_anico-data` |
| On the host | `/var/lib/docker/volumes/anico_anico-data/_data` |
| In the container | `/data`, holding `anico.db` and its `-wal` / `-shm` sidecars |

It survives `docker compose down`, image upgrades and container recreation. It is deleted
by `docker compose down -v`, which is the one command worth being careful with.

Prefer the database in a directory you can see? Swap the mount in `docker-compose.yml`:

```yaml
    volumes:
      - ./data:/data
```

The container runs as uid 1000, and a bind mount keeps the host directory's ownership
rather than the image's, so create it first or the server cannot write:

```sh
mkdir -p data && sudo chown 1000:1000 data
```

### Backups

The entire instance is one SQLite file: accounts, collections, catalog. Stop the
container so the write-ahead log is folded in, then archive the volume:

```sh
docker compose stop
docker run --rm -v anico_anico-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/anico-$(date +%F).tar.gz -C /data .
docker compose start
```

Restoring is the same command with `tar xzf`. Copying `anico.db` while the instance is
running works only if you take the `-wal` and `-shm` files with it.

## Development

```sh
npm install
npm run build         # client into dist/client, server into dist/server
npm start             # run the built server on :8080
npm run dev           # Vite dev server on :5173, proxying /api to :8080
```

Run `npm start` and `npm run dev` together for hot reload against a live API. `npm run
lint` runs oxlint.

## How it fits together

- **Client**: React 19 + Zustand + Vite. Holds a mirror of the server's snapshot plus
  browser-only state (which card is selected, deal animations, toasts). Installable as a
  PWA; the shell is cached, gameplay needs the instance.
- **Server**: Hono on Node, one process serving both the API and the built client. Owns
  every rule that could otherwise be cheated
  ([ADR 0003](./docs/adr/0003-the-server-owns-the-rules.md)).
- **Database**: SQLite in the app container, no separate service
  ([ADR 0001](./docs/adr/0001-sqlite-in-one-container.md)).
- **Catalog**: the instance's own table of characters, filled from AniList. Rolls are a
  local `SELECT`, so play does not depend on AniList being reachable, and one instance
  never has to share its ~90 requests/minute among its players.

The project's vocabulary is in [`CONTEXT.md`](./CONTEXT.md); the decisions worth not
re-litigating are in [`docs/adr/`](./docs/adr/).

## How Mudae's systems map here

| Mudae | Anico |
| --- | --- |
| `$w` / `$h` / `$m` roll commands | **Roll** button + a *Roll for* setting (Waifus / Husbandos / Everyone) |
| Claiming with a reaction, ~3 h claim interval | **Claim** button with a configurable cooldown (default 180 min) |
| 10 rolls per hour | Configurable roll budget (default 10) refilling on a configurable interval |
| Kakera value from character popularity | Credit value derived from AniList favourites on a power curve (≈35 for obscure picks, ≈865 for Levi) |
| Kakera reactions dropping on rolls | Gems (Purple to Light tiers, weighted rarity) drop alongside rolls; tap to collect |
| `$divorce` for kakera | **Sell** any character at the credit value it had when you claimed it |
| One claim per character per server | **Not copied.** Collections are per player ([ADR 0002](./docs/adr/0002-collections-are-per-player.md)) |
| Silver compensation for duplicates | Rolling a character you own pays 10% of its value (20% with Silver IV) |
| `$wish` / wishlist pings | **Wishes** tab: search by name, pin characters; wishes can barge into your rolls |
| Kakera badges (`$kakera`) | **Shop**: the Bronze/Silver/Gold/Sapphire/Ruby/Emerald tree with Mudae's prerequisite chart |
| `$dailykakera` | **Daily offering** in the header, every 20 h, with a streak bonus |
| `$resetclaimtimer` (Emerald badge) | The **Claim Reset ritual**, unlocked by Emerald I |
| `$harem` | **Collection** tab: search, filters, sorting, total worth, detail view |

## Beyond Mudae

- **×10 summons** with a staggered card spread; pick any card to claim
- **Rarity tiers**: Common / Rare / Epic / Legendary / Mythic frames, with a foil shimmer
  on Mythic
- **Series sets**: claiming 3 / 5 / 10 characters from one series pays one-time bonuses
- **Daily streaks**: consecutive offerings grow the payout
- **Stats page**: animated charts over your collection, rolls and claims
- **Sandbox**: an admin-granted per-account privilege that lifts limits and unlocks bulk
  operations, enforced server side

*This is an unaffiliated fan project. Character data © their respective owners, served by
AniList. Sound effects (CC0) by [Kenney](https://kenney.nl/assets).*
