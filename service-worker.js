const CACHE_NAME = 'dvbt-point-v14-1705261138';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css?v=14.0-1705261138',
  './js/app.js?v=14.0-1705261138',
  './data/transmitters.json?v=14.0-1705261138',
  './data/sources.json',
  './data/coverage.geojson?v=14.0-1705261138',
  './manifest.json',
  './assets/icon.svg'
];
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL).catch(() => undefined)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isTile = url.hostname.includes('tile.openstreetmap.org') || url.hostname.includes('tile.opentopomap.org') || url.hostname.includes('basemaps.cartocdn.com');
  const isExternalApi = url.hostname.includes('api.open-meteo.com') || url.hostname.includes('nominatim.openstreetmap.org') || url.hostname.includes('bip.uke.gov.pl');
  if (isExternalApi) return; // prawdziwe dane API mają być pobierane z sieci, bez udawania z cache
  if (isTile) {
    event.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE_NAME).then(c => c.put(req, copy)); return res; }).catch(() => caches.match(req)));
    return;
  }
  event.respondWith(caches.match(req).then(cached => cached || fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE_NAME).then(c => c.put(req, copy)); return res; })));
});
