# Anico 💠

A fan-made, cross-platform reimagining of **Mudae** as a standalone collecting
game with no Discord, no commands, just a fast web app. Roll for anime characters,
claim your favorites, build a collection, and grow a credit economy.

Character data and images come live from the [AniList GraphQL API](https://docs.anilist.co/)
(no API key required).

## Running it

```sh
npm install
npm run dev      # local dev server
npm run build    # production bundle in dist/ (fully static, host anywhere)
```

The production build is a static bundle (~68 KB gzipped) that runs in any
modern browser, and can be wrapped with Tauri or Capacitor for native
desktop/mobile builds. Your save lives in `localStorage`.

## How Mudae's systems map here

| Mudae | Anico |
| --- | --- |
| `$w` / `$h` / `$m` roll commands | **Roll** button + a *Roll for* setting (♀ Waifus / ♂ Husbandos / ✨ Everyone) |
| Claiming with a reaction, ~3 h claim interval | **Claim** button with a configurable cooldown (default 180 min) |
| 10 rolls per hour | Configurable roll budget (default 10) refilling on a configurable interval (default 60 min) |
| Kakera value from character popularity | Value derived from AniList favourites on a power curve (≈35 for obscure picks, ≈865 for Levi) |
| Kakera reactions dropping on rolls | Gems (Purple → Light tiers, weighted rarity) randomly drop alongside rolls; tap to collect before your next roll |
| `$divorce` for kakera | **Sell** any character from your collection at its credit value |
| Silver compensation for duplicates | Rolling a character you own pays 10% of its value (20% with Silver IV) |
| `$wish` / wishlist pings | **Wishes** tab: search AniList by name, pin characters; wishes can barge into your rolls, with the chance boosted by Silver/Ruby badges |
| Kakera badges (`$kakera`) | **Shop**: the full Bronze/Silver/Gold/Sapphire/Ruby/Emerald badge tree (levels I–IV) with Mudae's real prerequisite chart, rebalanced for single-player |
| `$dailykakera` | **Daily offering** button in the header, every 20 h, with a streak bonus (and doubled by Gold IV) |
| `$resetclaimtimer` (Emerald badge) | The **Claim Reset ritual** on the Summon screen, unlocked by Emerald I, faster with each level |
| `$harem` | **Collection** tab: search, gender/rarity/series filters, sorting, total worth, character detail view |

## Settings

Everything lives in the **Settings** tab:

- **Roll for**: female, male, or everyone
- **Character pool**: ~1k / 5k / 10k / 25k characters, drawn from the most popular series on AniList (bigger pools reach more obscure series)
- **Skip owned**: never roll duplicates (or keep them on for compensation credits)
- **Rolls per reset**, **roll reset interval**, and **claim cooldown** sliders
- **Reset save**: wipe everything and start fresh
- **Sandbox (testing) mode**: removes roll limits and every cooldown, and adds a
  +1000 credits debug button, so the whole loop can be exercised quickly

## Beyond Mudae

- **×10 summons**: spend up to ten rolls at once for a staggered card spread;
  pick any card in the spread to claim, duplicates auto-compensate and gem
  drops from the whole spread pool together
- **Rarity tiers**: Common / Rare / Epic / Legendary / Mythic frames
  derived from credit value, with a foil shimmer on Mythic cards
- **Series sets**: claiming 3 / 5 / 10 characters from the same series pays
  one-time credit bonuses; progress chips live in the Collection tab
- **Daily streaks**: consecutive daily offerings grow the payout (up to +60)

## Tech stack

- **Vite + React 19 + TypeScript**: instant dev loop, tiny static output
- **Zustand** (with `persist`): game state machine + localStorage saves
- **AniList GraphQL**: characters, images, gender, favourites. AniList caps
  offset pagination at 5,000 entries, so deep pools can't page characters
  directly; instead one request fetches a random page of 15 popular series and
  each series' top characters (~250 candidates per request). Rolls consume that
  buffer, so even ×10 summons cost ~1 API request per hundreds of rolls

*This is an unaffiliated fan project. Character data © their respective owners, served by AniList.*
