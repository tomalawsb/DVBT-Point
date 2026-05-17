(() => {
  'use strict';

  const VERSION = '14.0 - 1705261138';
  const VERSION_Q = '14.0-1705261138';
  const STORE_KEY = 'dvbt-point-v14-state';
  const PROFILE_CACHE_PREFIX = 'dvbt-profile-v14:';
  const DEFAULT_RX = { lat: 50.2871, lon: 21.4238, label: 'Mielec / punkt odbioru' };
  const UKE_CSV_H = 'https://bip.uke.gov.pl/download/gfx/bip/pl/defaultaktualnosci/140/5/115/pozwolenia_ntc_h_2026-05-07.csv';
  const UKE_CSV_R = 'https://bip.uke.gov.pl/download/gfx/bip/pl/defaultaktualnosci/140/5/115/pozwolenia_ntc_r_2026-05-07.csv';

  const $ = (id) => document.getElementById(id);
  const state = {
    rx: loadState()?.rx || DEFAULT_RX,
    rxAntennaHeight: loadState()?.rxAntennaHeight || 6,
    transmitters: [],
    datasetMeta: null,
    selected: null,
    heading: loadState()?.heading ?? null,
    targetBearing: null,
    compassEnabled: false,
    baseLayer: ['std','light','terrain'].includes(loadState()?.baseLayer) ? loadState().baseLayer : 'std',
    muxFilter: loadState()?.muxFilter || 'ALL',
    sheetHidden: loadState()?.sheetHidden ?? false,
    paidCoverageTileUrl: loadState()?.paidCoverageTileUrl || '',
    paidElevationTemplate: loadState()?.paidElevationTemplate || '',
    coverageVisible: loadState()?.coverageVisible ?? true,
    mapReady: false,
  };

  let map, rxMarker, txLayer, coverageLayer, coverageGeoJsonLayer, paidCoverageLayer;
  let linkLine, distanceLabel, baseLayers = {};
  let headingHandler = null;
  let profileAbort = null;
  let resizeTimer = null;

  function setAppHeight() {
    const h = window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight;
    document.documentElement.style.setProperty('--app-h', `${h}px`);
    const m = $('map');
    if (m) {
      m.style.width = `${window.innerWidth}px`;
      m.style.height = `${h}px`;
    }
  }

  function saveState() {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      rx: state.rx,
      rxAntennaHeight: state.rxAntennaHeight,
      baseLayer: state.baseLayer,
      muxFilter: state.muxFilter,
      heading: state.heading,
      sheetHidden: state.sheetHidden,
      paidCoverageTileUrl: state.paidCoverageTileUrl,
      paidElevationTemplate: state.paidElevationTemplate,
      coverageVisible: state.coverageVisible
    }));
  }
  function loadState() { try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; } }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => t.hidden = true, 2600);
  }

  const rad = d => d * Math.PI / 180;
  const deg = r => r * 180 / Math.PI;
  const round = (n, p=0) => Number(n).toFixed(p);
  const unique = arr => [...new Set(arr.filter(Boolean))];

  function km(a, b) {
    const R = 6371;
    const dLat = rad(b.lat - a.lat);
    const dLon = rad(b.lon - a.lon);
    const la1 = rad(a.lat), la2 = rad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function bearing(a, b) {
    const φ1 = rad(a.lat), φ2 = rad(b.lat), Δλ = rad(b.lon - a.lon);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }
  function destinationPoint(start, brng, distanceKm) {
    const R = 6371;
    const δ = distanceKm / R;
    const θ = rad(brng);
    const φ1 = rad(start.lat), λ1 = rad(start.lon);
    const φ2 = Math.asin(Math.sin(φ1)*Math.cos(δ)+Math.cos(φ1)*Math.sin(δ)*Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ)*Math.sin(δ)*Math.cos(φ1), Math.cos(δ)-Math.sin(φ1)*Math.sin(φ2));
    return { lat: deg(φ2), lon: ((deg(λ2)+540)%360)-180 };
  }
  function signedDiff(from, to) { return ((to - from + 540) % 360) - 180; }

  function initMap() {
    setAppHeight();
    map = L.map('map', {
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
      inertia: true,
      trackResize: true,
      zoomAnimation: true,
      fadeAnimation: false,
      markerZoomAnimation: false,
      tap: false,
      maxBoundsViscosity: 0.3
    }).setView([state.rx.lat, state.rx.lon], 8);

    map.attributionControl.setPrefix('');
    baseLayers.std = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, minZoom: 3, keepBuffer: 4, updateWhenIdle: true, updateWhenZooming: false, detectRetina: false,
      attribution: '&copy; OpenStreetMap'
    });
    baseLayers.light = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20, minZoom: 3, keepBuffer: 4, updateWhenIdle: true, updateWhenZooming: false, detectRetina: false,
      attribution: '&copy; OpenStreetMap & Carto'
    });
    baseLayers.terrain = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17, minZoom: 3, keepBuffer: 3, updateWhenIdle: true, updateWhenZooming: false, detectRetina: false,
      attribution: '&copy; OpenTopoMap'
    });
    (baseLayers[state.baseLayer] || baseLayers.std).addTo(map);

    txLayer = L.layerGroup().addTo(map);
    coverageLayer = L.layerGroup().addTo(map);

    rxMarker = L.marker([state.rx.lat, state.rx.lon], { draggable: true, icon: divIcon('⌂', 'rx-icon') }).addTo(map);
    rxMarker.on('dragend', () => {
      const p = rxMarker.getLatLng();
      setRx(p.lat, p.lng, 'Punkt wskazany na mapie', { pan: false });
    });

    map.on('click', (e) => {
      if (!isUiEvent(e.originalEvent)) {
        closePopover();
        if (!$('bottomSheet').classList.contains('is-hidden')) hideSheet(true);
        setRx(e.latlng.lat, e.latlng.lng, 'Punkt wskazany na mapie', { pan: false });
      }
    });

    ['load','moveend','zoomend','resize'].forEach(ev => map.on(ev, forceMapResize));
    map.whenReady(() => {
      state.mapReady = true;
      renderTransmitters();
      selectBest(false);
      loadRealCoverageGeoJson();
      restorePaidCoverageLayer();
      if (state.sheetHidden) hideSheet(true); else showSheet(true);
      forceMapResizeHard();
    });
  }

  function isUiEvent(ev) { return ev.target.closest('.topbar,.tools,.bottom-sheet,.popover,.mini-compass,.reopen-sheet,.toast,.leaflet-control'); }

  function forceMapResize() {
    if (!map) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(forceMapResizeHard, 60);
  }
  function forceMapResizeHard() {
    if (!map) return;
    setAppHeight();
    requestAnimationFrame(() => map.invalidateSize({ pan: false, animate: false }));
    [120, 360, 900, 1600].forEach(ms => setTimeout(() => map.invalidateSize({ pan: false, animate: false }), ms));
  }

  function divIcon(txt, cls) {
    return L.divIcon({ className: `dvbt-marker ${cls}`, html: `<span>${txt}</span>`, iconSize: [34, 34], iconAnchor: [17, 17] });
  }
  function injectMarkerCss() {
    const style = document.createElement('style');
    style.textContent = `
      .dvbt-marker{background:transparent;border:0}.dvbt-marker span{width:34px;height:34px;border-radius:17px;display:flex;align-items:center;justify-content:center;background:#fff;border:2px solid #fff;box-shadow:0 4px 14px rgba(15,23,42,.22);font-size:16px;font-weight:900}.rx-icon span{background:#2563eb;color:#fff}.tx-icon span{background:#fff;color:#0f172a}.tx-selected span{background:#16a34a;color:#fff;box-shadow:0 0 0 7px rgba(22,163,74,.18),0 4px 14px rgba(15,23,42,.22)}.distance-label{background:#2563eb;color:#fff;border:0;border-radius:999px;box-shadow:0 4px 12px rgba(37,99,235,.25);font-weight:900;font-size:12px;padding:3px 8px}.coverage-real{stroke:#166534;fill:#22c55e;fill-opacity:.16;stroke-opacity:.55;stroke-width:1.4}.coverage-warn{stroke:#ea580c;fill:#f97316;fill-opacity:.13;stroke-opacity:.55;stroke-width:1.3}`;
    document.head.appendChild(style);
  }

  async function loadTransmitters() {
    const res = await fetch(`./data/transmitters.json?v=${VERSION_Q}`, { cache: 'no-cache' });
    const json = await res.json();
    state.datasetMeta = json.meta || null;
    state.transmitters = normalizeTransmitters(json.transmitters || []);
    updateDatasetChip();
  }
  function normalizeTransmitters(list) {
    return list.map((tx, i) => ({
      id: tx.id || slug(`${tx.name || 'tx'}-${i}`),
      name: tx.name || 'Nadajnik',
      lat: Number(tx.lat), lon: Number(tx.lon),
      height_m: Number(tx.height_m ?? tx.mast_height_m ?? 50),
      source: tx.source || state.datasetMeta?.source || 'lokalna baza',
      muxes: (tx.muxes || []).map(m => ({
        mux: String(m.mux || m.MUX || '').trim() || 'MUX-?',
        channel: String(m.channel || m.kanal || m.kanał || '').trim() || '—',
        frequency_mhz: Number(m.frequency_mhz || m.freq_mhz || m.czestotliwosc || m['częstotliwość'] || 0),
        erp_kw: Number(m.erp_kw || m.erp || 0),
        polarization: String(m.polarization || m.polaryzacja || '').trim() || '—',
        band: String(m.band || m.pasmo || '').trim() || bandFromFreq(Number(m.frequency_mhz || m.freq_mhz || 0))
      })).filter(m => m.mux !== 'MUX-?' || m.frequency_mhz || m.channel !== '—')
    })).filter(tx => Number.isFinite(tx.lat) && Number.isFinite(tx.lon));
  }
  function slug(s) { return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,''); }
  function bandFromFreq(f) { if (!f) return '—'; return f < 300 ? 'VHF' : 'UHF'; }
  function updateDatasetChip() {
    const chip = $('onlineChip');
    const type = state.datasetMeta?.dataset_type || 'local';
    chip.textContent = navigator.onLine ? 'Online' : 'Offline';
    chip.title = `Baza: ${type}`;
  }

  function transmitterScore(tx) {
    const dist = km(state.rx, { lat: tx.lat, lon: tx.lon });
    const erp = Math.max(1, ...tx.muxes.map(m => Number(m.erp_kw || 0)));
    const muxCount = tx.muxes.length;
    return dist - Math.log10(erp + 1) * 16 - muxCount * 1.8;
  }
  function filteredTxs() {
    return state.transmitters
      .filter(tx => state.muxFilter === 'ALL' || tx.muxes.some(m => m.mux === state.muxFilter))
      .map(tx => ({ ...tx, distance: km(state.rx, tx), azimuth: bearing(state.rx, tx), score: transmitterScore(tx) }))
      .sort((a,b) => a.score - b.score);
  }

  function renderTransmitters() {
    txLayer.clearLayers();
    filteredTxs().forEach(tx => {
      const marker = L.marker([tx.lat, tx.lon], { icon: divIcon('⌁', state.selected?.id === tx.id ? 'tx-icon tx-selected' : 'tx-icon') }).addTo(txLayer);
      marker.bindTooltip(`${tx.name}<br>${round(tx.distance,1)} km · ${round(tx.azimuth)}°`, { direction: 'top', opacity: .95, sticky: true });
      marker.on('click', (e) => { L.DomEvent.stopPropagation(e); selectTx(tx.id, true); });
    });
  }
  function selectBest(openSheet = false) {
    const list = filteredTxs();
    if (list[0]) selectTx(list[0].id, openSheet);
  }
  function selectTx(id, openSheet = true) {
    const source = state.transmitters.find(t => t.id === id);
    if (!source) return;
    const tx = { ...source, distance: km(state.rx, source), azimuth: bearing(state.rx, source) };
    state.selected = tx;
    state.targetBearing = tx.azimuth;
    renderTransmitters();
    drawLink();
    updateStationPanel();
    updateMiniCompass();
    renderCoverageSummary();
    if (openSheet) showSheet(false);
  }
  function drawLink() {
    if (linkLine) map.removeLayer(linkLine);
    if (distanceLabel) map.removeLayer(distanceLabel);
    if (!state.selected) return;
    const a = [state.rx.lat, state.rx.lon], b = [state.selected.lat, state.selected.lon];
    linkLine = L.polyline([a,b], { color: '#2563eb', weight: 3, opacity: .88 }).addTo(map);
    const mid = [(a[0]+b[0])/2, (a[1]+b[1])/2];
    distanceLabel = L.marker(mid, { icon: L.divIcon({ className: 'distance-label', html: `${round(state.selected.distance,1)} km` }) }).addTo(map);
  }
  function setRx(lat, lon, label, opts = {}) {
    state.rx = { lat, lon, label };
    rxMarker.setLatLng([lat, lon]);
    $('locationChip').textContent = `🏠 ${label}`;
    saveState();
    renderTransmitters();
    selectBest(false);
    if (opts.pan !== false) map.setView([lat, lon], Math.max(map.getZoom(), 9));
    forceMapResizeHard();
  }

  function updateStationPanel() {
    const tx = state.selected;
    if (!tx) return;
    $('stationName').textContent = tx.name;
    $('azimuthValue').textContent = `${round(tx.azimuth)}°`;
    $('distanceValue').textContent = `${round(tx.distance,1)} km`;
    $('polarizationValue').textContent = unique(tx.muxes.map(m => m.polarization)).join('/') || '—';
    $('muxValue').textContent = tx.muxes.map(m => m.mux.replace('MUX-','')).join(' / ') || '—';
    $('stationDetails').innerHTML = `<div class="section-title">Multipleksy nadajnika</div><div class="mux-list">${tx.muxes.map(m => `<div class="mux-card"><div>MUX: <b>${m.mux}</b></div><div>Kanał: <b>${m.channel}</b></div><div>Częst.: ${m.frequency_mhz || '—'} MHz</div><div>ERP: ${m.erp_kw || '—'} kW</div><div>Pol.: ${m.polarization} / ${m.band}</div></div>`).join('')}</div>`;
  }
  function showSheet(compact=true) {
    const s = $('bottomSheet');
    state.sheetHidden = false;
    s.classList.remove('is-hidden');
    s.classList.toggle('is-compact', compact);
    $('reopenSheet').hidden = true;
    saveState();
    setTimeout(forceMapResizeHard, 60);
  }
  function hideSheet(showReopen=false) {
    state.sheetHidden = true;
    $('bottomSheet').classList.add('is-hidden');
    $('reopenSheet').hidden = !showReopen;
    saveState();
    setTimeout(forceMapResizeHard, 60);
  }
  function toggleSheet() { $('bottomSheet').classList.contains('is-hidden') ? showSheet(true) : hideSheet(true); }

  function openPopover(title, html, opts={}) {
    if (opts.keepSheet !== true) hideSheet(true);
    $('popoverTitle').textContent = title;
    $('popoverBody').innerHTML = html;
    $('popover').hidden = false;
    setTimeout(forceMapResizeHard, 60);
  }
  function closePopover() { $('popover').hidden = true; }

  function panelTransmitters() {
    const rows = filteredTxs().map(tx => `<button data-tx="${tx.id}"><div><b>${tx.name}</b><br><span>${round(tx.distance,1)} km · ${round(tx.azimuth)}° · ${tx.muxes.map(m=>m.mux.replace('MUX-','')).join('/')}</span></div><span>›</span></button>`).join('');
    openPopover('Nadajniki', `<p class="muted">Lista jest widoczna także na mapie jako znaczniki. Kliknij nadajnik, żeby wybrać.</p><div class="list">${rows}</div>`);
    $('popoverBody').querySelectorAll('[data-tx]').forEach(btn => btn.addEventListener('click', () => { closePopover(); selectTx(btn.dataset.tx, true); }));
  }
  function panelLayers() {
    openPopover('Warstwy', `<div class="list">
      ${['std','light','terrain'].map(k => `<button data-layer="${k}"><b>${k === 'std' ? 'Mapa standardowa OSM' : k === 'light' ? 'Jasna mapa Carto' : 'Mapa terenowa OpenTopoMap'}</b><span>${state.baseLayer===k?'aktywna':''}</span></button>`).join('')}
      <button id="toggleCoverage"><b>Prawdziwa warstwa zasięgu</b><span>${state.coverageVisible?'włączona':'wyłączona'} · GeoJSON/licencjonowane kafelki</span></button>
    </div>`);
    $('popoverBody').querySelectorAll('[data-layer]').forEach(btn => btn.addEventListener('click', () => setLayer(btn.dataset.layer)));
    $('toggleCoverage').addEventListener('click', () => { state.coverageVisible = !state.coverageVisible; saveState(); applyCoverageVisibility(); closePopover(); });
  }
  function setLayer(layer) {
    Object.values(baseLayers).forEach(l => { if (map.hasLayer(l)) map.removeLayer(l); });
    state.baseLayer = layer;
    (baseLayers[layer] || baseLayers.std).addTo(map);
    saveState(); closePopover(); forceMapResizeHard();
  }
  function panelFilters() {
    const muxes = ['ALL','MUX-1','MUX-2','MUX-3','MUX-6','MUX-8'];
    openPopover('Filtry', `<div class="list">${muxes.map(m => `<button data-mux="${m}"><b>${m==='ALL'?'Wszystkie MUX-y':m}</b><span>${state.muxFilter===m?'aktywne':''}</span></button>`).join('')}</div>`);
    $('popoverBody').querySelectorAll('[data-mux]').forEach(btn => btn.addEventListener('click', () => { state.muxFilter = btn.dataset.mux; saveState(); closePopover(); renderTransmitters(); selectBest(true); }));
  }

  function panelCompass() {
    openPopover('Kompas', `<div class="compass-panel">
      <div class="compass-big"><span>N</span><i class="compass-phone" id="bigPhoneNeedle"></i><i class="compass-target" id="bigTargetNeedle"></i></div>
      <div><b>Cel:</b> ${state.selected ? `${state.selected.name}, ${round(state.selected.azimuth)}°` : 'wybierz nadajnik'}<br><span class="muted">Pomarańczowy: telefon. Niebieski: nadajnik.</span></div>
    </div>
    <div class="list">
      <button id="startCompass"><b>Włącz kompas telefonu</b><span>czujnik kierunku</span></button>
      <button id="stopCompass"><b>Zatrzymaj kompas</b><span>tryb ręczny</span></button>
    </div>
    <div class="form-row"><label>Ręczny kierunek</label><input id="manualHeading" type="range" min="0" max="359" value="${state.heading ?? 0}"></div>
    <p class="warn">Telefon przy maszcie, antenie, aucie albo blasze może przekłamywać. Do finalnego ustawienia użyj miernika.</p>`);
    $('startCompass').addEventListener('click', startCompass);
    $('stopCompass').addEventListener('click', stopCompass);
    $('manualHeading').addEventListener('input', e => { state.heading = Number(e.target.value); saveState(); updateMiniCompass(); updateBigCompass(); });
    updateBigCompass();
  }
  async function startCompass() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const p = await DeviceOrientationEvent.requestPermission();
        if (p !== 'granted') throw new Error('Brak zgody na kompas.');
      }
      if (headingHandler) window.removeEventListener('deviceorientation', headingHandler, true);
      headingHandler = (ev) => {
        const h = ev.webkitCompassHeading ?? (ev.alpha != null ? (360 - ev.alpha) % 360 : null);
        if (h != null) { state.heading = h; state.compassEnabled = true; saveState(); updateMiniCompass(); updateBigCompass(); }
      };
      window.addEventListener('deviceorientation', headingHandler, true);
      $('miniCompass').hidden = false;
      toast('Kompas włączony');
    } catch (err) { toast(err.message || 'Nie udało się włączyć kompasu'); }
  }
  function stopCompass() { if (headingHandler) window.removeEventListener('deviceorientation', headingHandler, true); state.compassEnabled = false; updateMiniCompass(); toast('Kompas zatrzymany'); }
  function updateMiniCompass() {
    const box = $('miniCompass');
    if (!state.selected) { box.hidden = true; return; }
    box.hidden = false;
    const target = state.selected.azimuth;
    const phone = state.heading ?? 0;
    $('phoneNeedle').style.transform = `translate(-50%,-100%) rotate(${phone}deg)`;
    $('targetNeedle').style.transform = `translate(-50%,-100%) rotate(${target}deg)`;
    const diff = signedDiff(phone, target), abs = Math.abs(diff);
    $('turnText').textContent = abs <= 5 ? 'Kierunek prawidłowy' : `Obróć ${round(abs)}° ${diff > 0 ? 'w prawo' : 'w lewo'}`;
    $('headingText').textContent = `Telefon: ${state.heading == null ? '—' : round(phone)+'°'} · Cel: ${round(target)}°`;
    $('compassNote').textContent = state.compassEnabled ? 'Tryb kompasu telefonu.' : 'Tryb ręczny / bez czujnika.';
  }
  function updateBigCompass() {
    const a = $('bigPhoneNeedle'), b = $('bigTargetNeedle');
    if (!a || !b || !state.selected) return;
    a.style.transform = `translate(-50%,-100%) rotate(${state.heading ?? 0}deg)`;
    b.style.transform = `translate(-50%,-100%) rotate(${state.selected.azimuth}deg)`;
  }

  async function locateGps() {
    if (!navigator.geolocation) return toast('Brak GPS w przeglądarce');
    navigator.geolocation.getCurrentPosition(pos => {
      setRx(pos.coords.latitude, pos.coords.longitude, 'GPS / punkt odbioru');
      map.setView([state.rx.lat, state.rx.lon], 11);
    }, () => toast('Nie udało się pobrać GPS'), { enableHighAccuracy:true, timeout:10000, maximumAge:5000 });
  }
  async function searchAddress(e) {
    e.preventDefault();
    const q = $('searchInput').value.trim(); if (!q) return;
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      const data = await res.json();
      if (!data[0]) return toast('Nie znaleziono adresu');
      const lat = Number(data[0].lat), lon = Number(data[0].lon);
      setRx(lat, lon, q); map.setView([lat, lon], 12);
    } catch { toast('Błąd wyszukiwania adresu'); }
  }

  function panelProfile() {
    if (!state.selected) return toast('Najpierw wybierz nadajnik');
    const tx = state.selected;
    openPopover('Profil terenu', `<div class="profile-actions">
      <div class="form-row"><label>Wysokość anteny odbiorczej</label><input id="rxHeightInput" type="number" min="1" max="60" value="${state.rxAntennaHeight}"><span>m</span></div>
      <button class="primary-btn" id="loadProfileBtn">Wczytaj prawdziwy profil</button>
    </div>
    <div id="profileStatus" class="muted">Profil: ${tx.name}, ${round(tx.distance,1)} km. Źródło: Open-Meteo Elevation API / Copernicus DEM.</div>
    <div id="profileResult" class="profile-result"></div>`);
    $('rxHeightInput').addEventListener('change', e => { state.rxAntennaHeight = clamp(Number(e.target.value)||6,1,60); saveState(); });
    $('loadProfileBtn').addEventListener('click', () => loadAndRenderProfile(true));
    loadAndRenderProfile(false);
  }

  function clamp(n,a,b){return Math.max(a,Math.min(b,n));}
  function profileCacheKey(tx) { return PROFILE_CACHE_PREFIX + [round(state.rx.lat,4), round(state.rx.lon,4), round(tx.lat,4), round(tx.lon,4), state.rxAntennaHeight, tx.height_m].join('|'); }
  async function loadAndRenderProfile(force=false) {
    const tx = state.selected; if (!tx) return;
    const status = $('profileStatus'), target = $('profileResult');
    if (!target) return;
    const key = profileCacheKey(tx);
    if (!force) {
      try { const cached = JSON.parse(sessionStorage.getItem(key)); if (cached) { renderProfile(cached, target, status); return; } } catch {}
    }
    if (profileAbort) profileAbort.abort();
    profileAbort = new AbortController();
    status.textContent = 'Pobieram prawdziwy profil terenu...';
    target.innerHTML = `<div class="loading">Ładowanie wysokości terenu z Open-Meteo...</div>`;
    try {
      const profile = await buildRealTerrainProfile(tx, profileAbort.signal);
      sessionStorage.setItem(key, JSON.stringify(profile));
      renderProfile(profile, target, status);
    } catch (err) {
      if (err.name === 'AbortError') return;
      status.innerHTML = `<span class="error">Nie udało się pobrać prawdziwego profilu. Nie pokazuję danych wymyślonych.</span>`;
      target.innerHTML = `<div class="error-box">${escapeHtml(err.message || 'Błąd pobierania profilu.')}</div>`;
    }
  }
  async function buildRealTerrainProfile(tx, signal) {
    const dist = km(state.rx, tx);
    const n = clamp(Math.ceil(dist * 1.4), 40, 96);
    const brg = bearing(state.rx, tx);
    const pts = Array.from({length:n}, (_,i) => destinationPoint(state.rx, brg, dist * i / (n-1)));
    const elev = await fetchElevations(pts, signal);
    if (!elev || elev.length !== pts.length) throw new Error('API zwróciło niepełne dane wysokości.');
    const rxGround = elev[0], txGround = elev[elev.length-1];
    const rxTop = rxGround + state.rxAntennaHeight;
    const txTop = txGround + Number(tx.height_m || 50);
    const samples = pts.map((p,i) => {
      const x = dist * i / (n-1);
      const los = rxTop + (txTop - rxTop) * (i / (n-1));
      return { lat:p.lat, lon:p.lon, x_km:x, elevation:elev[i], los, clearance: los - elev[i] };
    });
    const inner = samples.slice(2,-2);
    const minSample = inner.reduce((a,b) => b.clearance < a.clearance ? b : a, inner[0] || samples[0]);
    let status = 'Teren wygląda czysto';
    if (minSample.clearance < -20) status = 'Silne zasłonięcie terenu';
    else if (minSample.clearance < 8) status = 'Częściowe zasłonięcie terenu';
    return { tx: { id:tx.id, name:tx.name, height_m:tx.height_m, lat:tx.lat, lon:tx.lon }, rx: state.rx, rxAntennaHeight: state.rxAntennaHeight, distance_km: dist, samples, minClearance: minSample.clearance, minAtKm: minSample.x_km, status, source: 'Open-Meteo Elevation API / Copernicus DEM GLO-90' };
  }
  async function fetchElevations(points, signal) {
    if (state.paidElevationTemplate) return fetchPaidElevations(points, signal);
    const chunks = [];
    for (let i=0; i<points.length; i+=100) chunks.push(points.slice(i,i+100));
    const out = [];
    for (const ch of chunks) {
      const lat = ch.map(p => round(p.lat,5)).join(',');
      const lon = ch.map(p => round(p.lon,5)).join(',');
      const url = `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`;
      const res = await fetch(url, { signal, cache: 'no-store' });
      if (!res.ok) throw new Error(`Open-Meteo: HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json.elevation)) throw new Error('Open-Meteo nie zwróciło tablicy elevation.');
      out.push(...json.elevation.map(Number));
    }
    return out;
  }
  async function fetchPaidElevations(points, signal) {
    const out=[];
    for (const p of points) {
      const url = state.paidElevationTemplate.replaceAll('{lat}', round(p.lat,6)).replaceAll('{lon}', round(p.lon,6));
      const res = await fetch(url, { signal, cache:'no-store' });
      if (!res.ok) throw new Error(`Płatne API elewacji: HTTP ${res.status}`);
      const json = await res.json();
      const val = Number(json.elevation ?? json.height ?? json.value ?? (Array.isArray(json.elevation) ? json.elevation[0] : NaN));
      if (!Number.isFinite(val)) throw new Error('Płatne API elewacji zwróciło nieznany format.');
      out.push(val);
    }
    return out;
  }
  function renderProfile(profile, target, status) {
    status.innerHTML = `Profil prawdziwy. Źródło: <b>${escapeHtml(profile.source)}</b>.`;
    const w=620,h=230,padL=42,padR=14,padT=16,padB=34;
    const vals = profile.samples.map(s=>s.elevation).concat(profile.samples.map(s=>s.los));
    const minY = Math.floor((Math.min(...vals)-30)/50)*50;
    const maxY = Math.ceil((Math.max(...vals)+30)/50)*50;
    const maxX = profile.distance_km;
    const x = s => padL + (s.x_km/maxX)*(w-padL-padR);
    const y = v => padT + (maxY-v)/(maxY-minY)*(h-padT-padB);
    const terrain = profile.samples.map(s=>`${x(s)},${y(s.elevation)}`).join(' ');
    const fill = `${padL},${h-padB} ${terrain} ${w-padR},${h-padB}`;
    const los = profile.samples.map(s=>`${x(s)},${y(s.los)}`).join(' ');
    const bad = profile.samples.filter(s=>s.clearance<8).map(s=>`${x(s)},${y(s.elevation)}`).join(' ');
    const dangerClass = profile.minClearance < -20 ? 'danger' : profile.minClearance < 8 ? 'warn' : 'ok';
    target.innerHTML = `<div class="profile-card ${dangerClass}">
      <svg viewBox="0 0 ${w} ${h}" class="profile-svg" role="img" aria-label="Profil terenu">
        <line x1="${padL}" y1="${y(minY)}" x2="${w-padR}" y2="${y(minY)}" class="grid"/>
        <line x1="${padL}" y1="${y((minY+maxY)/2)}" x2="${w-padR}" y2="${y((minY+maxY)/2)}" class="grid"/>
        <line x1="${padL}" y1="${y(maxY)}" x2="${w-padR}" y2="${y(maxY)}" class="grid"/>
        <text x="4" y="${y(maxY)+4}" class="axis">${maxY} m</text><text x="4" y="${y((minY+maxY)/2)+4}" class="axis">${round((minY+maxY)/2)} m</text><text x="4" y="${y(minY)+4}" class="axis">${minY} m</text>
        <polygon points="${fill}" class="terrain-fill"/><polyline points="${terrain}" class="terrain-line"/>
        ${bad ? `<polyline points="${bad}" class="terrain-bad"/>` : ''}
        <polyline points="${los}" class="los-line"/>
        <circle cx="${padL}" cy="${y(profile.samples[0].elevation)}" r="4" class="home-dot"/><circle cx="${w-padR}" cy="${y(profile.samples.at(-1).elevation)}" r="4" class="tx-dot"/>
        <text x="${padL}" y="${h-8}" class="axis">Dom +${profile.rxAntennaHeight} m</text><text x="${w-padR-95}" y="${h-8}" class="axis">Nadajnik +${profile.tx.height_m} m</text>
      </svg>
      <div class="profile-summary"><b>${profile.status}</b><span>Najmniejszy zapas: ${round(profile.minClearance,1)} m · miejsce: ${round(profile.minAtKm,1)} km · dystans: ${round(profile.distance_km,1)} km</span></div>
    </div>`;
  }

  async function loadRealCoverageGeoJson() {
    try {
      const res = await fetch(`./data/coverage.geojson?v=${VERSION_Q}`, { cache: 'no-cache' });
      if (!res.ok) return;
      const geo = await res.json();
      if (!geo.features || !geo.features.length) return;
      coverageGeoJsonLayer = L.geoJSON(geo, { style: f => ({ className: 'coverage-real', color: f.properties?.color || '#16a34a', weight: 1.4, fillOpacity: Number(f.properties?.opacity ?? 0.18) }) });
      if (state.coverageVisible) coverageGeoJsonLayer.addTo(coverageLayer);
    } catch {}
  }
  function restorePaidCoverageLayer() {
    if (!state.paidCoverageTileUrl) return;
    paidCoverageLayer = L.tileLayer(state.paidCoverageTileUrl, { opacity: .55, maxZoom: 19, crossOrigin: true });
    if (state.coverageVisible) paidCoverageLayer.addTo(coverageLayer);
  }
  function applyCoverageVisibility() {
    if (state.coverageVisible) {
      if (coverageGeoJsonLayer && !coverageLayer.hasLayer(coverageGeoJsonLayer)) coverageGeoJsonLayer.addTo(coverageLayer);
      if (paidCoverageLayer && !coverageLayer.hasLayer(paidCoverageLayer)) paidCoverageLayer.addTo(coverageLayer);
    } else coverageLayer.clearLayers();
  }
  function renderCoverageSummary() { /* miejsce na legalną warstwę pokrycia; nie rysujemy udawanego zasięgu */ }

  function panelCoverage() {
    openPopover('Zasięg', `<p class="muted"><b>Nie rysuję udawanego pokrycia.</b> Aplikacja pokazuje prawdziwy zasięg tylko z legalnie wczytanej warstwy GeoJSON albo z licencjonowanych kafelków XYZ/WMS.</p>
      <div class="list">
        <button id="loadLocalCoverage"><b>Wczytaj lokalną warstwę GeoJSON</b><span>prawdziwe poligony pokrycia, jeśli masz plik</span></button>
      </div>
      <input id="coverageFile" type="file" accept=".geojson,.json" hidden>
      <div class="form-stack"><label>URL kafelków pokrycia, płatne/licencjonowane</label><input id="coverageUrl" placeholder="https://.../{z}/{x}/{y}.png" value="${escapeAttr(state.paidCoverageTileUrl)}"><button class="primary-btn" id="saveCoverageUrl">Zapisz warstwę</button></div>`);
    $('loadLocalCoverage').addEventListener('click', () => $('coverageFile').click());
    $('coverageFile').addEventListener('change', importCoverageFile);
    $('saveCoverageUrl').addEventListener('click', () => {
      state.paidCoverageTileUrl = $('coverageUrl').value.trim(); saveState();
      if (paidCoverageLayer) coverageLayer.removeLayer(paidCoverageLayer);
      paidCoverageLayer = null;
      restorePaidCoverageLayer();
      toast('Zapisano warstwę pokrycia');
    });
  }
  async function importCoverageFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const text = await file.text();
    const geo = JSON.parse(text);
    if (coverageGeoJsonLayer) coverageLayer.removeLayer(coverageGeoJsonLayer);
    coverageGeoJsonLayer = L.geoJSON(geo, { style: f => ({ color: f.properties?.color || '#16a34a', weight:1.4, fillOpacity:Number(f.properties?.opacity ?? 0.18) }) }).addTo(coverageLayer);
    state.coverageVisible = true; saveState(); closePopover(); toast('Wczytano warstwę GeoJSON');
  }

  function panelData() {
    const meta = state.datasetMeta || {};
    openPopover('Dane / API', `<p class="muted">Baza: <b>${escapeHtml(meta.dataset_type || 'lokalna')}</b>. Nadajniki w aplikacji: <b>${state.transmitters.length}</b>.</p>
      <div class="list">
        <button id="importFileBtn"><b>Importuj nadajniki z JSON/CSV</b><span>najpewniejsza metoda, bez problemów CORS</span></button>
        <button id="tryUkeH"><b>Spróbuj pobrać UKE CSV H</b><span>jeśli CORS pozwoli</span></button>
        <button id="tryUkeR"><b>Spróbuj pobrać UKE CSV R</b><span>jeśli CORS pozwoli</span></button>
        <button id="exportJson"><b>Eksportuj obecną bazę JSON</b><span>do dalszej edycji</span></button>
      </div>
      <input id="importTxFile" type="file" accept=".json,.csv,.txt" hidden>
      <div class="form-stack"><label>Płatne API elewacji, opcjonalnie</label><input id="paidElevUrl" placeholder="https://.../elevation?lat={lat}&lon={lon}&key=..." value="${escapeAttr(state.paidElevationTemplate)}"><button class="primary-btn" id="savePaidElev">Zapisz API elewacji</button></div>
      <p class="muted small">Darmowe źródła dodane w paczce: Open-Meteo Elevation, linki UKE CSV, opis licencji RadioPolska. Gotowe mapy pokrycia RadioPolska/Emitel nie są kopiowane bez zgody.</p>`);
    $('importFileBtn').addEventListener('click', () => $('importTxFile').click());
    $('importTxFile').addEventListener('change', importTxFile);
    $('tryUkeH').addEventListener('click', () => tryFetchUke(UKE_CSV_H));
    $('tryUkeR').addEventListener('click', () => tryFetchUke(UKE_CSV_R));
    $('exportJson').addEventListener('click', exportCurrentJson);
    $('savePaidElev').addEventListener('click', () => { state.paidElevationTemplate = $('paidElevUrl').value.trim(); saveState(); toast('Zapisano API elewacji'); });
  }
  async function tryFetchUke(url) {
    try {
      toast('Pobieram CSV UKE...');
      const res = await fetch(url, { cache:'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const imported = parseCsvToTransmitters(text);
      if (!imported.length) throw new Error('Nie rozpoznałem kolumn CSV. Pobierz plik i dostosuj do szablonu.');
      applyImportedTransmitters(imported, 'UKE CSV');
    } catch (err) {
      toast('Nie udało się pobrać UKE przez CORS. Pobierz CSV i importuj plik ręcznie.');
      window.open(url, '_blank', 'noopener');
    }
  }
  async function importTxFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const text = await file.text();
    try {
      let imported;
      if (file.name.toLowerCase().endsWith('.json')) {
        const json = JSON.parse(text);
        imported = normalizeTransmitters(json.transmitters || json);
      } else imported = parseCsvToTransmitters(text);
      if (!imported.length) throw new Error('Brak rozpoznanych nadajników.');
      applyImportedTransmitters(imported, file.name);
    } catch (err) { toast(err.message || 'Błąd importu'); }
  }
  function applyImportedTransmitters(imported, source) {
    state.transmitters = normalizeTransmitters(imported);
    state.datasetMeta = { version: VERSION, dataset_type: 'imported', source, updated_at: new Date().toISOString() };
    localStorage.setItem('dvbt-point-transmitters-v14', JSON.stringify({ meta: state.datasetMeta, transmitters: state.transmitters }));
    renderTransmitters(); selectBest(true); updateDatasetChip(); closePopover(); toast(`Zaimportowano ${state.transmitters.length} nadajników`);
  }
  function loadImportedTransmittersIfAny() {
    try {
      const saved = JSON.parse(localStorage.getItem('dvbt-point-transmitters-v14'));
      if (saved?.transmitters?.length) { state.datasetMeta = saved.meta; state.transmitters = normalizeTransmitters(saved.transmitters); return true; }
    } catch {}
    return false;
  }
  function parseCsvToTransmitters(text) {
    const rows = parseCsv(text); if (!rows.length) return [];
    const headers = rows[0].map(h => h.trim().toLowerCase());
    const idx = (...names) => headers.findIndex(h => names.some(n => h.includes(n)));
    const iName = idx('obiekt','nazwa','stacja','lokalizacja');
    const iLat = idx('szer','lat'); const iLon = idx('dł','dl','lon','long');
    const iMux = idx('mux','multipleks'); const iCh = idx('kanał','kanal','k '); const iFreq = idx('częst','czest','mhz'); const iErp = idx('erp','moc'); const iPol = idx('polaryz','pol.'); const iHeight = idx('wysokość','wysokosc','maszt');
    if (iName < 0 || iLat < 0 || iLon < 0) return [];
    const mapByKey = new Map();
    for (const r of rows.slice(1)) {
      const name = r[iName]?.trim(); const lat = parseNum(r[iLat]); const lon = parseNum(r[iLon]);
      if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const key = slug(`${name}-${lat}-${lon}`);
      if (!mapByKey.has(key)) mapByKey.set(key, { id:key, name, lat, lon, height_m: parseNum(r[iHeight]) || 50, source:'import CSV', muxes:[] });
      const tx = mapByKey.get(key);
      tx.muxes.push({ mux: r[iMux]?.trim() || 'MUX-?', channel: r[iCh]?.trim() || '—', frequency_mhz: parseNum(r[iFreq]) || 0, erp_kw: parseNum(r[iErp]) || 0, polarization: r[iPol]?.trim() || '—', band: bandFromFreq(parseNum(r[iFreq])) });
    }
    return [...mapByKey.values()];
  }
  function parseCsv(text) {
    const sep = text.includes(';') ? ';' : ',';
    const rows=[]; let row=[], cell='', inQ=false;
    for (let i=0;i<text.length;i++) {
      const c=text[i], n=text[i+1];
      if (c==='"' && inQ && n==='"') { cell+='"'; i++; }
      else if (c==='"') inQ=!inQ;
      else if (c===sep && !inQ) { row.push(cell); cell=''; }
      else if ((c==='\n' || c==='\r') && !inQ) { if (cell || row.length) { row.push(cell); rows.push(row); row=[]; cell=''; } if (c==='\r' && n==='\n') i++; }
      else cell+=c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  function parseNum(v) { if (v == null) return NaN; return Number(String(v).replace(',','.').replace(/[^0-9.\-]/g,'')); }
  function exportCurrentJson() {
    const blob = new Blob([JSON.stringify({ meta: state.datasetMeta || {}, transmitters: state.transmitters }, null, 2)], { type:'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'transmitters-export.json'; a.click(); URL.revokeObjectURL(a.href);
  }

  function panelPwa() {
    openPopover('PWA', `<div class="list">
      <button id="reloadApp"><b>Wymuś aktualizację</b><span>odśwież cache aplikacji</span></button>
      <button id="clearSettings"><b>Wyczyść ustawienia lokalne</b><span>bez kasowania kodu na GitHub</span></button>
    </div><p class="muted small">Wersja ${VERSION}. Profil terenu jest prawdziwy z API. Zasięg tylko z legalnej warstwy GeoJSON/kafelków.</p>`);
    $('reloadApp').addEventListener('click', async () => { if ('serviceWorker' in navigator) { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r => r.update())); } location.reload(); });
    $('clearSettings').addEventListener('click', () => { localStorage.removeItem(STORE_KEY); location.reload(); });
  }

  function bindEvents() {
    $('gpsBtn').addEventListener('click', locateGps);
    $('transmittersBtn').addEventListener('click', panelTransmitters);
    $('layersBtn').addEventListener('click', panelLayers);
    $('filtersBtn').addEventListener('click', panelFilters);
    $('compassBtn').addEventListener('click', panelCompass);
    $('terrainBtn').addEventListener('click', panelProfile);
    $('pwaBtn').addEventListener('click', panelPwa);
    $('dataBtn').addEventListener('click', panelData);
    $('coverageBtn').addEventListener('click', panelCoverage);
    $('sheetToggleBtn').addEventListener('click', toggleSheet);
    $('sheetClose').addEventListener('click', () => hideSheet(true));
    $('collapseSheetBtn').addEventListener('click', () => hideSheet(true));
    $('reopenSheet').addEventListener('click', () => showSheet(true));
    $('sheetHandle').addEventListener('click', () => $('bottomSheet').classList.toggle('is-compact'));
    $('popoverClose').addEventListener('click', closePopover);
    $('antennaModeBtn').addEventListener('click', () => { hideSheet(true); panelCompass(); });
    $('profileQuickBtn').addEventListener('click', panelProfile);
    $('muxQuickBtn').addEventListener('click', () => { showSheet(false); $('stationDetails').scrollIntoView({ behavior:'smooth', block:'nearest' }); });
    $('searchForm').addEventListener('submit', searchAddress);
    $('locationChip').textContent = `🏠 ${state.rx.label}`;
    window.addEventListener('resize', () => { setAppHeight(); forceMapResizeHard(); });
    window.visualViewport?.addEventListener('resize', () => { setAppHeight(); forceMapResizeHard(); });
    window.addEventListener('orientationchange', () => setTimeout(forceMapResizeHard, 450));
    window.addEventListener('online', updateDatasetChip);
    window.addEventListener('offline', updateDatasetChip);
  }

  function escapeHtml(s) { return String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function escapeAttr(s) { return escapeHtml(s).replace(/`/g,'&#96;'); }

  async function boot() {
    setAppHeight(); injectMarkerCss(); bindEvents();
    await loadTransmitters();
    loadImportedTransmittersIfAny();
    initMap();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }
  boot().catch(err => { console.error(err); toast('Błąd startu aplikacji'); });
})();
