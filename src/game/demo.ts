/**
 * Whether this bundle is the public demo.
 *
 * Baked in at build time (see `vite.demo.config.ts`), so a normal build folds
 * every branch below it away and ships none of the demo's copy.
 *
 * The demo runs the real server in the browser with no accounts and no
 * storage, which leaves a handful of things it cannot honestly offer: anything
 * that needs an account, anything that reaches AniList, and the admin panel.
 * They are darkened and labelled rather than hidden, because a visitor
 * deciding whether to run this themselves should be able to see what is here.
 */
export const DEMO: boolean = __DEMO__

/** Where to send somebody who wants the real thing. */
export const DEMO_REPO = 'https://github.com/RakkenTi/anico'

export const DEMO_NOTE =
  'This is a demo. Everything runs in your browser, nothing is saved, and refreshing starts a new run.'
