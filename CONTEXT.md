# Anico: domain language

The project's own words, with tight definitions. Vocabulary only, no implementation
detail and no specification.

## Deployment and people

**Instance** — one self-hosted deployment of Anico: one server process, one database, one
set of accounts. Players share an instance. Nothing is shared *between* instances, and an
instance is the unit an owner runs on their own hardware.

Never called a "server" in prose: that word means the process, and "your collection is
per server" would read as being about the deployment rather than the machine.

**Server** — the HTTP process serving the instance. The word means the process and
nothing else.

**Account** — a username and password held by the instance. Credentials only; not the
game-facing identity.

**Player** — the game-facing actor an account belongs to: the one who rolls, claims and
owns a collection. "Account" is who logs in, "player" is who plays.

**Admin** — the account created by the first registration on a fresh instance. Issues
invites and holds sandbox access.

**Invite** — a code or link, issued by the admin, that permits one registration. After
the first account exists, registration is closed except through an invite.

**Sandbox** — a scratch *profile*, not a state the account is in. The admin grants the
privilege; the player switches it on, and gets a separate empty collection with its own
credits. Nothing done there touches their real one, and none of it survives switching
back or restarting the instance. Every badge is already paid for there: free ×100 summons
and claim all, without buying anything. An admin privilege, not a setting a player can grant
themselves.

## The catalog

**Character** — a catalogue entry drawn from AniList: id, name, images, gender,
favourites, series. Characters exist on an instance whether or not anyone owns them.

**Catalog** — the instance's local table of characters, filled from the AniList API and
kept as the source rolls draw from. It is a cache in origin and a database in use: once
warm, play does not depend on AniList being reachable.

**Segment** — one sweep of the crawl: a media type (anime or manga) and a rank of cast
(headline or supporting). AniList refuses to paginate past 5000 entries, so no single
query can reach the whole catalog; the segments are how it is reached anyway, and they
run one after another into the same table.

**Series** — the show or work a character appears in. Owning several characters from one
series is a **series set**, which pays a one-time bonus at 3, 5 and 10.

## Playing

**Roll** — one draw from the catalog, presented as a card. A single summon is free and
unlimited: it costs nothing and waits for nothing (see ADR 0004). A pack is not free —
see **Pack price**.

**Claim** — a player taking ownership of a rolled character. Also free and unlimited; a
single summon is the only place it is asked, because a pack grants its own contents.

**Pack** — a sealed multi-card summon, unlocked and sized by the **Sapphire** badge and
the **Deeper Packs** upgrade.
Every card in it is granted the moment it is rolled, so opening it decides nothing and
cannot be lost to a closed tab: tearing it with space and throwing the cards off one by
one reach the same place. Presentation, deliberately. The cards are face up throughout —
a pack is a thing you unwrap, not a guess.

**Pack price** — what opening a pack costs, twelve credits a card, always less than the
cards inside are worth. The sink the whole economy turns on (ADR 0005): credits used to
have nothing to buy once the shop was finished, which took about ten minutes.

**Guarantee** — the rarity floor **Emerald** promises every pack: a Rare or better at I,
rising to Mythic at IV. Honoured by swapping the weakest card of a draw for one good
enough, so a guarantee never makes a pack bigger, and skipped outright when the catalog
holds nobody that good yet.

**Bulk mode** — the Collection's selection state. Cards are picked rather than opened,
"select all" takes everything the filters are showing, and the lot is sold in one go.
Available to every player, because the screen where a collection actually gets pruned is
a phone.

**Coin** — a drop that sometimes accompanies a summon, worth a band of credits when
gathered. Roughly one summon in fifty. There is exactly one kind: it was a nine-rung
ladder of metals (copper, electrum, mythril and friends) until it became clear nobody
could say which of them was worth more than which.

**Collection** — the characters one player has claimed. Collections are **per player and
isolated**: two players on the same instance can each own the same character, and no
action by one player can remove or block a character for another (see ADR 0002).

**Card** — how a character is presented in the UI: a portrait, its series, its rarity
frame and its credit value. A card is a view of a character, not a separate thing a
player owns.

**Credit** — the currency. Earned by claiming, selling, daily offerings and coin drops;
spent in the shop.

**Credit value** — a character's worth, derived from its AniList favourites on a power
curve. The single number the rest of the game reads from: rarity, sell price and
duplicate compensation all descend from it.

**Rarity** — the band a credit value falls into: Common, Rare, Epic, Legendary, Mythic. A
presentation of credit value, not a separate fact about a character.

**Gem** — what a **Coin** was called before it was rethemed. Kept here only so the
term is recognisable in older commits and comments.

**Pacing** — *retired.* The hourly summon budget, the daily ×10 and the hourly claim,
which Normal mode kept and Fun mode ignored. Both modes are gone (ADR 0004); the word
survives only in older commits.

**Wish** — a character a player has pinned. Wishes can barge into any roll.

**Badge** — a permanent perk bought with credits, in the Bronze through Emerald tree. Six
lines of four levels, each level three times the price of the one below it. Badges change
the rules of the loop (pack size, guarantees, wish slots, drop rates) rather than paying
out once.

**Upgrade** — the other half of the shop: four lines with no last level worth reaching
(Deeper Packs, Swift Hands, Appraisal, Fortune), each level costing a fixed multiple of
the last. Badges give the game its shape; upgrades give it its curve.

**Icon** — the game art, all of it Kenney's CC0 packs, vendored in `src/assets/icons` and
painted as CSS masks so one file serves every theme. Never drawn by hand here: the
typographic glyphs it replaced (✦ ▦ ★ ⚙) rendered differently on every platform.
