/**
 * Node's crypto and util, for a bundle that never calls them.
 *
 * `server/auth.ts` is the only module in `server/` that reaches for Node, and
 * the demo has no accounts, so nothing in it ever runs. It is still *imported*
 * -- `server/routes.ts` names half a dozen of its functions -- so the module
 * has to resolve and evaluate. That is all this provides: names, and a loud
 * failure for anybody who actually calls one.
 *
 * Aliased in by `vite.demo.config.ts`. A real implementation would be a bug:
 * if the demo ever needs to hash a password, the demo has grown accounts and
 * this file is the wrong place to find out.
 */

const gone = (name: string) => () => {
  throw new Error(`demo build: ${name} is not available. The demo has no accounts.`)
}

export const randomBytes = gone('randomBytes')
export const scrypt = gone('scrypt')
export const timingSafeEqual = gone('timingSafeEqual')
export const createHash = gone('createHash')

/* `node:fs` and `node:path`, for `openDb` -- which the demo never calls, but
   which `server/db.ts` names at module scope alongside `migrate`. */
export const mkdirSync = gone('mkdirSync')
export const dirname = gone('dirname')

/** Enough of `promisify` to survive module evaluation in auth.ts. */
export const promisify = (fn: unknown) => {
  void fn
  return gone('a promisified node builtin')
}

export default { randomBytes, scrypt, timingSafeEqual, createHash, promisify, mkdirSync, dirname }
