/**
 * The works: the Press, the Factory and Expeditions.
 *
 * Three faucets that all pay **credits**, because a mechanic that pays its own
 * currency is a mechanic that has to lock something to matter -- and locking
 * the summon's own ceilings behind a different mechanic is what the second
 * economy did wrong. Every upgrade in this game is bought in one shop with one
 * currency. What chains between mechanics here is *material*, not permission:
 * you are never told you may not buy a thing, only that a machine is hungry.
 *
 *   summon -> spare copies -> [Press] -> scrap -> [Factory] -> credits
 *                                          \
 *                                           -> [Expeditions] -> credits, later
 *
 * They differ by the shape of what they pay, which is the only way three
 * faucets into one currency stay distinct:
 *
 *   Press        reads how *deep* the collection is. Always running.
 *   Factory      steady throughput. Pays every press and every hour away.
 *   Expeditions  a lump of scrap spent now for a much larger payout later.
 *   Contracts    collection goals. Lumpy, free to enter, gated on breadth.
 *
 * Everything here is denominated in the player's own **credits per card**,
 * which the server keeps as a smoothed average of what their presses are
 * actually worth. That is the trick that keeps all of this relevant at every
 * point on a curve that spans twenty orders of magnitude: a faucet quoted in
 * flat credits is a rounding error by Qa, and a faucet quoted in the player's
 * own rate never is.
 */

/* --------------------------------------------------------------- the Press */

/**
 * Spare fractions one scrap is worth, before Finer Mill.
 *
 * A press deals at most a thousand cards and no upgrade can raise that, so at
 * end game -- where nearly every dealt card lands on a stack at its cap and
 * sheds a whole spare -- this is about one scrap a press. The flat stream is
 * the whole point: it is the one quantity in the game the credit curve cannot
 * inflate, which is what stops the Factory becoming free money.
 */
export const BASE_SPARES_PER_SCRAP = 900

export function sparesPerScrap(millLevel: number): number {
  return Math.max(1, Math.round(BASE_SPARES_PER_SCRAP / (1 + lv(millLevel, 6))))
}

/* ------------------------------------------------------------- the Factory */

/** Scrap the belt can pull through in one press, before Belt Speed. */
export const BASE_BELT = 2

/**
 * How much scrap the Factory eats per press-equivalent.
 *
 * Deliberately below what the Press makes at end game (about one scrap a
 * press against a belt that starts at two): the belt is only a bottleneck
 * while the Press is young, and past that the constraint is what a scrap is
 * *worth*, not how fast it moves. Buying Belt Speed early is what turns a
 * backlog into income; buying it late does nothing, and the shop says so.
 */
export function beltRate(level: number): number {
  return BASE_BELT * Math.pow(1.55, Math.max(0, Math.floor(level)))
}

/**
 * What one scrap is worth, as a fraction of one whole press.
 *
 * A *press*, not a card, and that distinction is the whole balance of the
 * works. Scrap arrives at a flat rate -- about one a press, because a press
 * deals at most a thousand real cards however many million the pull holds --
 * while a pull is exponential and by the late game holds hundreds of
 * thousands. A scrap priced at a fixed number of cards is therefore a rounding
 * error the moment Pack Size gets going: quoted against a card it measured
 * 0.1% of the summon at a quadrillion credits, which is a faucet nobody would
 * ever open.
 *
 * Priced against a press it tracks, and the Foundry is how far up it gets:
 * eight thousandths of a press to start, and endless from there. Since the
 * belt can only ever pull about one scrap a press, this number *is* the
 * Factory's share of the summon -- 0.8% at level zero, parity somewhere around
 * level ten, and past that it is the better faucet.
 */
export const BASE_SCRAP_WORTH = 0.008

export function foundryMult(level: number): number {
  return BASE_SCRAP_WORTH * Math.pow(1.6, Math.max(0, Math.floor(level)))
}

/**
 * Credits the Factory pays for `scrap`.
 *
 * `scrapWorth` is cards-per-scrap, which the server works out as the Foundry's
 * fraction times the size of this player's own pull. Passed in rather than
 * derived from a level, because the level alone cannot know how big a press
 * has become.
 */
export function factoryPay(scrap: number, creditsPerCard: number, scrapWorth: number): number {
  return Math.floor(Math.max(0, scrap) * Math.max(0, creditsPerCard) * Math.max(0, scrapWorth))
}

/* ------------------------------------------------------------------- heat */

/**
 * Heat: what a hand on the machine is worth.
 *
 * Everything else in the works is paced by material -- spares arrive when the
 * summon deals duplicates, and no amount of tapping makes a collection deeper.
 * That is the right shape for an idle game and it left both machines with
 * nothing to do but watch, which is the complaint the works kept earning.
 *
 * Heat is the answer: a tap on either machine raises it, it multiplies what
 * every scrap fetches, and it halves every few seconds. So it is worth a lot
 * while somebody is stood at the press and nothing whatever to the away rate,
 * which is the only way to add a clicker to an idle game without making idling
 * the wrong move.
 *
 * It decays by wall clock rather than by presses, and that is not the clock
 * ADR 0004 threw out: nothing is gated behind it, nothing is lost by missing
 * it, and a player who never taps plays exactly the game they played before.
 */
export const HEAT_PER_TAP = 0.22
/** Heat halves every this many milliseconds since it was last raised. */
export const HEAT_HALF_MS = 7000
/** What a scrap fetches at full heat, as a multiple of cold. */
export const HEAT_MAX_MULT = 2

/** Heat as it stands now, given what it was and when it was last touched. */
export function heatNow(heat: number, at: number, now: number): number {
  if (!(heat > 0)) return 0
  const dt = Math.max(0, now - at)
  const h = heat * Math.pow(0.5, dt / HEAT_HALF_MS)
  return h < 0.005 ? 0 : Math.min(1, h)
}

/** The multiple `heat` puts on a payout. */
export function heatMult(heat: number): number {
  return 1 + Math.max(0, Math.min(1, heat)) * (HEAT_MAX_MULT - 1)
}

/**
 * What one hand slam mills the tank at.
 *
 * The automatic stroke waits for a whole scrap's worth of spares; a slam
 * brings the ram down on whatever is in there now, and mills it hot. The
 * bonus is what stops the tap being pure impatience -- it is worth doing even
 * when the tank is nearly full.
 */
export const HAND_MULT = 1.5

/* --------------------------------------------------------- the Expeditions */

/** Expeditions that may be out at once, before Caravans. */
export const BASE_CARAVANS = 1
export const MAX_CARAVANS = 4

/**
 * The routes, longest last.
 *
 * A route costs scrap now and pays credits later, and "later" is measured in
 * *presses* rather than in minutes. ADR 0004 took every clock out of this game
 * on the grounds that pacing makes an app you cannot play when you happen to
 * open it, and a four-hour timer is that mistake wearing a hat. Paced by
 * presses, a week away costs nothing: the caravan is exactly where you left
 * it, and it moves when you play.
 *
 * `reach` is how much of the catalog a player must have seen to send one. A
 * long route is an expedition, and an expedition needs a roster.
 */
export interface Route {
  key: string
  name: string
  /** Presses to walk it end to end. */
  distance: number
  /** Scrap it costs to outfit. */
  scrap: number
  /** Payout as a multiple of the whole distance's worth of Factory output. */
  bounty: number
  /** Distinct characters the player must hold to send one. */
  reach: number
}

export const ROUTES: Route[] = [
  { key: 'errand',   name: 'Errand',       distance: 250,     scrap: 40,     bounty: 1.4, reach: 0 },
  { key: 'circuit',  name: 'Circuit',      distance: 1_200,   scrap: 260,    bounty: 1.8, reach: 2_000 },
  { key: 'passage',  name: 'Long Passage', distance: 6_000,   scrap: 1_600,  bounty: 2.2, reach: 12_000 },
  { key: 'crossing', name: 'The Crossing', distance: 30_000,  scrap: 9_000,  bounty: 2.7, reach: 35_000 },
  { key: 'odyssey',  name: 'Odyssey',      distance: 150_000, scrap: 52_000, bounty: 3.3, reach: 60_000 },
]

/** Waypoints on a route, so a long walk pays something on the way. */
export const WAYPOINTS = 5

/**
 * Outfitters multiplies every bounty. Endless, and deliberately gentle.
 *
 * It multiplies a number that is already a multiple of a multiple, so a steep
 * curve here compounds three deep: at 1.85 a level, three levels turned an
 * Odyssey into two hundred and ninety times what its scrap would have earned
 * on the belt, and nobody would ever have run the Factory again.
 */
export function outfitMult(level: number): number {
  return Math.pow(1.15, Math.max(0, Math.floor(level)))
}

export function caravans(level: number): number {
  return Math.min(MAX_CARAVANS, BASE_CARAVANS + Math.max(0, Math.floor(level)))
}

/**
 * What a route pays in full.
 *
 * Quoted against the Factory, because that is the comparison the player
 * actually makes: the belt only pulls about one scrap a press, so a route paid
 * at `bounty` times its distance is worth roughly `bounty / 0.57` of what the
 * belt would have made over the same walk -- two and a half times for an
 * Errand, close to six for an Odyssey. It also costs a backlog of scrap the
 * belt will never see, which is the trade: steady throughput against one large
 * lump later.
 *
 * The lump is the point. An Odyssey pays a third of a player's whole bank in
 * one click; it just does it once, after a hundred and fifty thousand presses.
 */
export function routePay(
  route: Route,
  creditsPerCard: number,
  scrapWorth: number,
  outfit: number,
): number {
  return Math.floor(factoryPay(route.distance, creditsPerCard, scrapWorth) * route.bounty * outfit)
}

/** What a route has paid out by `walked` presses, in whole waypoints. */
export function waypointsPassed(route: Route, walked: number): number {
  return Math.min(WAYPOINTS, Math.floor((walked / route.distance) * WAYPOINTS))
}

/* ----------------------------------------------------------------- shared */

const lv = (n: number, cap: number) => Math.max(0, Math.min(cap, Math.floor(n || 0)))

/** One expedition in flight. */
export interface Expedition {
  id: number
  route: string
  /** Presses walked so far. */
  walked: number
  /** Waypoints already collected. */
  paid: number
  /** Credits the whole route will pay, fixed when it was outfitted. */
  bounty: number
}

/** Everything the works are doing right now, as the client reads it. */
export interface Works {
  /** Spare fractions still short of a whole scrap. */
  spares: number
  /** Spares one scrap costs, after Finer Mill. */
  sparesPerScrap: number
  /** What a press has recently been worth in spares. */
  sparesPerPull: number
  /** Scrap in the yard, waiting for the belt. */
  scrap: number
  /** Scrap the belt pulls through per press. */
  belt: number
  /** Cards one scrap is worth: the Foundry's fraction of this player's press. */
  scrapWorth: number
  /** Heat, 0 to 1: the multiple a hand on the machine is currently buying. */
  heat: number
  /** Distinct characters held: what gates a route. */
  reach: number
  caravans: number
  out: Expedition[]
}
