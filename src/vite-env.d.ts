/// <reference types="vite/client" />

/** Baked in at build time from package.json (see vite.config.ts). */
declare const __APP_VERSION__: string

/** True only in the public demo build (see vite.demo.config.ts). */
declare const __DEMO__: boolean
