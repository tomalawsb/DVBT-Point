const CACHE_NAME = 'dvbt-point-18-1705261348';
const CORE = ['./','./index.html','./style.css?v=18.0-1705261348','./app.js?v=18.0-1705261348','./data/transmitters.json','./manifest.json','./assets/icon.svg'];
self.addEventListener('install', event => { self.skipWaiting(); event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE)).catch(()=>{})); });
self.addEventListener('activate', event => { event.waitUntil((async()=>{ const keys=await caches.keys(); await Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k))); await self.clients.claim(); })()); });
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  event.respondWith((async()=>{
    try {
      const fresh = await fetch(req, {cache:'no-store'});
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, fresh.clone()).catch(()=>{});
      return fresh;
    } catch(e) {
      return (await caches.match(req)) || (await caches.match('./index.html'));
    }
  })());
});
