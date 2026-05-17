(() => {
  'use strict';
  const APP_VERSION = '19.15 - 1705262135';
  const STORE = 'dvbt-point-v19-state';
  const $ = id => document.getElementById(id);
  const state = {
    map:null, baseLayer:null, base:'osm', rx:{lat:50.2871, lon:21.4238, label:'Mielec / punkt odbioru'}, rxHeight:6,
    txs:[], selected:null, markers:L.layerGroup(), line:null, range:null, homeMarker:null, headingCone:null,
    heading:null, rawHeading:null, pendingHeading:null, headingSource:'brak', headingInvert:false, headingOffset:0, compassOn:false, gpsWatchId:null, headingRaf:null, headingSamples:[], headingLastTs:0, coverageLayer:null, rfLayer:null, coverageTileUrl:'', rfBusy:false, lastRf:null, antPatterns:new Map(), demCache:null, demBusy:false
  };
  let profileAbort = null;
  function withTimeoutSignal(ms){
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return {signal: ctrl.signal, clear: () => clearTimeout(timer)};
  }

  function normDeg(v){ return ((v % 360) + 360) % 360; }
  function smoothHeading(prev, next, strength=.075){
    if(prev==null) return normDeg(next);
    const delta=((next-prev+540)%360)-180;
    return normDeg(prev + delta*strength);
  }
  function circularMeanDeg(values){
    if(!values.length) return null;
    let sx=0, sy=0;
    values.forEach(v=>{ sx += Math.cos(rad(v)); sy += Math.sin(rad(v)); });
    return normDeg(Math.atan2(sy, sx) * 180 / Math.PI);
  }
  function scheduleHeadingApply(){
    if(state.headingRaf) return;
    state.headingRaf = requestAnimationFrame(() => {
      state.headingRaf = null;
      const now = performance.now();
      if(now - state.headingLastTs < 90){ scheduleHeadingApply(); return; }
      state.headingLastTs = now;
      const mean = circularMeanDeg(state.headingSamples.slice(-7));
      if(mean == null) return;
      if(state.heading != null){
        const jump = Math.abs(diff(state.heading, mean));
        if(jump < 1.2) return;
      }
      state.heading = smoothHeading(state.heading, mean, .075);
      updateCompass();
    });
  }
  function applyHeading(raw, source='sensor'){
    if(!Number.isFinite(raw)) return;
    let h = raw;
    if(source !== 'ios') h = state.headingInvert ? raw : (360 - raw);
    h = normDeg(h + (state.headingOffset || 0));
    state.rawHeading = raw;
    state.headingSource = source;
    state.headingSamples.push(h);
    if(state.headingSamples.length > 12) state.headingSamples.shift();
    scheduleHeadingApply();
  }
  function setManualHeading(value){
    state.heading = normDeg(+value || 0);
    state.rawHeading = state.heading;
    state.headingSource = 'ręczny';
    state.headingSamples = [state.heading];
    updateCompass();
  }

  function setAppHeight(){
    const h = Math.round((window.visualViewport && window.visualViewport.height) || window.innerHeight || document.documentElement.clientHeight);
    document.documentElement.style.setProperty('--app-h', `${h}px`);
    if (state.map) requestAnimationFrame(() => state.map.invalidateSize(true));
  }
  setAppHeight();
  window.addEventListener('resize', setAppHeight);
  window.visualViewport?.addEventListener('resize', setAppHeight);
  window.addEventListener('orientationchange', () => setTimeout(setAppHeight, 250));

  function save(){ localStorage.setItem(STORE, JSON.stringify({rx:state.rx, rxHeight:state.rxHeight, base:state.base, selectedId:state.selected?.id || null, headingInvert:state.headingInvert, headingOffset:state.headingOffset, coverageTileUrl:state.coverageTileUrl||''})); }
  function load(){ try{ const s=JSON.parse(localStorage.getItem(STORE)||'{}'); Object.assign(state, {rx:s.rx||state.rx, rxHeight:s.rxHeight||state.rxHeight, base:s.base||state.base, headingInvert:!!s.headingInvert, headingOffset:+s.headingOffset||0, coverageTileUrl:s.coverageTileUrl||''}); state._selectedId=s.selectedId; }catch{} }
  function toast(msg){ const t=$('toast'); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true,2600); }
  function setDisplayedVersion(){
    document.title = `DVB-T/T2 Point ${APP_VERSION}`;
    ['versionFloating'].forEach(id => {
      const el = $(id);
      if(el) el.textContent = APP_VERSION;
    });
  }
  function esc(s){ return String(s ?? '').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function rad(d){ return d*Math.PI/180; }
  function dist(a,b){ const R=6371; const dLat=rad(b.lat-a.lat), dLon=rad(b.lon-a.lon); const x=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2; return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)); }
  function az(a,b){ const y=Math.sin(rad(b.lon-a.lon))*Math.cos(rad(b.lat)); const x=Math.cos(rad(a.lat))*Math.sin(rad(b.lat))-Math.sin(rad(a.lat))*Math.cos(rad(b.lat))*Math.cos(rad(b.lon-a.lon)); return (Math.atan2(y,x)*180/Math.PI+360)%360; }
  function diff(from,to){ return ((to-from+540)%360)-180; }
  function fmtKm(k){ return k<10 ? `${k.toFixed(1)} km` : `${Math.round(k)} km`; }
  function muxNames(t){ return [...new Set((t.muxes||[]).map(m=>m.name))]; }
  function pols(t){ return [...new Set((t.muxes||[]).map(m=>m.polarization||m.pol).filter(Boolean))].join('/') || '—'; }
  function stationPowerText(t){
    const values=(t?.muxes||[])
      .map(m=>Number(String(m.erp_kw ?? m.erp ?? '').replace(',', '.')))
      .filter(v=>Number.isFinite(v) && v>0);
    if(!values.length) return '—';
    const min=Math.min(...values);
    const max=Math.max(...values);
    const fmt=v => Number.isInteger(v) ? String(v) : String(+v.toFixed(2)).replace('.', ',');
    return min===max ? `${fmt(max)} kW` : `${fmt(min)}–${fmt(max)} kW`;
  }

  function normalizeTx(raw){
    const muxes=(raw.muxes||[]).map(m=>({
      name:m.name||m.mux||'MUX',
      channel:m.channel||m.kanal||'—',
      channel_no:m.channel_no||m.channelNo||null,
      frequency_mhz:m.frequency_mhz||m.frequency||m.czestotliwosc||'',
      erp_kw:m.erp_kw||m.erp||'',
      polarization:m.polarization||m.pol||'—',
      band:m.band||'—',
      pattern:m.pattern||m.kierunkowosc||'—',
      antenna_height_m:m.antenna_height_m||m.tx_height_m||'',
      antenna_name:m.antenna_name||'',
      antenna_config:m.antenna_config||'',
      operator:m.operator||raw.operator||'',
      voivodeship_code:m.voivodeship_code||'',
      radiopolska_emission_url:m.radiopolska_emission_url||'',
      ant_file_url:m.ant_file_url||'',
      ant_file_id:m.ant_file_id||'',
      ant_pattern_path:m.ant_pattern_path||''
    }));
    return {...raw, short_name:raw.short_name||raw.name, height:raw.mast_height_m||raw.height||60, muxes};
  }

  function initMap(){
    state.map = L.map('map', {center:[state.rx.lat,state.rx.lon], zoom:8, minZoom:5, maxZoom:18, zoomControl:false, attributionControl:true, inertia:true, tap:true, preferCanvas:true});
    state.map.createPane('headingPane');
    state.map.getPane('headingPane').style.zIndex = 690;
    state.map.getPane('headingPane').style.pointerEvents = 'none';
    L.control.zoom({position:'bottomright'}).addTo(state.map);
    state.markers.addTo(state.map);
    setBase(state.base, false);
    state.map.on('click', () => { closePanel(); });
    state.map.on('resize', () => state.map.invalidateSize(true));
    state.map.on('contextmenu', e => setRx(e.latlng.lat, e.latlng.lng, 'Punkt wskazany na mapie', true, true));
    for (const ms of [50,180,450,900,1600]) setTimeout(()=>state.map.invalidateSize(true), ms);
  }
  function setBase(type, persist=true){
    state.base=type || 'osm';
    if(state.baseLayer) state.map.removeLayer(state.baseLayer);
    const opts={maxZoom:19, updateWhenIdle:true, updateWhenZooming:false, keepBuffer:3, crossOrigin:true, detectRetina:false, attribution:'&copy; OpenStreetMap'};
    if(state.base==='sat') state.baseLayer=L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {...opts, attribution:'Tiles &copy; Esri'});
    else if(state.base==='light') state.baseLayer=L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {...opts, subdomains:'abcd', attribution:'&copy; OpenStreetMap &copy; CARTO'});
    else state.baseLayer=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', opts);
    state.baseLayer.addTo(state.map);
    renderHeadingCone();
    setTimeout(()=>state.map.invalidateSize(true),80);
    if(persist) save();
  }
  function isValidTx(t){
    return t && String(t.id || '').trim() && String(t.name || t.short_name || '').trim() && Number.isFinite(+t.lat) && Number.isFinite(+t.lon) && Array.isArray(t.muxes);
  }
  async function loadTxs(){
    try{
      const r=await fetch(`data/transmitters.json?v=${Date.now()}`, {cache:'no-store'});
      if(!r.ok) throw new Error(`Nie udało się pobrać data/transmitters.json: HTTP ${r.status}`);
      const j=await r.json();
      const list = Array.isArray(j) ? j : j.transmitters;
      if(!Array.isArray(list)) throw new Error('Plik data/transmitters.json nie zawiera listy nadajników.');
      state.txs=list.map(normalizeTx).filter(isValidTx);
      if(!state.txs.length) throw new Error('Brak poprawnych nadajników w data/transmitters.json.');
      renderAll();
      selectTx(state._selectedId || bestTx()?.id, true, false);
    }catch(err){
      console.error(err);
      state.txs=[];
      renderAll();
      toast(err.message || 'Błąd ładowania nadajników.');
      openPanel('Błąd danych nadajników','Aplikacja działa, ale nie ma poprawnej bazy nadajników.', `<div class="info-card"><strong>Nie wczytano data/transmitters.json</strong><span>${esc(err.message || err)}</span></div>`);
    }
  }
  function bestTx(){ return sortedTxs()[0]; }
  function sortedTxs(){ return state.txs.map(t=>({...t, distance:dist(state.rx,t), azimuth:az(state.rx,t)})).sort((a,b)=>a.distance-b.distance); }
  function txById(id){ return sortedTxs().find(t=>t.id===id); }
  function passesFilter(t){ return true; }

  function renderAll(){ renderHome(); renderTxMarkers(); }
  function renderHome(){
    if(state.homeMarker) state.map.removeLayer(state.homeMarker);
    const icon=L.divIcon({html:'<div class="home-marker">🏠</div>', className:'', iconSize:[32,32], iconAnchor:[16,16]});
    state.homeMarker=L.marker([state.rx.lat,state.rx.lon], {icon, draggable:true, zIndexOffset:500}).addTo(state.map);
    state.homeMarker.on('dragend', e=>setRx(e.target.getLatLng().lat, e.target.getLatLng().lng, 'Punkt wskazany na mapie', false));
    renderHeadingCone();
    const locationChip = $('locationChip');
    if (locationChip) locationChip.textContent = `🏠 ${state.rx.label || 'Punkt odbioru'}`;
  }
  function renderHeadingCone(){
    if(state.headingCone) state.map.removeLayer(state.headingCone);
    if(state.heading == null) return;
    const coneHtml = `<div class="heading-cone" style="transform:rotate(${Math.round(state.heading)}deg)"><svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 50 L30 2 Q50 -7 70 2 Z"/><circle cx="50" cy="50" r="4"/></svg></div>`;
    const coneIcon=L.divIcon({html:coneHtml, className:'', iconSize:[110,110], iconAnchor:[55,55]});
    state.headingCone=L.marker([state.rx.lat,state.rx.lon], {icon:coneIcon, interactive:false, pane:'headingPane', zIndexOffset:1200}).addTo(state.map);
  }
  function renderTxMarkers(){
    state.markers.clearLayers();
    for(const t of sortedTxs().filter(passesFilter)){
      const selected=state.selected?.id===t.id;
      const icon=L.divIcon({html:`<div class="tx-marker ${selected?'selected':''}">📡</div>`, className:'', iconSize:[30,30], iconAnchor:[15,15]});
      L.marker([t.lat,t.lon], {icon, title:t.short_name||t.name}).on('click', e=>{e.originalEvent?.stopPropagation?.(); selectTx(t.id,true,true);}).addTo(state.markers);
    }
  }
  function selectTx(id, pan=true, show=true){
    const t=txById(id) || bestTx(); if(!t) return;
    state.selected=t; save(); renderTxMarkers(); renderConnection(); updateStationCard(); updateCompass();
    if(pan) state.map.fitBounds([[state.rx.lat,state.rx.lon],[t.lat,t.lon]], {paddingTopLeft:[70,120], paddingBottomRight:[70,190], maxZoom:10, animate:true});
    if(show) showStation();
  }
  function renderConnection(){
    if(state.line) state.map.removeLayer(state.line); if(state.range) state.map.removeLayer(state.range);
    const t=state.selected; if(!t) return;
    state.line=L.polyline([[state.rx.lat,state.rx.lon],[t.lat,t.lon]], {color:'#2563eb', weight:3, opacity:.82}).addTo(state.map);
    const maxErp=Math.max(1,...t.muxes.map(m=>+m.erp_kw||1));
    const radius=Math.min(90000, Math.max(25000, Math.sqrt(maxErp)*8500));
    state.range=L.circle([t.lat,t.lon], {radius, color:'#2563eb', weight:1, opacity:.22, fillOpacity:.045}).addTo(state.map);
  }
  function showStation(){ $('stationCard').hidden=false; $('openStationBtn').hidden=true; setTimeout(()=>state.map.invalidateSize(true),80); }
  function hideStation(){ $('stationCard').hidden=true; $('openStationBtn').hidden=false; setTimeout(()=>state.map.invalidateSize(true),80); }
  function updateStationCard(){
    const t=state.selected; if(!t) return;
    $('stationName').textContent=t.short_name||t.name;
    $('stationAzimuth').textContent=`${Math.round(t.azimuth)}°`;
    $('stationDistance').textContent=fmtKm(t.distance);
    $('stationPol').textContent=pols(t);
    $('stationPower').textContent=stationPowerText(t);
  }

  function openPanel(title, subtitle, html){ $('panelTitle').textContent=title; $('panelSubtitle').textContent=subtitle||''; $('panelContent').innerHTML=html; $('appPanel').classList.remove('collapsed'); setTimeout(()=>state.map.invalidateSize(true),80); }
  function closePanel(){ $('appPanel').classList.add('collapsed'); }
  function showTxList(){
    const html=sortedTxs().map(t=>`<button class="tx-item ${state.selected?.id===t.id?'active':''}" data-tx="${esc(t.id)}"><strong>${esc(t.short_name||t.name)}</strong><span>${fmtKm(t.distance)} · azymut ${Math.round(t.azimuth)}° · moc ERP ${stationPowerText(t)} · MUX ${muxNames(t).map(m=>m.replace('MUX-','')).join('/')}</span></button>`).join('');
    openPanel('Nadajniki','Lista według odległości od punktu odbioru.',html);
    $('panelContent').querySelectorAll('[data-tx]').forEach(b=>b.onclick=()=>{selectTx(b.dataset.tx,true,true); closePanel();});
  }
  function showMux(){
    const t=state.selected; if(!t) return;
    const rows=t.muxes.map(m=>{
      const links=[];
      if(m.radiopolska_emission_url) links.push(`<a href="${esc(m.radiopolska_emission_url)}" target="_blank" rel="noopener">emisja</a>`);
      if(m.ant_file_url) links.push(`<a href="${esc(m.ant_file_url)}" target="_blank" rel="noopener">plik ANT</a>`);
      const details=[
        `${m.frequency_mhz||'—'} MHz`,
        `ERP ${m.erp_kw||'—'} kW`,
        `pol. ${esc(m.polarization)}`,
        esc(m.band),
        `char. ${esc(m.pattern||'—')}`,
        m.antenna_height_m ? `antena ${esc(m.antenna_height_m)} m n.p.t.` : '',
        m.antenna_name ? `typ ${esc(m.antenna_name)}` : '',
        m.antenna_config ? `konf. ${esc(m.antenna_config)}` : '',
        m.operator ? `operator ${esc(m.operator)}` : '',
        links.length ? links.join(' · ') : ''
      ].filter(Boolean).join(' · ');
      return `<div class="tx-item mux-card"><strong>${esc(m.name)} · ${esc(m.channel)} · ERP ${esc(m.erp_kw||'—')} kW</strong><span>${details}</span></div>`;
    }).join('');
    const meta=`${t.location?esc(t.location)+' / ':''}${esc(t.site||t.short_name||t.name)} · ${t.site_elevation_m||'—'} m n.p.m. · maszt/antena ${t.height||'—'} m n.p.t.`;
    openPanel('MUX-y i moce nadajnika', meta, rows);
  }
  function showLayers(){
    openPanel('Warstwy','Podkład mapy.', `<button class="tx-item ${state.base==='osm'?'active':''}" data-base="osm"><strong>Plan OSM</strong><span>Najstabilniejsza mapa.</span></button><button class="tx-item ${state.base==='light'?'active':''}" data-base="light"><strong>Jasna CARTO</strong><span>Lżejsza wizualnie.</span></button><button class="tx-item ${state.base==='sat'?'active':''}" data-base="sat"><strong>Satelita Esri</strong><span>Cięższa, wymaga internetu.</span></button>`);
    $('panelContent').querySelectorAll('[data-base]').forEach(b=>b.onclick=()=>{setBase(b.dataset.base); closePanel();});
  }
  function showFilters(){
    toast('Zakładka Filtry została usunięta, bo dublowała funkcje programu.');
  }

  function clearCoverageLayer(){
    if(state.coverageLayer){ state.map.removeLayer(state.coverageLayer); state.coverageLayer=null; }
  }
  function validateCoverageTileUrl(rawUrl){
    const value=(rawUrl||'').trim();
    if(!value) return '';
    let parsed;
    try{ parsed = new URL(value); }catch{ throw new Error('Adres kafelków jest niepoprawny.'); }
    if(parsed.protocol !== 'https:') throw new Error('Adres kafelków musi zaczynać się od https://.');
    for(const token of ['{z}','{x}','{y}']){
      if(!value.includes(token)) throw new Error(`Adres kafelków musi zawierać ${token}.`);
    }
    return value;
  }
  function applyCoverageTile(url){
    clearCoverageLayer();
    let safeUrl='';
    try{ safeUrl = validateCoverageTileUrl(url); }catch(err){
      state.coverageTileUrl='';
      save();
      toast(err.message || 'Niepoprawny adres kafelków.');
      return;
    }
    state.coverageTileUrl=safeUrl;
    if(!state.coverageTileUrl){ save(); return; }
    state.coverageLayer=L.tileLayer(state.coverageTileUrl, {
      maxZoom:19, opacity:.58, updateWhenIdle:true, updateWhenZooming:false, keepBuffer:2, attribution:'Warstwa zasięgu: zewnętrzne/licencjonowane źródło'
    }).addTo(state.map);
    save();
    toast('Podłączono zewnętrzną warstwę prawdziwego zasięgu.');
  }
  function countGeoJsonPositions(coords){
    if(!Array.isArray(coords)) return 0;
    if(typeof coords[0] === 'number' && typeof coords[1] === 'number') return 1;
    return coords.reduce((sum,item)=>sum+countGeoJsonPositions(item),0);
  }
  function validateGeoJson(geo){
    if(!geo || geo.type !== 'FeatureCollection' || !Array.isArray(geo.features)) throw new Error('Plik musi być GeoJSON typu FeatureCollection.');
    if(geo.features.length > 5000) throw new Error('GeoJSON ma za dużo obiektów. Limit: 5000 Feature.');
    let positions=0;
    for(const f of geo.features){
      if(!f || f.type !== 'Feature' || !f.geometry) throw new Error('GeoJSON zawiera niepoprawny obiekt Feature.');
      positions += countGeoJsonPositions(f.geometry.coordinates);
      if(positions > 200000) throw new Error('GeoJSON ma za dużo punktów geometrii. Limit: 200 000.');
    }
  }
  async function importCoverageGeoJson(file){
    if(!file) return;
    const maxBytes = 10 * 1024 * 1024;
    if(file.size > maxBytes) throw new Error('Plik GeoJSON jest za duży. Limit: 10 MB.');
    const text=await file.text();
    let geo;
    try{ geo=JSON.parse(text); }catch{ throw new Error('Plik GeoJSON ma błędny JSON.'); }
    validateGeoJson(geo);
    clearCoverageLayer();
    state.coverageLayer=L.geoJSON(geo,{
      style:f=>{
        const level=String(f.properties?.level||f.properties?.status||f.properties?.coverage||'').toLowerCase();
        const color=level.includes('dob')||level.includes('good')?'#16a34a':level.includes('śred')||level.includes('medium')?'#f59e0b':level.includes('sła')||level.includes('weak')?'#f97316':'#dc2626';
        return {color, weight:1, opacity:.45, fillColor:color, fillOpacity:.18};
      },
      pointToLayer:(f,latlng)=>L.circleMarker(latlng,{radius:5, color:'#2563eb', weight:1, fillOpacity:.35})
    }).addTo(state.map);
    toast('Zaimportowano prawdziwą warstwę zasięgu GeoJSON.');
  }

  function showData(){
    const muxCount=state.txs.reduce((sum,t)=>sum+(t.muxes?.length||0),0);
    openPanel('Dane i diagnostyka','Najważniejsze funkcje techniczne bez zbędnych opcji.', `
      <div class="info-card"><strong>Wersja</strong><span>${APP_VERSION}</span></div>
      <div class="info-card"><strong>Baza nadajników</strong><span>Załadowano ${state.txs.length} obiektów nadawczych i ${muxCount} emisji/MUX-ów z data/transmitters.json.</span></div>
      <div class="info-card"><strong>Profil terenu</strong><span>Profil działa najpierw z lokalnego cache DEM. Jeżeli API Open-Meteo jest zablokowane limitem, aplikacja pokaże profil awaryjny oznaczony jako przybliżony, zamiast zostawiać puste okno.</span><button id="downloadDemSelected" class="panel-btn primary">Pobierz DEM dla wybranego nadajnika</button><button id="showDemStats" class="panel-btn">Stan cache DEM</button></div>
      <div class="info-card"><strong>Zasięg terenowy RF / ITM-lite</strong><span>Liczenie poglądowego zasięgu z ERP, częstotliwości, wysokości anten, DEM i charakterystyki ANT, jeśli plik ANT jest dostępny lokalnie.</span><button id="calcRfCoverage" class="panel-btn primary">Oblicz zasięg terenowy</button><button id="clearRfCoverage" class="panel-btn">Usuń obliczony zasięg</button></div>
      <div class="info-card"><strong>Pliki ANT anten</strong><span>Diagnostyka sprawdza, czy w tej konkretnej paczce/na tej stronie są faktycznie dostępne pliki data/ant/*.ant. Sama przeglądarka nie zapisze ich automatycznie na GitHubie — trzeba je pobrać skryptem i wgrać razem z aplikacją.</span><button id="runAntDiagnostics" class="panel-btn primary">Sprawdź pliki ANT</button></div>
      <button id="refreshPwa" class="panel-btn primary">Wymuś aktualizację PWA</button>`);
    $('calcRfCoverage').onclick=()=>calculateRfCoverage().catch(err=>toast('Błąd obliczeń RF: '+(err.message||err)));
    $('clearRfCoverage').onclick=()=>{ clearRfLayer(); toast('Usunięto obliczony zasięg RF.'); };
    $('runAntDiagnostics').onclick=()=>runAntDiagnostics().catch(err=>toast('Błąd diagnostyki ANT: '+(err.message||err)));
    $('downloadDemSelected').onclick=()=>downloadDemForSelectedTx();
    $('showDemStats').onclick=()=>{ const st=demStats(); toast('Cache DEM: '+st.points+' punktów lokalnie.'); };
    $('refreshPwa').onclick=async()=>{ const regs=await navigator.serviceWorker?.getRegistrations?.()||[]; for(const r of regs){ await r.unregister(); } const keys=await caches.keys(); await Promise.all(keys.map(k=>caches.delete(k))); location.reload(); };
  }



  function showAbout(){
    openPanel('O programie','Instrukcja obsługi i opis funkcji.', `
      <div class="info-card"><strong>Do czego służy program</strong><span>Aplikacja pomaga dobrać nadajnik DVB-T/T2 dla wskazanego punktu odbioru. Pokazuje odległość, azymut, MUX-y, moc ERP, profil terenu, kompas anteny i warstwy pomocnicze.</span></div>
      <div class="info-card"><strong>1. Ustaw punkt odbioru</strong><span>Wpisz adres w polu wyszukiwania, użyj GPS albo przytrzymaj palec na mapie. Od wersji 19.13 zmiana punktu odbioru nie przełącza automatycznie wcześniej wybranego nadajnika.</span></div>
      <div class="info-card"><strong>2. Wybierz nadajnik</strong><span>Kliknij marker nadajnika albo przycisk z listą nadajników. Na karcie nadajnika zobaczysz azymut, odległość, polaryzację i moc ERP dla emisji/MUX-ów.</span></div>
      <div class="info-card"><strong>3. Ustaw antenę</strong><span>Przycisk „Ustaw antenę” otwiera kompas. Niebieska igła oznacza kierunek do nadajnika, pomarańczowa kierunek telefonu. Stożek na mapie pokazuje orientacyjny kierunek trzymania telefonu.</span></div>
      <div class="info-card"><strong>4. Profil terenu</strong><span>Profil wymaga danych wysokości DEM. Program pobiera je z API wysokości i zapisuje w lokalnym cache przeglądarki. Jeżeli API nie odpowiada, program nie udaje prawdziwego terenu prostą kreską — pokaże informację o braku DEM albo użyje tylko częściowego cache jako profil przybliżony.</span></div>
      <div class="info-card"><strong>5. DEM i zasięg terenowy</strong><span>Przycisk „Pobierz DEM” zapisuje lokalnie wysokości dla okolicy wybranego nadajnika. Obliczony zasięg RF/ITM-lite jest poglądowy: bierze pod uwagę ERP, częstotliwość, wysokość anten, teren i lokalne pliki ANT, jeśli są dostępne.</span></div>
      <div class="info-card"><strong>6. Warstwy mapy</strong><span>Warstwy przełączają podkład mapy oraz opcjonalną warstwę zasięgu. Jeżeli warstwa pochodzi z zewnętrznego adresu albo pliku GeoJSON, musi być poprawnie podłączona i dostępna dla przeglądarki.</span></div>
      <div class="info-card"><strong>7. Dane i diagnostyka</strong><span>Panel „Dane i diagnostyka” pokazuje liczbę nadajników, stan cache DEM, diagnostykę plików ANT, obliczenia zasięgu i przycisk wymuszenia aktualizacji PWA.</span></div>
      <div class="info-card"><strong>Wersja</strong><span>${APP_VERSION}</span></div>`);
  }

  function clearRfLayer(){
    if(state.rfLayer){ state.map.removeLayer(state.rfLayer); state.rfLayer=null; }
    state.lastRf=null;
  }
  function destinationPoint(lat, lon, bearingDeg, distanceKm){
    const R=6371, br=rad(bearingDeg), d=distanceKm/R, lat1=rad(lat), lon1=rad(lon);
    const lat2=Math.asin(Math.sin(lat1)*Math.cos(d)+Math.cos(lat1)*Math.sin(d)*Math.cos(br));
    const lon2=lon1+Math.atan2(Math.sin(br)*Math.sin(d)*Math.cos(lat1), Math.cos(d)-Math.sin(lat1)*Math.sin(lat2));
    return {lat:lat2*180/Math.PI, lon:((lon2*180/Math.PI+540)%360)-180};
  }

  const DEM_STORE = 'dvbt-point-dem-cache-v1';
  const DEM_STEP = 0.05;
  function sleep(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }
  function demKey(lat, lon){ return `${Math.round(lat/DEM_STEP)*DEM_STEP.toFixed(2)},${Math.round(lon/DEM_STEP)*DEM_STEP.toFixed(2)}`; }
  function demKeyFromPoint(p){
    const lat = Math.round(p.lat / DEM_STEP) * DEM_STEP;
    const lon = Math.round(p.lon / DEM_STEP) * DEM_STEP;
    return `${lat.toFixed(2)},${lon.toFixed(2)}`;
  }
  function parseDemKey(key){ const [lat, lon]=String(key).split(',').map(Number); return {lat, lon}; }
  function loadDemCache(){
    if(state.demCache) return state.demCache;
    try{
      const raw=localStorage.getItem(DEM_STORE);
      const obj=raw ? JSON.parse(raw) : {};
      state.demCache = obj && typeof obj === 'object' ? obj : {};
    }catch{ state.demCache = {}; }
    return state.demCache;
  }
  function saveDemCache(){
    try{ localStorage.setItem(DEM_STORE, JSON.stringify(loadDemCache())); }
    catch{ toast('Cache DEM jest pełny. Wyczyść dane strony albo zmniejsz promień pobierania.'); }
  }
  function cachedElevation(p){
    const cache=loadDemCache();
    const val=cache[demKeyFromPoint(p)];
    return Number.isFinite(+val) ? +val : null;
  }
  function demStats(){ const c=loadDemCache(); return {points:Object.keys(c).length}; }
  async function fetchElevationsFromApi(points, errText, opts={}){
    const out=[];
    const retries = Number.isFinite(+opts.retries) ? Math.max(1, +opts.retries) : 3;
    const chunkSize = Number.isFinite(+opts.chunkSize) ? Math.max(1, +opts.chunkSize) : 20;
    const timeoutMs = Number.isFinite(+opts.timeoutMs) ? Math.max(1000, +opts.timeoutMs) : 8000;
    const pauseMs = Number.isFinite(+opts.pauseMs) ? Math.max(0, +opts.pauseMs) : 400;
    async function requestJson(url){
      const timeout = withTimeoutSignal(timeoutMs);
      try{
        const r=await fetch(url, {cache:'no-store', signal: timeout.signal});
        timeout.clear();
        if(r.status === 429) throw new Error('limit API 429');
        if(!r.ok) throw new Error('HTTP '+r.status);
        return await r.json();
      }catch(e){
        timeout.clear();
        throw e;
      }
    }
    async function fetchChunk(chunk){
      const openMeteo=`https://api.open-meteo.com/v1/elevation?latitude=${chunk.map(p=>p.lat.toFixed(5)).join(',')}&longitude=${chunk.map(p=>p.lon.toFixed(5)).join(',')}`;
      try{
        const j=await requestJson(openMeteo);
        if(Array.isArray(j.elevation) && j.elevation.length === chunk.length) return j.elevation.map(x=>+x);
        throw new Error('Open-Meteo zwróciło niepełne dane');
      }catch(firstErr){
        const locations=chunk.map(p=>`${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join('|');
        const openTopo=`https://api.opentopodata.org/v1/srtm90m?locations=${locations}`;
        try{
          const j=await requestJson(openTopo);
          const vals=(j.results||[]).map(x=>+x.elevation);
          if(vals.length === chunk.length && vals.every(Number.isFinite)) return vals;
          throw new Error('OpenTopoData zwróciło niepełne dane');
        }catch(secondErr){
          throw new Error(`${firstErr.message || firstErr}; zapasowe API: ${secondErr.message || secondErr}`);
        }
      }
    }
    for(let i=0;i<points.length;i+=chunkSize){
      const chunk=points.slice(i,i+chunkSize);
      let vals=null, lastErr='';
      for(let attempt=1; attempt<=retries; attempt++){
        try{
          vals=await fetchChunk(chunk);
          break;
        }catch(e){
          lastErr=e.message||String(e);
          if(attempt < retries) await sleep(Math.min(900*attempt, 2500));
        }
      }
      if(!vals) throw new Error((errText || 'Nie udało się pobrać wysokości DEM.') + ' ' + lastErr);
      out.push(...vals);
      if(pauseMs) await sleep(pauseMs);
    }
    return out;
  }


  // 19.15: profil DEM z kafli Terrarium zamiast zależności tylko od limitowanego API punktowego.
  // Format Terrarium: elevation = (R * 256 + G + B / 256) - 32768.
  const TERRAIN_TILE_Z = 10;
  const terrainTileCache = new Map();
  function lonToTileX(lon,z){ return Math.floor((lon + 180) / 360 * Math.pow(2,z)); }
  function latToTileY(lat,z){
    const r = rad(Math.max(-85.05112878, Math.min(85.05112878, lat)));
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2,z));
  }
  function tilePixel(lat, lon, z){
    const n = Math.pow(2,z);
    const xFloat = (lon + 180) / 360 * n;
    const r = rad(Math.max(-85.05112878, Math.min(85.05112878, lat)));
    const yFloat = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
    return {tx:Math.floor(xFloat), ty:Math.floor(yFloat), px:Math.max(0,Math.min(255,Math.floor((xFloat-Math.floor(xFloat))*256))), py:Math.max(0,Math.min(255,Math.floor((yFloat-Math.floor(yFloat))*256)))};
  }
  async function loadTerrariumTile(tx,ty,z=TERRAIN_TILE_Z){
    const key=`${z}/${tx}/${ty}`;
    if(terrainTileCache.has(key)) return terrainTileCache.get(key);
    const url=`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`;
    const promise=(async()=>{
      const timeout=withTimeoutSignal(9000);
      try{
        const r=await fetch(url,{cache:'force-cache',signal:timeout.signal});
        timeout.clear();
        if(!r.ok) throw new Error('HTTP '+r.status);
        const blob=await r.blob();
        const bmp=await createImageBitmap(blob);
        const canvas=document.createElement('canvas'); canvas.width=256; canvas.height=256;
        const ctx=canvas.getContext('2d',{willReadFrequently:true});
        ctx.drawImage(bmp,0,0);
        return ctx.getImageData(0,0,256,256).data;
      }catch(e){ timeout.clear(); throw e; }
    })();
    terrainTileCache.set(key,promise);
    return promise;
  }
  async function fetchElevationsFromTerrarium(points){
    const z=TERRAIN_TILE_Z;
    const out=[];
    for(const p of points){
      const pos=tilePixel(p.lat,p.lon,z);
      const data=await loadTerrariumTile(pos.tx,pos.ty,z);
      const idx=(pos.py*256+pos.px)*4;
      const r=data[idx], g=data[idx+1], b=data[idx+2];
      const elev=(r*256 + g + b/256) - 32768;
      if(!Number.isFinite(elev) || elev < -500 || elev > 9000) throw new Error('Błędna próbka kafla DEM');
      out.push(Math.round(elev*10)/10);
    }
    return out;
  }

  async function fetchElevations(points){
    const cache=loadDemCache();
    const out=new Array(points.length);
    const missing=[];
    points.forEach((p,i)=>{
      const key=demKeyFromPoint(p);
      if(Number.isFinite(+cache[key])) out[i]=+cache[key];
      else missing.push({i, lat:p.lat, lon:p.lon, key});
    });
    if(missing.length){
      const elev=await fetchElevationsFromApi(missing, 'Open-Meteo Elevation API nie odpowiedziało podczas obliczania zasięgu.');
      missing.forEach((p,idx)=>{ out[p.i]=elev[idx]; cache[p.key]=elev[idx]; });
      saveDemCache();
    }
    return out;
  }
  function demRadiusForTx(t){
    const {erpKw, txHeight}=txMainParams(t);
    return Math.max(25, Math.min(90, Math.sqrt(erpKw)*18 + txHeight*0.18));
  }
  function buildDemGridForTx(t, radiusKm){
    const latStep=DEM_STEP;
    const lonStep=DEM_STEP / Math.max(0.25, Math.cos(rad(t.lat)));
    const dLat=radiusKm/111;
    const dLon=radiusKm/(111*Math.max(0.25, Math.cos(rad(t.lat))));
    const points=[];
    for(let lat=t.lat-dLat; lat<=t.lat+dLat; lat+=latStep){
      for(let lon=t.lon-dLon; lon<=t.lon+dLon; lon+=lonStep){
        const p={lat:+lat.toFixed(5), lon:+lon.toFixed(5)};
        if(dist(t,p) <= radiusKm) points.push(p);
      }
    }
    const unique=new Map();
    points.forEach(p=>unique.set(demKeyFromPoint(p), parseDemKey(demKeyFromPoint(p))));
    return [...unique.values()];
  }
  async function downloadDemForSelectedTx(){
    const t=state.selected; if(!t) return toast('Najpierw wybierz nadajnik.');
    if(state.demBusy) return toast('Pobieranie DEM już trwa.');
    state.demBusy=true;
    const cache=loadDemCache();
    const radius=demRadiusForTx(t);
    const grid=buildDemGridForTx(t, radius);
    const missing=grid.filter(p=>!Number.isFinite(+cache[demKeyFromPoint(p)]));
    openPanel('Pobieranie DEM', `${t.short_name||t.name}`, `<div class="info-card"><strong>Start</strong><span>Promień: około ${Math.round(radius)} km. Punkty siatki: ${grid.length}. Brakujące do pobrania: ${missing.length}. Dane zostaną zapisane w lokalnym cache przeglądarki.</span></div><div id="demProgress" class="info-card"><strong>Status</strong><span>Przygotowanie...</span></div>`);
    const progress=$('demProgress');
    try{
      for(let i=0;i<missing.length;i+=15){
        const chunk=missing.slice(i,i+15);
        progress.innerHTML=`<strong>Status</strong><span>Pobieram ${Math.min(i+chunk.length, missing.length)} / ${missing.length}. Jeżeli API zwolni, aplikacja będzie robiła krótkie pauzy.</span>`;
        const elev=await fetchElevationsFromApi(chunk, 'Nie udało się pobrać DEM dla tego nadajnika.');
        chunk.forEach((p,idx)=>{ cache[demKeyFromPoint(p)] = elev[idx]; });
        saveDemCache();
        await sleep(1200);
      }
      const st=demStats();
      progress.innerHTML=`<strong>Gotowe</strong><span>Zapisano DEM dla wybranego nadajnika. Lokalny cache ma teraz ${st.points} punktów. Profil terenu i RF będą najpierw korzystać z lokalnego DEM, a dopiero przy brakach z API.</span>`;
      toast('DEM dla nadajnika zapisany lokalnie.');
    }catch(err){
      progress.innerHTML=`<strong>Przerwano</strong><span>${esc(err.message||err)}. Dotychczas pobrane punkty zostały zapisane. Możesz kliknąć przycisk ponownie później — aplikacja pobierze tylko braki.</span>`;
      toast('DEM zapisany częściowo. Możesz wznowić później.');
    }finally{
      state.demBusy=false;
    }
  }
  function txMainParams(t){
    const mux=(t.muxes||[]).slice().sort((a,b)=>(+b.erp_kw||0)-(+a.erp_kw||0))[0] || {};
    const ch=String(mux.channel||'').replace(/[^0-9]/g,'');
    const freq=+mux.frequency_mhz || (ch ? 474 + ((+ch - 21) * 8) : 650);
    const erpKw=Math.max(0.001, +mux.erp_kw || 1);
    const txHeight=Math.max(1, +mux.antenna_height_m || +t.height || 60);
    return {mux, freq, erpKw, txHeight};
  }

  function analyzeAntPatternText(text){
    const pts=[];
    const lines=String(text||'').split(/\r?\n/);
    for(const line of lines){
      const clean=line.trim();
      if(!clean || clean.startsWith('#') || clean.startsWith(';')) continue;
      const nums=clean.replace(',', '.').match(/-?\d+(?:\.\d+)?/g);
      if(!nums || nums.length < 2) continue;
      const a=+nums[0], v=+nums[1];
      if(!Number.isFinite(a) || !Number.isFinite(v)) continue;
      if(a < 0 || a > 360 || v < -80 || v > 80) continue;
      pts.push({az:normDeg(a), value:v});
    }
    pts.sort((a,b)=>a.az-b.az);
    const uniqueAz=[...new Set(pts.map(p=>Math.round(p.az)))];
    const minAz=uniqueAz.length ? Math.min(...uniqueAz) : null;
    const maxAz=uniqueAz.length ? Math.max(...uniqueAz) : null;
    const hasZero=uniqueAz.includes(0);
    const has360=uniqueAz.includes(360);
    const approxFull=uniqueAz.length >= 180 || (uniqueAz.length >= 24 && minAz <= 5 && maxAz >= 355);
    const ok=pts.length >= 8;
    let gain=[];
    if(ok){
      const maxVal=Math.max(...pts.map(p=>p.value));
      gain=pts.map(p=>({az:p.az, gainDb:Math.min(0, p.value - maxVal)}));
    }
    return {ok, points:pts.length, unique_azimuths:uniqueAz.length, min_az:minAz, max_az:maxAz, has_zero:hasZero, has_360:has360, approx_full_360:approxFull, pattern: ok ? gain : null};
  }

  function parseAntPattern(text){
    return analyzeAntPatternText(text).pattern;
  }

  async function loadAntIndex(){
    const r=await fetch('data/ant/index.json?v='+Date.now(), {cache:'no-store'});
    if(!r.ok) throw new Error('Nie udało się pobrać data/ant/index.json: HTTP '+r.status);
    const j=await r.json();
    if(!j || !Array.isArray(j.items)) throw new Error('data/ant/index.json ma niepoprawny format.');
    return j;
  }

  function collectUsedAntPaths(){
    const used=new Map();
    for(const tx of state.txs){
      for(const mux of tx.muxes || []){
        if(!mux.ant_pattern_path) continue;
        const key=mux.ant_pattern_path;
        if(!used.has(key)) used.set(key, {path:key, count:0, examples:[]});
        const u=used.get(key);
        u.count += 1;
        if(u.examples.length < 3) u.examples.push(`${tx.short_name||tx.name} / ${mux.name||'MUX'}`);
      }
    }
    return used;
  }

  async function runAntDiagnostics(){
    const index=await loadAntIndex();
    const used=collectUsedAntPaths();
    const items=index.items || [];
    let withUrl=0, withoutUrl=0, fetched=0, missing=0, parsedOk=0, parsedBad=0, full360=0, partial=0;
    const bad=[];
    const missingList=[];
    const notUsed=[];
    const checked=[];
    const limit=items.length;
    toast('Sprawdzam pliki ANT...');
    openPanel('Sprawdzanie ANT', 'Trwa kontrola plików data/ant/*.ant.', '<div class="info-card"><strong>Pracuję</strong><span>Sprawdzam, które pliki ANT są naprawdę dostępne w tej paczce lub na stronie.</span></div>');
    for(const item of items){
      if(item.url) withUrl++; else withoutUrl++;
      const path=item.local_path;
      if(!path) continue;
      try{
        const r=await fetch(path+'?v='+Date.now(), {cache:'no-store'});
        if(!r.ok){ missing++; if(missingList.length < 30) missingList.push(path); continue; }
        const txt=await r.text();
        fetched++;
        const a=analyzeAntPatternText(txt);
        if(a.ok){ parsedOk++; if(a.approx_full_360) full360++; else partial++; }
        else { parsedBad++; if(bad.length < 30) bad.push(`${path} — punktów: ${a.points}`); }
        checked.push({path, ...a});
      }catch{
        missing++;
        if(missingList.length < 30) missingList.push(path);
      }
    }
    for(const item of items){
      if(item.local_path && !used.has(item.local_path) && notUsed.length < 20) notUsed.push(item.local_path);
    }
    const usedCount=used.size;
    const usedDownloaded=checked.filter(x=>used.has(x.path)).length;
    const usedOk=checked.filter(x=>used.has(x.path) && x.ok).length;
    const rfReady = usedOk > 0;
    openPanel('Raport ANT', 'Diagnostyka zakończona. To jest wynik końcowy sprawdzenia.', `
      <div class="info-card"><strong>Podsumowanie</strong><span>Indeks ANT: ${items.length} wpisów. Linki ANT: ${withUrl}. Bez linku: ${withoutUrl}. Lokalnie dostępne pliki: ${fetched}. Brakujące lokalnie: ${missing}.</span></div>
      <div class="info-card"><strong>Parser</strong><span>Poprawnie odczytane: ${parsedOk}. Błędny/nieznany format: ${parsedBad}. Pełny lub prawie pełny zakres 360°: ${full360}. Niepełny zakres: ${partial}.</span></div>
      <div class="info-card"><strong>Użycie w RF</strong><span>Ścieżki ANT używane przez nadajniki: ${usedCount}. Z tych ścieżek lokalnie dostępne: ${usedDownloaded}. Poprawnie parsowane i gotowe dla RF: ${usedOk}. Status: ${rfReady ? 'RF ma dostęp do charakterystyk ANT.' : 'RF nie ma jeszcze poprawnych lokalnych charakterystyk ANT.'}</span></div>
      <div class="info-card"><strong>Brakujące pliki — pierwsze 30</strong><span>${missingList.length ? esc(missingList.join('\n')) : 'Brak na sprawdzonej liście.'}</span></div>
      <div class="info-card"><strong>Błędne formaty — pierwsze 30</strong><span>${bad.length ? esc(bad.join('\n')) : 'Nie wykryto błędnych formatów w pobranych plikach.'}</span></div>
      <div class="info-card"><strong>Wniosek końcowy</strong><span>${rfReady ? 'Pliki ANT są dostępne i RF może z nich korzystać.' : 'Brakuje lokalnych plików ANT w tej uruchomionej wersji aplikacji. Uruchom python download_ant_patterns.py, a potem wgraj/skopiuj cały folder data/ant razem z aplikacją. Sama przeglądarka nie zapisze tych plików automatycznie na GitHubie.'}</span></div>
    `);
    toast('Diagnostyka ANT zakończona.');
  }

  async function loadAntPattern(mux){
    const path=mux?.ant_pattern_path;
    if(!path) return null;
    if(state.antPatterns.has(path)) return state.antPatterns.get(path);
    try{
      const r=await fetch(path, {cache:'force-cache'});
      if(!r.ok){ state.antPatterns.set(path, null); return null; }
      const txt=await r.text();
      const parsed=parseAntPattern(txt);
      state.antPatterns.set(path, parsed);
      return parsed;
    }catch{
      state.antPatterns.set(path, null);
      return null;
    }
  }

  function antennaGainDb(pattern, bearing){
    if(!pattern || pattern.length < 2) return 0;
    const b=normDeg(bearing);
    let prev=pattern[pattern.length-1], next=pattern[0];
    for(const p of pattern){
      if(p.az <= b) prev=p;
      if(p.az >= b){ next=p; break; }
    }
    let span=next.az-prev.az;
    let pos=b-prev.az;
    if(span <= 0) span += 360;
    if(pos < 0) pos += 360;
    const f=Math.max(0, Math.min(1, pos/span));
    return prev.gainDb + (next.gainDb-prev.gainDb)*f;
  }
  function rfColor(level){
    if(level >= -68) return '#16a34a';
    if(level >= -78) return '#84cc16';
    if(level >= -88) return '#f59e0b';
    if(level >= -98) return '#f97316';
    return '#dc2626';
  }
  function rfLabel(level){
    if(level >= -68) return 'bardzo dobry';
    if(level >= -78) return 'dobry';
    if(level >= -88) return 'średni';
    if(level >= -98) return 'słaby';
    return 'bardzo słaby';
  }

  function freeSpaceLossDb(freqMhz, distanceKm){
    const d=Math.max(0.05, distanceKm);
    return 32.44 + 20*Math.log10(Math.max(1, freqMhz)) + 20*Math.log10(d);
  }
  function knifeEdgeLossDb(v){
    if(v <= -0.78) return 0;
    return 6.9 + 20*Math.log10(Math.sqrt((v-0.1)*(v-0.1)+1) + v - 0.1);
  }
  function fresnelRadiusM(freqMhz, d1Km, d2Km){
    const lambda=300/Math.max(1, freqMhz);
    const d1=Math.max(1, d1Km*1000), d2=Math.max(1, d2Km*1000);
    return Math.sqrt(lambda*d1*d2/(d1+d2));
  }
  function terrainItmLossDb(ray, endIndex, freqMhz, txAltM, rxHeightM){
    const end=ray[endIndex];
    if(!end || end.km <= 0) return 0;
    const rxAltM=end.elev + rxHeightM;
    const totalKm=end.km;
    let worstV=-99;
    let worstMargin=999;
    for(let i=1;i<endIndex;i++){
      const p=ray[i];
      const f=p.km/totalKm;
      const los=txAltM + (rxAltM-txAltM)*f;
      const earthBulgeM=(p.km*(totalKm-p.km))/12.75;
      const f1=fresnelRadiusM(freqMhz, p.km, totalKm-p.km);
      const requiredClearance=0.6*f1;
      const obstacle=p.elev + earthBulgeM + requiredClearance;
      const margin=los-obstacle;
      if(margin<worstMargin) worstMargin=margin;
      if(margin<0){
        const lambda=300/Math.max(1, freqMhz);
        const h=-margin;
        const d1=Math.max(1,p.km*1000), d2=Math.max(1,(totalKm-p.km)*1000);
        const v=h*Math.sqrt(2*(d1+d2)/(lambda*d1*d2));
        if(v>worstV) worstV=v;
      }
    }
    const diffraction=worstV>-90 ? knifeEdgeLossDb(worstV) : 0;
    const clutter=totalKm>55 ? (totalKm-55)*0.10 : 0;
    const lowClearance=worstMargin<8 && worstMargin>=0 ? (8-worstMargin)*0.35 : 0;
    return Math.min(55, diffraction + clutter + lowClearance);
  }
  function buildItmRays(t, maxKm){
    const bearings=[]; for(let b=0;b<360;b+=10) bearings.push(b);
    const distances=[]; for(let d=2; d<=maxKm; d+=3) distances.push(d);
    return bearings.map(bearing=>({
      bearing,
      points: distances.map(km=>({bearing, km, ...destinationPoint(t.lat,t.lon,bearing,km)}))
    }));
  }
  async function calculateRfCoverage(){
    const t=state.selected; if(!t) return toast('Najpierw wybierz nadajnik.');
    if(state.rfBusy) return toast('Obliczanie zasięgu już trwa.');
    state.rfBusy=true;
    toast('Liczenie zasięgu ITM/terenowego z DEM i ANT...');
    try{
      const {freq, erpKw, mux, txHeight}=txMainParams(t);
      const antPattern=await loadAntPattern(mux);
      const maxKm=Math.max(18, Math.min(95, Math.sqrt(erpKw)*23 + txHeight*0.28));
      const txElevArr=await fetchElevations([{lat:t.lat,lon:t.lon}]);
      const txGround=Number.isFinite(+t.site_elevation_m) ? +t.site_elevation_m : txElevArr[0];
      const txAlt=txGround + txHeight;
      const erpDbm=60 + 10*Math.log10(Math.max(0.001, erpKw));
      const rays=buildItmRays(t, maxKm);
      const allPoints=[];
      for(const ray of rays) allPoints.push(...ray.points.map(p=>({lat:p.lat, lon:p.lon})));
      const elev=await fetchElevations(allPoints);
      let eidx=0;
      for(const ray of rays){
        for(const p of ray.points){ p.elev=+elev[eidx++]; }
      }
      const cells=[];
      for(const ray of rays){
        for(let i=0;i<ray.points.length;i++){
          const p=ray.points[i];
          const d=Math.max(0.2,p.km);
          const fspl=freeSpaceLossDb(freq, d);
          const itmLoss=terrainItmLossDb(ray.points, i, freq, txAlt, state.rxHeight);
          const antGain=antennaGainDb(antPattern, ray.bearing);
          const reliabilityMargin=d>40 ? (d-40)*0.08 : 0;
          const level=erpDbm + antGain - fspl - itmLoss - reliabilityMargin;
          const halfBearing=5, inner=Math.max(0.2,p.km-1.5), outer=p.km+1.5;
          const a=destinationPoint(t.lat,t.lon,ray.bearing-halfBearing,inner);
          const b=destinationPoint(t.lat,t.lon,ray.bearing+halfBearing,inner);
          const c=destinationPoint(t.lat,t.lon,ray.bearing+halfBearing,outer);
          const dpt=destinationPoint(t.lat,t.lon,ray.bearing-halfBearing,outer);
          cells.push({poly:[[a.lat,a.lon],[b.lat,b.lon],[c.lat,c.lon],[dpt.lat,dpt.lon]], level, km:p.km, bearing:ray.bearing, loss:itmLoss});
        }
      }
      clearRfLayer();
      state.rfLayer=L.layerGroup();
      for(const cell of cells){
        const color=rfColor(cell.level);
        L.polygon(cell.poly,{color, weight:.35, opacity:.30, fillColor:color, fillOpacity:.17, interactive:false}).addTo(state.rfLayer);
      }
      state.rfLayer.addTo(state.map);
      const bestReach=Math.max(0,...cells.filter(c=>c.level>=-88).map(c=>c.km));
      const blockedCells=cells.filter(c=>c.loss>6).length;
      const avgLoss=cells.length ? cells.reduce((a,c)=>a+c.loss,0)/cells.length : 0;
      state.lastRf={tx:t.id, freq, erpKw, bestReach, antPattern:!!antPattern, model:'ITM-lite terrain diffraction'};
      toast(`Narysowano zasięg ITM/terenowy: ${Math.round(bestReach)} km dla ${mux.name||'MUX'}.`);
      openPanel('Obliczony zasięg ITM / terenowy', `${t.short_name||t.name}`, `<div class="info-card"><strong>Wynik</strong><span>Najdalszy punkt z poziomem co najmniej średnim: około ${Math.round(bestReach)} km. Częstotliwość: ${Math.round(freq)} MHz, ERP: ${erpKw} kW, wysokość anteny: ${txHeight} m n.p.t. Charakterystyka ANT: ${antPattern ? 'użyta' : 'brak lokalnego pliku — pominięta'}.</span></div><div class="info-card"><strong>Model 19.10</strong><span>Pierwszy model terenowy typu ITM/Longley-Rice: FSPL + profil promieniowy DEM + krzywizna Ziemi + 60% pierwszej strefy Fresnela + strata dyfrakcyjna knife-edge dla przeszkód + korekta ANT. To nadal nie jest pełny Radio Mobile, ale jest wyraźnie bliższe propagacji terenowej niż sam okrąg/sektor.</span></div><div class="info-card"><strong>Diagnostyka</strong><span>Komórek z istotną stratą terenową: ${blockedCells}/${cells.length}. Średnia dodatkowa strata terenowa: ${avgLoss.toFixed(1)} dB. DEM: lokalny cache przeglądarki z fallbackiem do Open-Meteo.</span></div><div class="legend-rf"><span><i class="rf-good"></i>bardzo/dobry</span><span><i class="rf-mid"></i>średni</span><span><i class="rf-weak"></i>słaby</span><span><i class="rf-bad"></i>bardzo słaby</span></div>`);
    }finally{
      state.rfBusy=false;
    }
  }

  async function showProfile(){
    const t=state.selected; if(!t) return toast('Najpierw wybierz nadajnik.');
    openPanel('Profil terenu', `${state.rx.label} → ${t.short_name||t.name}`, `<div class="row info-card"><strong>Wysokość anteny odbiorczej</strong><input id="rxHeight" type="number" min="1" max="40" value="${state.rxHeight}"></div><button id="profileDownloadDem" class="panel-btn primary" type="button">Pobierz DEM i odśwież profil</button><div id="profileBox" class="info-card"><strong>Ładuję profil terenu...</strong><span>Najpierw używam lokalnego DEM. Przy braku odpowiedzi API profil zostanie narysowany w trybie awaryjnym, z wyraźnym ostrzeżeniem.</span></div>`);
    $('rxHeight').onchange=e=>{state.rxHeight=Math.max(1,Math.min(40,+e.target.value||6)); save(); showProfile();};
    $('profileDownloadDem').onclick=async()=>{ await downloadDemForSelectedTx(); showProfile(); };
    try{ const p=await fetchProfile(state.rx,t); renderProfile(p,t); }catch(err){ $('profileBox').innerHTML=`<strong>Profil nie został wczytany</strong><span>${esc(err.message||'Nie udało się pobrać danych wysokości.')} Kliknij „Pobierz DEM i odśwież profil” albo spróbuj później, jeśli API wysokości jest limitowane.</span>`; }
  }
  function profileRouteKey(a,t){
    return `profile-v2:${a.lat.toFixed(5)},${a.lon.toFixed(5)}:${t.lat.toFixed(5)},${t.lon.toFixed(5)}:${Math.round(+t.site_elevation_m||0)}:${Math.round(+t.height||0)}`;
  }
  function loadProfileCache(){
    try{ return JSON.parse(localStorage.getItem('dvbt-profile-dem-cache-v2')||'{}') || {}; }
    catch{ return {}; }
  }
  function saveProfileCache(cache){
    try{ localStorage.setItem('dvbt-profile-dem-cache-v2', JSON.stringify(cache)); }catch{}
  }

  async function showProfile(){
    const t=state.selected; if(!t) return toast('Najpierw wybierz nadajnik.');
    openPanel('Profil terenu', `${state.rx.label} → ${t.short_name||t.name}`, `<div class="row info-card"><strong>Wysokość anteny odbiorczej</strong><input id="rxHeight" type="number" min="1" max="40" value="${state.rxHeight}"></div><button id="profileDownloadDem" class="panel-btn primary" type="button">Pobierz DEM i odśwież profil</button><div id="profileBox" class="info-card"><strong>Ładuję prawdziwy profil DEM...</strong><span>Pobieram prawdziwe próbki DEM z kafli wysokości. Dopiero gdy kafle nie zadziałają, użyję zapasowego API punktowego.</span></div>`);
    $('rxHeight').onchange=e=>{state.rxHeight=Math.max(1,Math.min(40,+e.target.value||6)); save(); showProfile();};
    $('profileDownloadDem').onclick=async()=>{ await fetchProfile(state.rx,t,true).then(p=>renderProfile(p,t)).catch(err=>renderProfileError(err)); };
    try{ const p=await fetchProfile(state.rx,t,false); renderProfile(p,t); }catch(err){ renderProfileError(err); }
  }

  function renderProfileError(err){
    $('profileBox').innerHTML=`<div class="profile-error"><strong>Nie mam prawdziwych danych DEM dla tej trasy.</strong><span>${esc(err.message||'API wysokości nie odpowiedziało.')}</span><span>Nie rysuję fałszywego profilu prostą linią. Kliknij „Pobierz DEM i odśwież profil” albo spróbuj później, gdy API wysokości przestanie zwracać limit.</span></div>`;
  }

  async function fetchProfile(a,t,force=false){
    if(profileAbort) profileAbort.abort(); profileAbort=new AbortController();
    const n=128, points=[];
    const totalDistance = Math.max(0.1, Number.isFinite(+t.distance) ? +t.distance : dist(a,t));
    for(let i=0;i<n;i++){
      const f=i/(n-1);
      points.push({lat:a.lat+(t.lat-a.lat)*f, lon:a.lon+(t.lon-a.lon)*f});
    }
    const routeKey=profileRouteKey(a,t);
    const profileCache=loadProfileCache();
    if(!force && profileCache[routeKey] && Array.isArray(profileCache[routeKey].elev) && profileCache[routeKey].elev.length===n){
      const cached=profileCache[routeKey].elev.map((e,i)=>({d:totalDistance*i/(n-1), e:+e}));
      cached.meta={source:'profile-cache', samples:n};
      return cached;
    }
    let elev=null, apiError='';
    let source='terrarium-tiles';
    try{
      // Najpierw prawdziwy DEM z kafli Terrarium. To omija limit 429 punktowego API Open-Meteo.
      elev=await fetchElevationsFromTerrarium(points);
    }catch(tileErr){
      apiError='Kafle DEM: '+(tileErr.message || String(tileErr));
      try{
        source='api-live';
        elev=await fetchElevationsFromApi(points, 'Nie udało się pobrać profilu DEM.', {retries:1, timeoutMs:9000, chunkSize:64, pauseMs:0});
      }catch(apiErr){
        apiError += '; API punktowe: '+(apiErr.message || String(apiErr));
      }
    }
    if(!Array.isArray(elev) || elev.length!==n || !elev.every(v=>Number.isFinite(+v))){
      if(profileCache[routeKey] && Array.isArray(profileCache[routeKey].elev)){
        const cached=profileCache[routeKey].elev.map((e,i)=>({d:totalDistance*i/(profileCache[routeKey].elev.length-1), e:+e}));
        cached.meta={source:'profile-cache-stale', samples:cached.length, apiError};
        return cached;
      }
      throw new Error(`Nie udało się pobrać prawdziwego DEM dla trasy. ${apiError}`);
    }
    profileCache[routeKey]={ts:Date.now(), elev:elev.map(v=>Math.round(+v*10)/10)};
    saveProfileCache(profileCache);
    const result=elev.map((e,i)=>({d:totalDistance*i/(n-1), e:+e}));
    result.meta={source:source, samples:n};
    return result;
  }

  function renderProfile(p,t){
    const rxGround = p[0].e;
    const txGroundDem = p[p.length-1].e;
    const txGround = Number.isFinite(+t.site_elevation_m) ? +t.site_elevation_m : txGroundDem;
    const txGroundSource = Number.isFinite(+t.site_elevation_m) ? 'wysokość obiektu z bazy' : 'wysokość z DEM';
    const txHeight = +t.height || 60;
    const rxAlt = rxGround + state.rxHeight;
    const txAlt = txGround + txHeight;
    const totalDistance = Math.max(0.1, Number.isFinite(+t.distance) ? +t.distance : dist(state.rx,t));
    const terrain=p.map(x=>x.e);
    const minTerrain=Math.min(...terrain, rxAlt, txAlt);
    const maxTerrain=Math.max(...terrain, rxAlt, txAlt);
    const span=Math.max(40, maxTerrain-minTerrain);
    const min=Math.floor((minTerrain-span*.18)/10)*10;
    const max=Math.ceil((maxTerrain+span*.20)/10)*10;
    const W=680,H=350,padL=54,padR=28,padT=42,padB=54;
    const x=d=>padL+(W-padL-padR)*(d/totalDistance);
    const y=e=>H-padB-(H-padT-padB)*((e-min)/(max-min));
    const path=p.map((pt,i)=>`${i?'L':'M'}${x(pt.d).toFixed(1)},${y(pt.e).toFixed(1)}`).join(' ');
    const area=`M${padL},${H-padB} ${path} L${W-padR},${H-padB} Z`;
    const losY=d=>y(rxAlt+(txAlt-rxAlt)*(d/totalDistance));
    const losPath=`M${padL},${y(rxAlt).toFixed(1)} L${W-padR},${y(txAlt).toFixed(1)}`;
    let worst=999, worstD=0, blocked=false;
    const blockedRects=[];
    for(let i=0;i<p.length;i++){
      const pt=p[i];
      const los=rxAlt+(txAlt-rxAlt)*(pt.d/totalDistance);
      const margin=los-pt.e;
      if(margin<worst){worst=margin; worstD=pt.d;}
      if(margin<0){
        blocked=true;
        const w=(W-padL-padR)/(p.length-1)+1;
        blockedRects.push(`<rect x="${(x(pt.d)-w/2).toFixed(1)}" y="${padT}" width="${w.toFixed(1)}" height="${(H-padT-padB)}" fill="rgba(239,68,68,.18)"/>`);
      }
    }
    const ticks=[];
    const tickCount=5;
    for(let i=0;i<=tickCount;i++){
      const val=min+(max-min)*i/tickCount;
      const yy=y(val);
      ticks.push(`<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W-padR}" y2="${yy.toFixed(1)}" stroke="#e5e7eb"/><text x="${padL-10}" y="${(yy+4).toFixed(1)}" text-anchor="end" font-size="12" fill="#475569">${Math.round(val)}</text>`);
    }
    const dTicks=[];
    for(let i=0;i<=4;i++){
      const d=totalDistance*i/4;
      const xx=x(d);
      dTicks.push(`<line x1="${xx.toFixed(1)}" y1="${H-padB}" x2="${xx.toFixed(1)}" y2="${H-padB+5}" stroke="#94a3b8"/><text x="${xx.toFixed(1)}" y="${H-18}" text-anchor="middle" font-size="12" fill="#475569">${i===0?'0':d.toFixed(1)} km</text>`);
    }
    const msg=blocked?'Widoczność: NIE':worst<10?'Widoczność: warunkowa':'Widoczność: TAK';
    const noteClass=blocked?'profile-note bad':worst<10?'profile-note warn':'profile-note ok';
    const meta=p.meta||{};
    const sourceText = meta.source === 'terrarium-tiles' ? `DEM: pobrano ${meta.samples||p.length} próbek z kafli wysokości Terrarium.` : (meta.source === 'api-live' ? `DEM: pobrano ${meta.samples||p.length} próbek wysokości z API punktowego.` : `DEM: lokalny cache profilu (${meta.samples||p.length} próbek). ${meta.apiError ? 'Odświeżenie nieudane: '+esc(meta.apiError) : ''}`);
    const minElev=Math.round(Math.min(...terrain));
    const maxElev=Math.round(Math.max(...terrain));
    const diffElev=Math.round(txAlt-rxAlt);
    $('profileBox').innerHTML=`
      <div class="profile-chart-card">
        <div class="profile-head-values"><div><strong>Dom +${state.rxHeight} m</strong><span>${Math.round(rxGround)} m n.p.m.</span></div><div><strong>Nadajnik +${txHeight} m</strong><span>${Math.round(txGround)} m n.p.m.</span></div></div>
        <svg class="profile-svg pro" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Profil terenu">
          ${blockedRects.join('')}
          ${ticks.join('')}
          ${dTicks.join('')}
          <text x="18" y="${H/2}" transform="rotate(-90 18 ${H/2})" text-anchor="middle" font-size="12" fill="#475569">m n.p.m.</text>
          <path d="${area}" fill="rgba(34,197,94,.18)"/>
          <path d="${path}" fill="none" stroke="#16a34a" stroke-width="3" vector-effect="non-scaling-stroke"/>
          <path d="${losPath}" fill="none" stroke="#64748b" stroke-width="2" stroke-dasharray="8 8" vector-effect="non-scaling-stroke"/>
          <circle cx="${padL}" cy="${y(rxAlt)}" r="6" fill="#2563eb"/>
          <circle cx="${W-padR}" cy="${y(txAlt)}" r="6" fill="#16a34a"/>
        </svg>
        <div class="profile-legend"><span><i class="terrain"></i>Profil terenu</span><span><i class="los"></i>Linia LOS</span><span><i class="blocked"></i>Strefa zasłonięta</span></div>
      </div>
      <div class="${noteClass}"><strong>${msg}</strong><span>Najmniejszy zapas: ${worst.toFixed(1)} m, w odległości ${worstD.toFixed(1)} km od punktu odbioru.</span></div>
      <div class="profile-stats"><div><span>Długość trasy</span><strong>${totalDistance.toFixed(1)} km</strong></div><div><span>Różnica wysokości anten</span><strong>${diffElev>0?'+':''}${diffElev} m</strong></div><div><span>Minimalna wysokość</span><strong>${minElev} m</strong></div><div><span>Maksymalna wysokość</span><strong>${maxElev} m</strong></div></div>
      <div class="profile-meta">${sourceText} Wysokość nadajnika: ${txGroundSource}. Dane DEM są zewnętrzne i mogą mieć ograniczoną dokładność lokalną.</div>`;
  }

  function updateCompass(){
    const t=state.selected; const target=t?Math.round(t.azimuth):0;
    $('targetNeedle').style.transform=`translate(-50%,-100%) rotate(${target}deg)`;
    if(state.heading!=null) $('phoneNeedle').style.transform=`translate(-50%,-100%) rotate(${state.heading}deg)`;
    let txt=state.compassOn?'Czekam na czujnik':'Czujnik automatyczny';
    let cls='';
    if(state.heading!=null && t){
      const d=diff(state.heading,target);
      const a=Math.abs(Math.round(d));
      if(a<=5){ txt='Kierunek prawidłowy'; cls='ok'; }
      else { txt=`Obróć ${a}° w ${d>0?'prawo':'lewo'}`; cls='turn'; }
    }
    $('turnText').textContent=txt;
    $('turnText').className=cls;
    $('headingText').textContent=`Tel: ${state.heading==null?'—':Math.round(state.heading)+'°'} · Cel: ${t?target+'°':'—'} · ${state.compassOn && state.headingSource==='brak' ? 'czujnik' : state.headingSource}`;
    renderHeadingCone();
  }
  async function startCompass(silent=false){
    if(state.compassOn) return true;
    if(window.DeviceOrientationEvent?.requestPermission){
      try{ const p=await DeviceOrientationEvent.requestPermission(); if(p!=='granted'){ if(!silent) toast('Brak zgody na kompas.'); return false; } }catch{ if(!silent) toast('Przeglądarka nie udostępniła kompasu.'); return false; }
    }
    state.compassOn = true;
    window.addEventListener('deviceorientationabsolute', onOrientation, true);
    window.addEventListener('deviceorientation', onOrientation, true);
    state.headingSource = state.headingSource==='brak' ? 'czujnik aktywny' : state.headingSource;
    if(!silent) toast('Czujnik kierunku aktywny. Porusz telefonem ósemką, jeśli wskazanie pływa.');
    updateCompass();
    return true;
  }
  function onOrientation(e){
    if(typeof e.webkitCompassHeading==='number'){ applyHeading(e.webkitCompassHeading, 'ios'); return; }
    if(typeof e.alpha==='number'){ applyHeading(e.alpha, e.absolute ? 'absolute' : 'sensor'); }
  }
  function startGpsWatch(){
    if(!navigator.geolocation) return toast('Brak GPS w tej przeglądarce.');
    if(state.gpsWatchId!=null) navigator.geolocation.clearWatch(state.gpsWatchId);
    state.gpsWatchId = navigator.geolocation.watchPosition(p=>{
      const {latitude, longitude, heading} = p.coords;
      state.rx={lat:latitude, lon:longitude, label:'GPS / punkt odbioru'};
      if(Number.isFinite(heading) && heading >= 0 && state.headingSource !== 'ios' && state.headingSource !== 'absolute' && state.headingSource !== 'sensor') applyHeading(heading, 'gps');
      save(); renderHome(); renderConnection(); selectTx(state.selected?.id || bestTx()?.id,false,false); state.map.panTo([latitude,longitude], {animate:true});
    },()=>toast('Nie udało się pobrać GPS.'),{enableHighAccuracy:true, timeout:12000, maximumAge:2500});
  }
  function showCompassPanel(){
    const t=state.selected; const target=t?Math.round(t.azimuth):'—';
    openPanel('Kompas anteny','Stożek na mapie pokazuje kierunek telefonu w punkcie odbioru.', `
      <div class="compass-panel-head">
        <div class="big-compass"><i class="target" style="transform:translate(-50%,-100%) rotate(${t?Math.round(t.azimuth):0}deg)"></i><i class="phone" style="transform:translate(-50%,-100%) rotate(${state.heading||0}deg)"></i><b>N</b></div>
        <div><strong>${esc($('turnText').textContent)}</strong><span>Telefon: ${state.heading==null?'—':Math.round(state.heading)+'°'} · Cel: ${target}°</span><small>Źródło: ${esc(state.headingSource)}</small></div>
      </div>
      <div class="info-card"><strong>Czujnik kierunku</strong><span>Czujnik jest uruchamiany automatycznie. Jeżeli przeglądarka wymaga zgody, dotknij tego panelu lub widgetu kompasu i zaakceptuj dostęp.</span></div>
      <div class="info-card"><strong>Ręczna korekta awaryjna: <span id="manualHeadingValue">${Math.round(state.heading||0)}°</span></strong><input id="manualHeading" type="range" min="0" max="359" value="${Math.round(state.heading||0)}"></div>
      <div class="panel-grid-2">
        <button id="invertCompassBtn" class="panel-btn">Odwróć czujnik</button>
        <button id="resetCompassBtn" class="panel-btn">Reset korekty</button>
      </div>
      <div class="info-card"><strong>Uwaga</strong><span>Włączyłem mocne wygładzanie, więc wskazanie powinno skakać mniej. Kompas telefonu nadal może przekłamywać przy maszcie, antenie, blasze, aucie i magnesach. Skalibruj telefon ruchem ósemki.</span></div>`);
    startCompass(true);
    $('manualHeading').oninput=e=>{ $('manualHeadingValue').textContent=`${e.target.value}°`; setManualHeading(e.target.value); };
    $('invertCompassBtn').onclick=()=>{ state.headingInvert=!state.headingInvert; save(); toast(state.headingInvert?'Odwrócono kierunek czujnika.':'Przywrócono standardowy kierunek czujnika.'); };
    $('resetCompassBtn').onclick=()=>{ state.headingOffset=0; state.headingInvert=false; save(); updateCompass(); toast('Zresetowano korektę kompasu.'); };
  }

  function setRx(lat,lon,label,pan,preserveSelected=true){
    const keepId = preserveSelected && state.selected?.id ? state.selected.id : null;
    state.rx={lat,lon,label};
    save();
    renderHome();
    renderConnection();
    selectTx(keepId || bestTx()?.id,false,true);
    if(pan) state.map.setView([lat,lon],12);
  }
  async function search(e){ e.preventDefault(); const q=$('searchInput').value.trim(); if(!q) return; try{ const r=await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=pl&q=${encodeURIComponent(q)}`); const j=await r.json(); if(!j[0]) return toast('Nie znaleziono miejsca.'); setRx(+j[0].lat,+j[0].lon,j[0].display_name.split(',').slice(0,2).join(', '),true); }catch{toast('Wyszukiwanie wymaga internetu.');} }

  function bind(){
    setDisplayedVersion();
    $('searchForm').onsubmit=search; $('locateBtn').onclick=startGpsWatch;
    const locationChipBtn = $('locationChip'); if(locationChipBtn) locationChipBtn.onclick=()=>state.map.setView([state.rx.lat,state.rx.lon],12); $('txListBtn').onclick=showTxList; $('profileBtn').onclick=showProfile; $('layersBtn').onclick=showLayers; $('dataBtn').onclick=showData; const aboutBtn=$('aboutBtn'); if(aboutBtn) aboutBtn.onclick=showAbout; $('closePanelBtn').onclick=closePanel;
    $('closeStationBtn').onclick=hideStation; $('openStationBtn').onclick=showStation; $('antennaBtn').onclick=()=>{startCompass(false); showCompassPanel();}; $('compassWidget').onclick=()=>{startCompass(false); showCompassPanel();}; $('stationProfileBtn').onclick=showProfile; $('stationMuxBtn').onclick=showMux; $('stationDemBtn').onclick=downloadDemForSelectedTx;
    window.addEventListener('online',()=>{$('onlineChip').textContent='Online';$('onlineChip').classList.add('online-chip');}); window.addEventListener('offline',()=>{$('onlineChip').textContent='Offline';$('onlineChip').classList.remove('online-chip');});
  }
  async function boot(){ load(); bind(); initMap(); await loadTxs(); if(state.coverageTileUrl) applyCoverageTile(state.coverageTileUrl); startCompass(true); window.addEventListener('pointerdown',()=>startCompass(true),{once:true,passive:true}); if('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js?v=19.15-1705262135').catch(()=>{}); setAppHeight(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
