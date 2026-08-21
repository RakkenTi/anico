/**
 * Game icons, painted as masks.
 *
 * The art is Kenney's, CC0, vendored in src/assets/icons (see the LICENSE
 * beside it). Every icon is a single-colour shape, so it is used as a mask
 * over `currentColor` rather than as an image: one file serves the dark
 * themes and the light one, a disabled button dims its icon along with its
 * text, and nothing has to ship a second copy in another colour.
 */

import cardsFan from '../assets/icons/cards_fan.svg'
import cardsCollection from '../assets/icons/cards_collection.svg'
import cardsStack from '../assets/icons/cards_stack.svg'
import cardsStackHigh from '../assets/icons/cards_stack_high.svg'
import card from '../assets/icons/card.svg'
import suitHearts from '../assets/icons/suit_hearts.svg'
import dice from '../assets/icons/dice.svg'
import token from '../assets/icons/token.svg'
import pouch from '../assets/icons/pouch.svg'
import crown from '../assets/icons/crown_a.svg'
import dollar from '../assets/icons/dollar.svg'
import hourglass from '../assets/icons/hourglass.svg'
import d20 from '../assets/icons/d20.svg'
import flask from '../assets/icons/flask_full.svg'
import campfire from '../assets/icons/campfire.svg'
import cardsSeek from '../assets/icons/cards_seek.svg'
import gear from '../assets/icons/gi_gear.png'
import star from '../assets/icons/gi_star.png'
import podium from '../assets/icons/gi_leaderboardsComplex.png'

export const ICONS = {
  cards_fan: cardsFan,
  cards_collection: cardsCollection,
  cards_stack: cardsStack,
  cards_stack_high: cardsStackHigh,
  card,
  suit_hearts: suitHearts,
  dice,
  token,
  pouch,
  crown_a: crown,
  dollar,
  hourglass,
  d20,
  flask_full: flask,
  campfire,
  cards_seek: cardsSeek,
  gear,
  star,
  podium,
} as const

export type IconName = keyof typeof ICONS
