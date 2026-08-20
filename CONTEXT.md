# Anico: domain language

The project's own words, with tight definitions. Vocabulary only, no implementation
detail and no specification.

## Deployment and people

**Instance** — one self-hosted deployment of Anico: one server process, one database, one
set of accounts. Players share an instance. Nothing is shared *between* instances, and an
instance is the unit an owner runs on their own hardware.

Never called a "server" in prose. Mudae uses "server" for the Discord guild that a claim
is exclusive to, and reusing that word here would make the sentence "your collection is
per server" mean two incompatible things.

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
back or restarting the instance. No roll limits, no cooldowns, and bulk operations (×100
summons, claim all, sell all). An admin privilege, not a setting a player can grant
themselves.

## The catalog

**Character** — a catalogue entry drawn from AniList: id, name, images, gender,
favourites, series. Characters exist on an instance whether or not anyone owns them.

**Catalog** — the instance's local table of characters, filled from the AniList API and
kept as the source rolls draw from. It is a cache in origin and a database in use: once
warm, play does not depend on AniList being reachable.

**Series** — the show or work a character appears in. Owning several characters from one
series is a **series set**, which pays a one-time bonus at 3, 5 and 10.

## Playing

**Roll** — one draw from the catalog, presented as a card. Two budgets, deliberately
unconnected: single summons are an hourly allowance the shop can grow, and the **×10
summon** is its own once-a-day event that spends no hourly summons.

**Claim** — a player taking ownership of a rolled character. Claims are gated by their
own cooldown, one an hour, separate from both roll budgets.

**Mode** — how strictly time is kept, chosen per player. **Fun** is the default and has
no cooldowns at all; its ×10 arrives as a **pack**. **Normal** is the paced game.
Switching is not a cheat vector because the permissive mode is the default: the only
thing a switch can do is add limits.

**Pack** — a Fun-mode ×10, sealed. Every card in it is granted the moment it is rolled,
so opening it decides nothing and cannot be lost to a closed tab: tearing it with space
and swiping it open card by card reach the same place. Presentation, deliberately.

**Pacing** — the roll and claim rates that Normal mode keeps. Fixed by the instance and
identical for everyone on it. They were once per-player sliders, which on a shared
instance only meant each player set their own difficulty.

**Coin** — a minted drop that sometimes accompanies a summon, worth a band of credits
when gathered. Roughly one summon in twenty-five. Called a gem until it was rethemed.

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

**Wish** — a character a player has pinned. Wishes can barge into any roll.

**Badge** — a permanent upgrade bought with credits, in the Bronze through Emerald tree.
Badges change the rules of the loop (roll budget, cooldowns, drop rates) rather than
paying out once.
