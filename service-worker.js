const CACHE_NAME = 'dvbt-point-19-32-1905261015';
const CORE = ['./','./index.html','./style.css?v=19.32-1905261015','./app.js?v=19.32-1905261015','./data/transmitters.json','./data/ant/index.json','./manifest.json','./assets/icon.svg','./assets/icon-192.png','./assets/icon-512.png'];
self.addEventListener('install', event => { self.skipWaiting(); event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE)).catch(()=>{})); });
self.addEventListener('activate', event => { event.waitUntil((async()=>{ const keys=await caches.keys(); await Promise.all(keys.filter(k=>k!==CACHE_NAME && k!=='dvbt-ant-files-v1').map(k=>caches.delete(k))); await self.clients.claim(); })()); });
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
      const cached = await caches.match(req);
      if(cached) return cached;
      if(req.mode === 'navigate' || req.destination === 'document') return await caches.match('./index.html');
      return new Response('Zasób niedostępny offline', {status:503, statusText:'Service Unavailable', headers:{'Content-Type':'text/plain; charset=utf-8'}});
    }
  })());
});
