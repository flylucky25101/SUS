const CACHE_NAME = 'rift-forge-v16';
const CORE = [
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/maskable.svg',
  './assets/fighters/kade-spritesheet.png',
  './assets/fighters/mira-spritesheet.png',
  './assets/fighters/bram-spritesheet.png',
  './assets/fighters/suri-spritesheet.png',
  './assets/fighters/juno-spritesheet.png',
  './assets/fighters/orin-spritesheet.png',
  './assets/portraits/kade-portrait.png',
  './assets/portraits/mira-portrait.png',
  './assets/portraits/bram-portrait.png',
  './assets/portraits/suri-portrait.png',
  './assets/portraits/juno-portrait.png',
  './assets/portraits/orin-portrait.png',
  './assets/stages/vector-spire-bg.webp',
  './assets/stages/drift-garden-bg.webp',
  './assets/ui/rift-forge-background.webp',
];

async function fetchFreshAndCache(cache, input) {
  const request = new Request(new URL(input, self.registration.scope), { cache: 'reload' });
  const response = await fetch(request);
  if (!response.ok) throw new Error(`Failed to precache ${request.url}: ${response.status}`);
  await cache.put(request, response.clone());
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const indexResponse = await fetchFreshAndCache(cache, './index.html');
    await cache.put(new Request(new URL('./', self.registration.scope)), indexResponse.clone());
    await Promise.all(CORE.map((url) => fetchFreshAndCache(cache, url)));
    const html = await indexResponse.text();
    const indexUrl = new URL('./index.html', self.registration.scope);
    const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((match) => new URL(match[1], indexUrl))
      .filter((url) => url.origin === self.location.origin)
      .map((url) => url.href);
    await Promise.all([...new Set(assets)].map((url) => fetchFreshAndCache(cache, url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request);
        if (response.ok && response.type === 'basic') {
          const cache = await caches.open(CACHE_NAME);
          await Promise.all([
            cache.put(event.request, response.clone()),
            cache.put('./index.html', response.clone()),
          ]);
        }
        return response;
      } catch (error) {
        const fallback = await caches.match(event.request, { ignoreVary: true })
          ?? await caches.match('./index.html', { ignoreVary: true });
        if (fallback) return fallback;
        throw error;
      }
    })());
    return;
  }
  event.respondWith((async () => {
    const cached = await caches.match(event.request, { ignoreVary: true });
    if (cached) return cached;

    const response = await fetch(event.request);
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(event.request, response.clone());
    }
    return response;
  })());
});
