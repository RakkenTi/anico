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

```sh
docker compose up -d
```

That is the whole setup. It builds the image, creates a named volume for the database, and
listens on `127.0.0.1:8080`. Then:

1. Open the instance and **create the first account**. It becomes the **admin** and gets
   sandbox access. No credentials are baked into the image.
2. The catalog starts filling in the background. It walks the reachable AniList pool
   (330 pages, ~1.1s apart) in about **six minutes**, and resumes where it left off if you
   restart. You can play immediately; early rolls just draw from a smaller pool.
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

### Backups

The entire instance is one SQLite file. Copy `anico.db` (with its `-wal` sidecar, or stop
the container first) and you have everything: accounts, collections, catalog.

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
