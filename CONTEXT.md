# Anico: domain language

The project's own words, with tight definitions. Vocabulary only, no implementation
detail and no specification.

## Deployment and people

**Instance** — one self-hosted deployment of Anico: one server process, one database, one
set of accounts. Players share an instance. Nothing is shared *between* instances, and an
instance is the unit an owner runs on their own hardware.

**Device** — one browser tab holding a session. An account may have several at once and
they are meant to be played at once: each runs its own Auto Summon, each acts on its own,
and the instance pushes every result to all of them (**live sync**). Devices never merge
anything and never talk to each other; the server decided the order and they are told
what is true.

**Live sync** — the stream of authoritative snapshots the instance pushes to a player's
devices after every mutation. Carries everything except the collection, which is fetched
separately when its revision moves, because it can be five figures of cards.

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
privilege; the player switches it on, and gets a separate collection with its own credits.
Nothing done there touches their real one, and none of it survives switching back or
restarting the instance. An admin privilege, not a setting a player can grant themselves.

**Stage** — a point in the game a sandbox profile can be put at, from Fresh to Silly. It
seeds badges, upgrades, credits and a collection and then stops: a seeded profile plays by
the ordinary rules, and the summon it presses is the summon everyone else presses. The
stress harness seeds the same way, from the same module, so the two cannot drift.

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

**Pool** — how wide a net every roll on the instance casts: the top N characters by
AniList favourites, turned into a favourites floor at roll time. One number for everybody,
set by the admin. It was a per-player setting until it became clear it is not a preference
but a difficulty: the top two thousand characters are worth several times what the long
tail is (ADR 0003).

**Series** — the show or work a character appears in. Owning several characters from one
series is a **series set**, which pays a one-time bonus at 3, 5 and 10.

## Playing

**Roll** — one draw from the catalog, presented as a card. A single summon is free and
unlimited: it costs nothing, waits for nothing (see ADR 0004) and is yours on arrival. A
pack is not free — see **Pack price**.

**Claim** — a player taking ownership of a rolled character. Not a decision and not a
button: every summon grants what it turns up, single card or hundredth pack. The button
existed only for the single summon, and it meant a free card could be lost to a closed tab
and that **auto-sell** never saw one, because auto-sell reads what a player owns.

**Pack** — a sealed multi-card summon, unlocked and sized by the **Sapphire** badge and
the **Deeper Packs** upgrade. Every card in it is granted the moment it is rolled, so
opening it decides nothing and cannot be lost to a closed tab: tearing it with space and
throwing the cards off one by one reach the same place. Presentation, deliberately. The
cards are face up throughout — a pack is a thing you unwrap, not a guess.

**Pull** — one press of a pack button, and everything it produces. Opened by hand, a pull
takes *one* gesture however many packs it holds: a single drag tears every wrapper, and
each swipe afterwards takes the top card off every stack. Aiming at one of five stacks on
a phone, and then at each in turn, got worse the more packs you bought, which is backwards
for an upgrade. Opened hands-off -- Space, the button, Auto Summon -- it is the opposite:
one pack at a time, each starting a beat after the last, because nobody is aiming at
anything and five wrappers tearing in unison read as one animation rather than five. There are two presses
once **Both Hands** is bought: one pack, or all of them, torn side by side with their own
wrappers and their own piles. The word exists because "pack" stopped being the unit of a
press. The free single card is neither: it costs nothing and is always there.

**Appraised** — what happens to the part of a pull too large to deal. What is laid out and
granted is as much as your hands can manage: six seconds of **Open Speed**, floored at two
hundred cards and capped at a thousand. The rest is turned straight into credits at what
the dealt cards averaged (ADR 0007). Not a penalty and not a rounding: it is what keeps a
pull of a million cards from being a million rows.

On screen the dealt cards **stand in** for the rest. A wrapper says what the shop sold you
-- two thousand cards, twenty thousand -- and its counter drains to nothing as you throw,
because each card you throw takes its share of the pack with it. Those are the cards being
appraised. The alternative was a pack advertising twenty thousand and handing over thirty,
which is the same arithmetic with the player left out of it.

Ten mounted cards cannot show a pile of two thousand getting shorter, so the *lean* does
it: the fan is scaled by how much of the pack is left, and the last few cards lie almost
flat. Cards leave a grid outwards rather than across it, and only the first two of a batch
are given an animation. Faking the parts nobody can count is what keeps thirteen packs
opening at three hundred cards a second looking like anything at all.

**Pack price** — what opening a pack costs, twelve credits a card, always less than the
cards inside are worth. The sink the whole economy turns on (ADR 0005): credits used to
have nothing to buy once the shop was finished, which took about ten minutes.

**Guarantee** — the rarity floor **Emerald** promises every pack: a Rare or better at I,
rising to Mythic at IV and to three Mythics at VI. Honoured pack by pack, by swapping the
weakest cards of that pack for ones good enough, so a guarantee never makes a pack bigger
and never covers only the first wrapper of a pull.

The floor is what the promise aims at, not what it can always reach. Eleven characters on
all of AniList are Mythic, so Emerald VI's three a wrapper is a promise of seventy-two
against a supply of eleven once **Extra Packs** is bought: it falls down the rarity ladder
to the best tier the catalog can still supply, and never below Rare (ADR 0012). Skipped
outright when the catalog holds nobody good enough at all.

**Bulk mode** — the Collection's selection state. Cards are picked rather than opened,
"select all" takes everything the filters are showing, and the lot is sold in one go.
Available to every player, because the screen where a collection actually gets pruned is
a phone.

**Coin** — a drop that sometimes accompanies a summon, worth a band of credits. Roughly
one summon in fifty, and gathered the moment it falls: there used to be a button, which is
a strange thing to ask of someone who has just been handed money. There is exactly one kind: it was a nine-rung
ladder of metals (copper, electrum, mythril and friends) until it became clear nobody
could say which of them was worth more than which.

**Stack** — every copy of one character a player holds. A duplicate joins the stack rather
than paying out, and every doubling **merges** it one **star** higher (★1 at two copies,
★2 at four, ★3 at eight, up to ★12), which multiplies what the whole stack sells for —
further with every level of **Alchemy**. A stack sells whole or not at all (ADR 0006).

**Auto-sell** — a per-player setting: everything below a chosen rarity is queued as it
lands and sold when the *next* summon starts, from a single summon as readily as from a
pack. Never a wish come true, never a stack that has started to merge, and never anything
**locked**. It sold on arrival until the lock existed, which made the two mutually
exclusive: by the time you saw a card it was already money (ADR 0006).

**Lock** — keeping a character on purpose. A locked stack is skipped by the auto-sell
sweep, skipped by a bulk sale and refused by the sell endpoint, so the word means the same
thing everywhere. Checked when the sweep runs, not when the card landed.

**Auto Summon** (the *Automaton* in older commits) — the shop's machine for pressing the
summon button. An autoclicker rather
than a shortcut: it tears the wrappers, swipes the cards away and presses again. Runs in
the player's own browser, on whatever screen the player is looking at, and is charged and
refused by the server exactly as a player would be. Away from the summon view there is
nobody to tear a wrapper, so it settles them itself and carries on.

**Offline earnings** — the upgrade that keeps Auto Summon working while the game is
closed, at a fraction of its speed and for a bounded number of hours. Paid from a smoothed
average of what a pull has recently been worth to that player rather than by replaying the
loop (ADR 0008). *Away* means the whole account: the clock runs from the moment the last
device disconnects, so an idle phone still holding a stream is being played, not left.

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

**Wish** — a character a player has pinned. A wish barging into a roll is deliberately
rare — one to a summon at most — because a wishlist that arrives on demand is a way of
ordering Mythics rather than hoping for one.

**Shop** — two shelves, **Upgrades** and **Badges**, each a list of rows in a fixed
order: side by side where there is room, one at a time behind a switch where there is
not. Fifteen things are for sale and a player checks all of them whenever they have
money, so the whole list wants to be on one screen. Three shapes were tried first: one
panel above another (the lower one went unnoticed), one list sorted by price (it
re-ordered itself under the cursor), and a grid of cards (three hundred pixels a
purchase).

**Badge** — a permanent perk bought with credits, in the Bronze through Emerald tree. Six
lines of six levels, each level five times the price of the one below it. Badges change
what the loop *is* — whether packs exist, how many wishes may be pinned, what a pack
promises — rather than how fast it runs, which is why they end and upgrades do not. The
whole tree costs 63.9M credits, which is why the endless upgrade lines exist above it:
past that price the badge shelf has nothing left to sell.

**Upgrade** — the other half of the shop: fifteen lines. Six have no last level (Sell
Value, Open Speed, Pack Size, Coin Drops, Extra Packs, Merge Value) and the rest buy a
shape and finish (Auto Summon, Offline Earnings, Wish Odds, and **the long game**: Called
Shot, Split Aim, Auto Aim, Longer Table, Wider Deal, Deeper Merges). Every level costs a
fixed multiple of the last, and always more than the effect it buys. Badges give the game
its shape; upgrades give it its curve, and the curve has no end (ADR 0007).

**R** — what the endless lines add up to, and the one number that decides whether the
curve is a curve. A line whose effect multiplies by `g` a level against a price that
multiplies by `c` contributes `ln g / ln c`; the sum across the shop is the exponent
relating income to money spent. Below one, the balance grows like a polynomial in time and
every order of magnitude costs more play than the last. Above one, it reaches infinity in
*finite* time — spend everything, come back richer than you spent, repeat. The Factory
put it at about 1.5 and a save was over in ten minutes (ADR 0015); it sits near 0.74 now.
Any new endless line is a change to R, and that is the whole review.

**Buy amount** — how many levels one press of a shop row buys: one, ten, twenty-five, or
as many as the balance covers. Priced level by level, never per-level times a count,
because every level costs more than the last. Late on a level is a fraction of a second's
income, and buying them one at a time is a repetitive strain injury with a progress bar.

**Contract** — a demand for a breadth of one **series** at a depth of stars. Free to
enter, pays credits, and reads nothing else about a character: not credit value, and
certainly not an invented stat. An earlier attempt gave characters numbers and the
characters stopped mattering; scoring on credit value only renames rarity, so the answer
would always be "send the eleven Mythics". Stored as a number of *presses* and multiplied
out at payout time, so it is the same size of prize at ten thousand credits and at a
quadrillion. Nothing is gambled — one you cannot fulfil is refused, not lost.

**Board** — the five contracts posted at once. Fulfilling one posts its replacement, so
there is no refresh and no daily reset. Each row is posted at the rung the collection is
standing on rather than at a rung drawn blind: a board of five demands nobody can meet is
a wall, not a mechanic (ADR 0013).

**Muster** — fulfilling a contract, watched rather than read. A rank of the player's own
cards — the ones that satisfy it, at the stars they merged to — deals in, the demand
stamps answered, and the credits land. It reads no rule and changes none; the payout has
already settled by the time it plays. It exists because summoning has a wrapper to tear
and the board shipped without anything at all, which is how a mechanic ends up reading as
a spreadsheet with buttons.

**Called Shot** — the shop line that points a share of every pull at the series you name.
The only way in the game to collect on purpose rather than by waiting, and it exists
because a contract asks for a series by name. Aimed from the contract it is meant to
finish: every row on the board carries a crosshair, and the picker searches the whole
collection rather than offering a shortlist of it.

**Split Aim** — how many series Called Shot may point at once, one to six. The aimed share
is *divided* between the targets rather than added to, so width costs focus and nothing
else.

**Auto Aim** — the machine holding the crosshair. Once bought, every pull re-points Called
Shot at the contracts the collection is nearest to finishing — nearest by how many
characters are *left*, not by percentage, because "what can I finish next" is the question
the crosshair exists to answer. A setting rather than a second purchase: it can be switched
off, and then the targets are yours again.

**Opening discount** — the first five rungs of the endless lines, sold at a fraction of
list price that fades out by the sixth. The ramp on to the curve: an exponential ladder
priced honestly from level one is correct on paper and a wall in the first ten minutes.
The three lines that end are never discounted, because their first level is an unlock.

**Suffix** — how a number is said once it outgrows its digits: three significant figures
and a short-scale name, 4.18B or 12.4Qa, and an exponent past the table. Everything the
player is quoted a price or a payout in goes through it.

**Icon** — the game art, all of it Kenney's CC0 packs, vendored in `src/assets/icons` and
painted as CSS masks so one file serves every theme. Never drawn by hand here: the
typographic glyphs it replaced (✦ ▦ ★ ⚙) rendered differently on every platform.

**Open Speed** — the rate a pull empties at, in cards a second, for the pull as a whole.
Not per pack: a rate per wrapper would make every level of Extra Packs a free doubling of
this one. It is counted in the cards the pull *holds* rather than the ones it deals, so a
pull that says a hundred and ninety-three thousand takes as long as a hundred and
ninety-three thousand at that rate (ADR 0010). Floored so a pull is still a moment,
capped so a pack that has outgrown the hands still ends.

**Voice** — one sound actually playing. A pull asks for far more of them than can be
heard, so they are rationed: a few may share any tenth of a second, one sample may not
restart faster than an ear can separate it from itself, and a limiter across the master
bus catches whatever still lands together. What was heard before was mostly clipping.

**Stress run** — `npm run stress`, which plays the end game on a throwaway instance at
four rungs and a phone and fails on anything over budget: the press-to-wrappers delay,
the frame gap while a pull empties, the opening against the promised rate, voices in the
same tenth of a second, whether the spread fills its pane, whether the button that opens
a pack is reachable, whether the shop answers with the Automaton running, whether every
wrapper's guarantee was kept, whether a collection of sixty-five thousand
characters can be sold at all, and whether the **muster** puts a rank of portraits on
screen when a demand is answered. Every rung plays
against a collection the size a rung that deep would have, because what a player owns is
its own axis of end game (ADR 0011) and a harness that only grew the pull missed both of
the faults that cost the most. Every problem it checks for is one that shipped.
