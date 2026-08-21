# A guarantee promises a tier that may not exist

Emerald VI says every pack contains three Mythics. At thirty-three packs, four
wrappers had three Mythics between them and twenty had none — every pull, and
no amount of anything would change it.

Mythic starts at seven hundred credits, which is about twenty-six thousand
AniList favourites, and the most-favourited character alive has forty-three
thousand. **Eleven characters in the world are Mythic.** Not eleven per
catalog: eleven people. Legendary-or-better is about a hundred and forty, Epic
about seven hundred, and everything past four and a half thousand is Common.
The ladder was written when a pull was one wrapper. Extra Packs took the
demand to twenty-four wrappers times three, which is seventy-two, against a
supply of eleven, and the first four wrappers took the lot.

**A guarantee is kept at the best tier the catalog can still supply.** Mythic
while there are Mythics, then Legendary, then Epic, never below Rare — at that
point the promise is "a card", which is what a pack is anyway. The badge says
so: *three Mythics, or the best left in the catalog*.

- **The pull is topped up once, and the top-ups are shuffled.** Which wrapper
  the Mythics land in should not be a fact anybody can learn, and filling
  best-first in wrapper order makes the leftmost pack the good one for the rest
  of time.
- **A top-up never makes a wrapper worse.** Further down the ladder a
  guaranteed card can be worth less than the card it would replace; it is left
  for a wrapper it actually improves.
- **A rung never re-deals the rung above it.** Every tier includes the ones
  above, so what has already been taken is excluded or the Mythics come back
  around as Legendaries.
- **A guarantee never overshoots.** Emerald I promises Rare and gets Rare, even
  on a catalog full of Mythics.
- **Skip Owned still means Skip Owned.** A player who owns every good character
  in the catalog and has asked never to see a duplicate has asked for a pack
  with nothing left to guarantee, and gets one.

## Keeping it

`npm run stress` seeds AniList's real favourites curve rather than a gentle
`90000/rank`, which put three characters above the Mythic line and made the top
of the catalog far too generous to test a promise against. Every rung then asks
the API for one pull and checks each wrapper separately, because the spread is
virtualised — counting cards in the document counts the rows that happen to be
scrolled into view, and which wrapper a card came from is not in the DOM at
all.
