/**
 * Shell cache only. Gameplay is server-authoritative, so /api is never cached
 * and never served stale: the point of this worker is a fast, installable
 * shell, not offline play.
 */
const SHELL = 'anico-shell-v1'

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest'])))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/')) return

  // Navigations: network first, fall back to the cached shell when offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone()
          caches.open(SHELL).then((c) => c.put('/', copy))
          return res
        })
        .catch(() => caches.match('/').then((r) => r ?? Response.error())),
    )
    return
  }

  // Hashed assets and sounds: cache first, they never change in place.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/sfx/')) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ??
          fetch(e.request).then((res) => {
            const copy = res.clone()
            caches.open(SHELL).then((c) => c.put(e.request, copy))
            return res
          }),
      ),
    )
  }
})
