(() => {
  'use strict';
  const APP_VERSION = '19.27 - 1905260750';
  const STORE = 'dvbt-point-v19-state';
  const ANT_CACHE_NAME = 'dvbt-ant-files-v1';
  const RF_ALGO_VERSION = '19.27-dense-quick-idb-v2';
  const RF_DB_NAME = 'dvbt-point-rf-cache-v1';
  const RF_DB_STORE = 'coverages';
  const RF_BEARING_STEP_DEG = 1;
  const RF_QUICK_BEARING_STEP_DEG = 5;
  // POPRAWKA KRYTYCZNA 19.27 — NIE ZMIENIAĆ BEZ TESTU ZASIĘGU W TERENIE:
  // Szybkie liczenie ma zostawić pełny podgląd orientacyjny, ale bardzo gęsto przeliczać obszar 500 m wokół punktu odbioru.
  const RF_QUICK_LOCAL_RADIUS_KM = 0.5;
  const RF_QUICK_LOCAL_GRID_STEP_KM = 0.05;
  const RF_QUICK_PROFILE_STEP_KM = 0.08;
  const $ = id => document.getElementById(id);
  const state = {
    map:null, baseLayer:null, baseLabelsLayer:null, base:'osm', rx:{lat:50.2871, lon:21.4238, label:'Mielec / punkt odbioru'}, rxHeight:6,
    txs:[], selected:null, markers:L.layerGroup(), line:null, range:null, homeMarker:null, headingCone:null,
    heading:null, rawHeading:null, pendingHeading:null, headingSource:'brak', headingInvert:false, headingOffset:0, compassOn:false, gpsWatchId:null, headingRaf:null, headingSamples:[], headingLastTs:0, coverageLayer:null, rfLayer:null, coverageTileUrl:'', showCoverageOnly:false, rfBusy:false, lastRf:null, antPatterns:new Map(), demCache:null, demBusy:false
  };
  let profileAbort = null;
  let deferredInstallPrompt = null;
  let pendingRfModeResolve = null;
  function withTimeoutSignal(ms){
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return {signal: ctrl.signal, clear: () => clearTimeout(timer)};
  }

  function normDeg(v){ return ((v % 360) + 360) % 360; }
  function smoothHeading(prev, next, strength=.42){
    if(prev==null) return normDeg(next);
    const delta=((next-prev+540)%360)-180;
    return normDeg(prev + delta*strength);
  }
  function adaptiveHeadingStrength(prev, next){
    if(prev==null) return 1;
    const jump = Math.abs(diff(prev, next));
    if(jump >= 45) return .85;
    if(jump >= 15) return .58;
    return .38;
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
      if(now - state.headingLastTs < 30){ scheduleHeadingApply(); return; }
      state.headingLastTs = now;
      const mean = circularMeanDeg(state.headingSamples.slice(-3));
      if(mean == null) return;
      if(state.heading != null){
        const jump = Math.abs(diff(state.heading, mean));
        if(jump < .45) return;
      }
      state.heading = smoothHeading(state.heading, mean, adaptiveHeadingStrength(state.heading, mean));
      updateCompass();
    });
  }
  function applyHeading(raw, source='sensor'){
    if(!Number.isFinite(raw)) return;
    let h = raw;
    // POPRAWKA KRYTYCZNA 19.24 — NIE ZMIENIAĆ BEZ TESTU W TERENIE:
    // GPS podaje kurs ruchu już w stopniach od północy, dlatego nie wolno go odwracać jak alpha z czujnika.
    if(source !== 'ios' && source !== 'gps') h = state.headingInvert ? raw : (360 - raw);
    h = normDeg(h + (state.headingOffset || 0));
    state.rawHeading = raw;
    state.headingSource = source;
    state.headingSamples.push(h);
    if(state.headingSamples.length > 6) state.headingSamples.shift();
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

  function save(){ localStorage.setItem(STORE, JSON.stringify({rx:state.rx, rxHeight:state.rxHeight, base:state.base, selectedId:state.selected?.id || null, headingInvert:state.headingInvert, headingOffset:state.headingOffset, coverageTileUrl:state.coverageTileUrl||'', showCoverageOnly:!!state.showCoverageOnly})); }
  function load(){ try{ const s=JSON.parse(localStorage.getItem(STORE)||'{}'); Object.assign(state, {rx:s.rx||state.rx, rxHeight:s.rxHeight||state.rxHeight, base:s.base||state.base, headingInvert:!!s.headingInvert, headingOffset:+s.headingOffset||0, coverageTileUrl:s.coverageTileUrl||'', showCoverageOnly:!!s.showCoverageOnly}); state._selectedId=s.selectedId; }catch{} }
  function toast(msg){ const t=$('toast'); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true,2600); }
  function setDisplayedVersion(){
    document.title = `DVB-T/T2 Point ${APP_VERSION}`;
    ['versionFloating'].forEach(id => {
      const el = $(id);
      if(el) el.textContent = APP_VERSION;
    });
  }

  function isInstalledPwa(){
    return window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
  }
  function updateInstallButtons(){
    const available = !!deferredInstallPrompt && !isInstalledPwa();
    const topBtn = $('installBtn');
    if(topBtn){
      topBtn.hidden = !available;
      topBtn.disabled = !available;
      topBtn.textContent = 'Zainstaluj aplikację';
    }
    const settingsCard = $('settingsInstallCard');
    if(settingsCard) settingsCard.hidden = !available;
    const settingsBtn = $('settingsInstallBtn');
    if(settingsBtn){
      settingsBtn.hidden = !available;
      settingsBtn.disabled = !available;
      settingsBtn.textContent = 'Zainstaluj aplikację';
    }
  }
  async function installApp(){
    if(isInstalledPwa()){
      toast('Aplikacja jest już zainstalowana.');
      updateInstallButtons();
      return;
    }
    if(!deferredInstallPrompt){
      toast('Instalacja nie jest teraz dostępna w tej chwili.');
      return;
    }
    const promptEvent=deferredInstallPrompt;
    deferredInstallPrompt=null;
    promptEvent.prompt();
    try{ await promptEvent.userChoice; }catch{}
    updateInstallButtons();
  }
  function setupPwaInstall(){
    updateInstallButtons();
    window.addEventListener('beforeinstallprompt', e=>{
      e.preventDefault();
      deferredInstallPrompt=e;
      updateInstallButtons();
    });
    window.addEventListener('appinstalled', ()=>{
      deferredInstallPrompt=null;
      updateInstallButtons();
      toast('Aplikacja została zainstalowana.');
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

  function cleanLocationLabel(value){
    return String(value || '').replace(/[()]/g,'').replace(/\s*\/\s*/g,' / ').replace(/\s+/g,' ').trim();
  }
  function stationDisplayName(t){
    if(!t) return '—';
    const loc = cleanLocationLabel(t.location);
    const site = String(t.site || t.short_name || t.name || '').trim();
    if(loc && site && !loc.toLowerCase().includes(site.toLowerCase())) return `${loc} — ${site}`;
    return loc || site || '—';
  }
  function stationSubtitleName(t){
    if(!t) return '—';
    const raw = String(t.name || '').trim();
    if(raw) return raw;
    return stationDisplayName(t);
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
    if(state.baseLabelsLayer) state.map.removeLayer(state.baseLabelsLayer);
    const common={maxZoom:19, updateWhenIdle:true, updateWhenZooming:false, keepBuffer:3, crossOrigin:true, detectRetina:false};
    if(state.base==='sat'){
      state.baseLayer=L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {...common, attribution:'Imagery &copy; Esri'});
      state.baseLabelsLayer=L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {...common, attribution:'Nazwy miejscowości &copy; Esri', pane:'tilePane', opacity:.95});
    }else if(state.base==='light'){
      state.baseLayer=L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {...common, subdomains:'abcd', attribution:'&copy; OpenStreetMap &copy; CARTO'});
    }else if(state.base==='topo'){
      state.baseLayer=L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {...common, subdomains:'abc', attribution:'Map data: &copy; OpenStreetMap, SRTM | Style: &copy; OpenTopoMap'});
    }else if(state.base==='hot'){
      state.baseLayer=L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {...common, subdomains:'abc', attribution:'&copy; OpenStreetMap, styl HOT'});
    }else if(state.base==='street'){
      state.baseLayer=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {...common, attribution:'Tiles &copy; Esri'});
    }else{
      state.baseLayer=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {...common, attribution:'&copy; OpenStreetMap'});
    }
    state.baseLayer.addTo(state.map);
    if(state.baseLabelsLayer) state.baseLabelsLayer.addTo(state.map);
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
  function sortedTxs(){ return state.txs.map(t=>({...t, distance:dist(state.rx,t), azimuth:az(state.rx,t)})).sort((a,b)=>a.distance-b.distance); }
  function estimatedCoverageRadiusKm(t){
    const maxErp=Math.max(1,...(t?.muxes||[]).map(m=>+m.erp_kw||1));
    return Math.min(90, Math.max(25, Math.sqrt(maxErp)*8.5));
  }
  function isTxInEstimatedCoverage(t){
    if(!t) return false;
    const d=Number.isFinite(t.distance) ? t.distance : dist(state.rx,t);
    return d <= estimatedCoverageRadiusKm(t);
  }
  function passesFilter(t){ return !state.showCoverageOnly || isTxInEstimatedCoverage(t); }
  function visibleTxs(){ return sortedTxs().filter(passesFilter); }
  function bestTx(){ return visibleTxs()[0] || null; }
  function txById(id){ return visibleTxs().find(t=>t.id===id); }
  function normSearchText(value){
    return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ł/g,'l').replace(/[^a-z0-9]+/g,' ').trim();
  }
  function txSearchText(t){
    return normSearchText([
      stationDisplayName(t), stationSubtitleName(t), t.name, t.short_name, t.location, t.site, t.id,
      ...(t.muxes||[]).flatMap(m=>[m.name, m.channel, m.band, m.operator, m.frequency_mhz])
    ].filter(Boolean).join(' '));
  }
  function applyCoverageOnlyFilter(){
    renderTxMarkers();
    if(state.selected && passesFilter(state.selected)){
      renderConnection();
      updateStationCard();
      return true;
    }
    const next=bestTx();
    if(next){
      selectTx(next.id,false,false);
      showStation();
      return true;
    }
    state.selected=null;
    renderConnection();
    hideStation();
    return false;
  }

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
    if(state.heading == null){
      if(state.headingCone){ state.map.removeLayer(state.headingCone); state.headingCone=null; }
      return;
    }
    const rotation = Math.round(state.heading);
    if(state.headingCone){
      state.headingCone.setLatLng([state.rx.lat,state.rx.lon]);
      const el = state.headingCone.getElement()?.querySelector('.heading-cone');
      if(el){ el.style.transform = `rotate(${rotation}deg)`; return; }
      state.map.removeLayer(state.headingCone);
      state.headingCone=null;
    }
    const coneHtml = `<div class="heading-cone" style="transform:rotate(${rotation}deg)"><svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 50 L30 2 Q50 -7 70 2 Z"/><circle cx="50" cy="50" r="4"/></svg></div>`;
    const coneIcon=L.divIcon({html:coneHtml, className:'', iconSize:[110,110], iconAnchor:[55,55]});
    state.headingCone=L.marker([state.rx.lat,state.rx.lon], {icon:coneIcon, interactive:false, pane:'headingPane', zIndexOffset:1200}).addTo(state.map);
  }
  function renderTxMarkers(){
    state.markers.clearLayers();
    for(const t of sortedTxs().filter(passesFilter)){
      const selected=state.selected?.id===t.id;
      const icon=L.divIcon({html:`<div class="tx-marker ${selected?'selected':''}">📡</div>`, className:'', iconSize:[30,30], iconAnchor:[15,15]});
      L.marker([t.lat,t.lon], {icon, title:stationDisplayName(t)}).on('click', e=>{e.originalEvent?.stopPropagation?.(); selectTx(t.id,true,true);}).addTo(state.markers);
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
    const t=state.selected; if(!t || !passesFilter(t)) return;
    state.line=L.polyline([[state.rx.lat,state.rx.lon],[t.lat,t.lon]], {color:'#2563eb', weight:3, opacity:.82}).addTo(state.map);
    const maxErp=Math.max(1,...t.muxes.map(m=>+m.erp_kw||1));
    const radius=Math.min(90000, Math.max(25000, Math.sqrt(maxErp)*8500));
    state.range=L.circle([t.lat,t.lon], {radius, color:'#f97316', weight:4, opacity:.96, fillColor:'#fb923c', fillOpacity:.18, dashArray:'12 8'}).addTo(state.map);
  }
  function showStation(){ $('stationCard').hidden=false; $('openStationBtn').hidden=true; setTimeout(()=>state.map.invalidateSize(true),80); }
  function hideStation(){ $('stationCard').hidden=true; $('openStationBtn').hidden=false; setTimeout(()=>state.map.invalidateSize(true),80); }
  function updateStationCard(){
    const t=state.selected; if(!t) return;
    $('stationName').textContent=stationDisplayName(t);
    $('stationAzimuth').textContent=`${Math.round(t.azimuth)}°`;
    $('stationDistance').textContent=fmtKm(t.distance);
    $('stationPol').textContent=pols(t);
    $('stationPower').textContent=stationPowerText(t);
  }

  function openPanel(title, subtitle, html){ $('panelTitle').textContent=title; $('panelSubtitle').textContent=subtitle||''; $('panelContent').innerHTML=html; $('appPanel').classList.remove('collapsed'); setTimeout(()=>state.map.invalidateSize(true),80); }
  function closePanel(){
    $('appPanel').classList.add('collapsed');
    if(pendingRfModeResolve){
      const resolve=pendingRfModeResolve;
      pendingRfModeResolve=null;
      resolve(null);
    }
  }
  function showTxList(){
    const filterNote = state.showCoverageOnly ? '<div class="info-card compact-note"><strong>Aktywny filtr</strong><span>Pokazywane są tylko nadajniki w szacowanym zasięgu punktu odbioru.</span></div>' : '';
    openPanel('Nadajniki','Lista według odległości od punktu odbioru.', `
      <div class="tx-search-card">
        <input id="txSearchInput" type="search" placeholder="Szukaj nadajnika, miasta albo obiektu" autocomplete="off">
      </div>
      ${filterNote}
      <div id="txListResults" class="tx-list-results"></div>
    `);
    const input=$('txSearchInput');
    const results=$('txListResults');
    const renderList=(query='')=>{
      const q=normSearchText(query);
      const base=visibleTxs();
      const items=base.filter(t=>!q || txSearchText(t).includes(q));
      if(!items.length){
        results.innerHTML = `<div class="info-card"><strong>Brak wyników</strong><span>${state.showCoverageOnly ? 'Zmień szukaną frazę albo wyłącz filtr zasięgu w ustawieniach.' : 'Zmień szukaną frazę.'}</span></div>`;
        return;
      }
      results.innerHTML=items.map(t=>`<button class="tx-item ${state.selected?.id===t.id?'active':''}" data-tx="${esc(t.id)}"><strong>${esc(stationDisplayName(t))}</strong><span>${fmtKm(t.distance)} · azymut ${Math.round(t.azimuth)}° · moc ERP ${stationPowerText(t)} · zasięg szac. ${Math.round(estimatedCoverageRadiusKm(t))} km · MUX ${muxNames(t).map(m=>m.replace('MUX-','')).join('/')}</span></button>`).join('');
      results.querySelectorAll('[data-tx]').forEach(b=>b.onclick=()=>{selectTx(b.dataset.tx,true,true); closePanel();});
    };
    input.addEventListener('input', e=>renderList(e.target.value));
    setTimeout(()=>input.focus({preventScroll:true}),80);
    renderList('');
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
    const meta=`${esc(stationDisplayName(t))} · ${t.site_elevation_m||'—'} m n.p.m. · maszt/antena ${t.height||'—'} m n.p.t.`;
    openPanel('MUX-y i moce nadajnika', meta, rows);
  }
  function showLayers(){
    openPanel('Warstwy mapy','Podkład mapy oraz dodatkowa mapa zasięgu GeoJSON/XYZ.', `
      <button class="tx-item ${state.base==='osm'?'active':''}" data-base="osm"><strong>Plan OSM</strong><span>Klasyczna mapa z nazwami miejscowości.</span></button>
      <button class="tx-item ${state.base==='hot'?'active':''}" data-base="hot"><strong>OSM Humanitarian</strong><span>Wyraźniejsze drogi i miejscowości.</span></button>
      <button class="tx-item ${state.base==='light'?'active':''}" data-base="light"><strong>Jasna CARTO</strong><span>Jasny styl do pracy na komputerze.</span></button>
      <button class="tx-item ${state.base==='topo'?'active':''}" data-base="topo"><strong>Topo</strong><span>Mapa topograficzna z nazwami miejsc.</span></button>
      <button class="tx-item ${state.base==='street'?'active':''}" data-base="street"><strong>Ulice Esri</strong><span>Mapa drogowa z podpisami miast.</span></button>
      <button class="tx-item ${state.base==='sat'?'active':''}" data-base="sat"><strong>Satelita Esri + nazwy</strong><span>Zdjęcia satelitarne z dołożonymi nazwami miejscowości.</span></button>
      <div class="info-card"><strong>Dodatkowa warstwa zasięgu XYZ</strong><span>Wklej adres kafelków HTTPS z tokenami {z}/{x}/{y}. To jest osobna mapa pokrycia, nie zasięg orientacyjny liczony przez aplikację.</span><input id="coverageTileInput" type="text" placeholder="https://.../{z}/{x}/{y}.png" value="${esc(state.coverageTileUrl||'')}"><button id="applyCoverageTileBtn" class="panel-btn primary">Dodaj zewnętrzną warstwę zasięgu</button><button id="clearCoverageTileBtn" class="panel-btn">Usuń zewnętrzną warstwę</button></div>
      <div class="info-card"><strong>Wczytaj mapę zasięgu GeoJSON</strong><span>Wczytuje lokalny plik GeoJSON jako warstwę pomocniczą. Plik musi pochodzić z legalnego źródła.</span><input id="coverageGeoJsonInput" type="file" accept=".geojson,.json,application/geo+json,application/json"><button id="importCoverageGeoJsonBtn" class="panel-btn primary">Wczytaj GeoJSON</button></div>
    `);
    $('panelContent').querySelectorAll('[data-base]').forEach(b=>b.onclick=()=>{setBase(b.dataset.base); closePanel();});
    $('applyCoverageTileBtn').onclick=()=>applyCoverageTile($('coverageTileInput').value);
    $('clearCoverageTileBtn').onclick=()=>{ state.coverageTileUrl=''; clearCoverageLayer(); save(); toast('Usunięto zewnętrzną warstwę zasięgu.'); };
    $('importCoverageGeoJsonBtn').onclick=()=>importCoverageGeoJson($('coverageGeoJsonInput').files?.[0]).catch(err=>toast('Błąd GeoJSON: '+(err.message||err)));
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
    toast('Dodano zewnętrzną warstwę zasięgu.');
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
    toast('Zaimportowano zewnętrzną warstwę zasięgu GeoJSON.');
  }

  function showData(){
    openPanel('Ustawienia aplikacji','', `
      <div class="info-card"><strong>Wersja</strong><span>${APP_VERSION}</span></div>
      <div class="info-card"><strong>Mapa nadajników</strong><label class="switch-row"><input id="coverageOnlyToggle" type="checkbox" ${state.showCoverageOnly?'checked':''}><span>Tylko nadajniki w zasięgu punktu odbioru</span></label></div>
      <div id="settingsInstallCard" class="info-card" hidden><strong>Instalacja</strong><button id="settingsInstallBtn" class="panel-btn primary" type="button">Zainstaluj aplikację</button></div>
      <div class="info-card"><strong>Aktualizacja</strong><button id="refreshPwa" class="panel-btn primary" type="button">Wymuś aktualizację</button></div>`);
    const installButton = $('settingsInstallBtn');
    if(installButton) installButton.onclick=installApp;
    updateInstallButtons();
    const coverageToggle=$('coverageOnlyToggle');
    if(coverageToggle) coverageToggle.onchange=()=>{ state.showCoverageOnly=coverageToggle.checked; save(); const ok=applyCoverageOnlyFilter(); toast(state.showCoverageOnly ? (ok?'Włączono filtr nadajników w zasięgu.':'Brak nadajników w szacowanym zasięgu.') : 'Wyłączono filtr nadajników.'); };
    $('refreshPwa').onclick=async()=>{ const regs=await navigator.serviceWorker?.getRegistrations?.()||[]; for(const r of regs){ await r.unregister(); } const keys=await caches.keys(); await Promise.all(keys.filter(k=>k!==ANT_CACHE_NAME).map(k=>caches.delete(k)));  location.reload(); };
  }



  function showAbout(){
    openPanel('O programie','Instrukcja obsługi i opis funkcji.', `
      <div class="info-card"><strong>Do czego służy program</strong><span>Aplikacja pomaga dobrać nadajnik DVB-T/T2 dla wskazanego punktu odbioru. Pokazuje odległość, azymut, MUX-y, moc ERP, profil terenu, kompas/północ oraz warstwy pomocnicze.</span></div>
      <div class="info-card"><strong>1. Ustaw punkt odbioru</strong><span>Wpisz adres w polu wyszukiwania, użyj GPS albo przytrzymaj palec na mapie. Od wersji 19.13 zmiana punktu odbioru nie przełącza automatycznie wcześniej wybranego nadajnika.</span></div>
      <div class="info-card"><strong>2. Wybierz nadajnik</strong><span>Kliknij marker nadajnika albo przycisk z listą nadajników. Na karcie nadajnika zobaczysz azymut, odległość, polaryzację i moc ERP dla emisji/MUX-ów.</span></div>
      <div class="info-card"><strong>3. Kompas</strong><span>Kompas jest dostępny z górnego widżetu oraz z przycisku N↑ po prawej stronie. Niebieska igła oznacza kierunek do nadajnika, pomarańczowa kierunek telefonu. Stożek na mapie pokazuje orientacyjny kierunek trzymania telefonu.</span></div>
      <div class="info-card"><strong>4. Profil terenu</strong><span>Profil wymaga danych wysokości DEM. Program pobiera je z API wysokości i zapisuje w lokalnym cache przeglądarki. Jeżeli API nie odpowiada, program nie udaje prawdziwego terenu prostą kreską — pokaże informację o braku DEM albo użyje tylko częściowego cache jako profil przybliżony.</span></div>
      <div class="info-card"><strong>5. DEM i zasięg terenowy</strong><span>Przycisk „Pobierz DEM” zapisuje lokalnie wysokości dla okolicy wybranego nadajnika. Obliczony zasięg RF/ITM-lite jest orientacyjny, nie oficjalny. Bierze pod uwagę ERP, częstotliwość, wysokość anten, teren i pliki ANT z cache, jeśli są dostępne.</span></div>
      <div class="info-card"><strong>6. Warstwy mapy</strong><span>Warstwy przełączają podkład mapy oraz opcjonalną zewnętrzną mapę zasięgu GeoJSON/XYZ. Taka warstwa jest osobnym źródłem danych i nie jest tym samym co orientacyjny zasięg liczony przez aplikację.</span></div>
      <div class="info-card"><strong>7. Dane i diagnostyka</strong><span>Panel ustawień zawiera tylko ustawienia ogólne aplikacji i aktualizację PWA. Funkcje zależne od nadajnika są w karcie wybranego nadajnika.</span></div>
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
  function showSelectedDemStats(){
    const t=state.selected;
    if(!t) return toast('Najpierw wybierz nadajnik.');
    const cache=loadDemCache();
    const radius=demRadiusForTx(t);
    const grid=buildDemGridForTx(t, radius);
    const cached=grid.filter(p=>Number.isFinite(+cache[demKeyFromPoint(p)])).length;
    const missing=Math.max(0, grid.length-cached);
    const pct=grid.length ? Math.round(cached*100/grid.length) : 0;
    const total=demStats().points;
    openPanel('Cache DEM nadajnika', `${t.short_name||t.name}`, `
      <div class="info-card"><strong>Stan cache dla tego nadajnika</strong><span>Promień kontroli: około ${Math.round(radius)} km. Punkty wymagane: ${grid.length}. W cache: ${cached}. Braki: ${missing}. Pokrycie: ${pct}%.</span></div>
      <div class="info-card"><strong>Cache DEM całej aplikacji</strong><span>Łącznie zapisanych punktów DEM: ${total}. Dane są zapisane lokalnie w przeglądarce dla tej strony.</span></div>
      <button id="cacheDownloadDem" class="panel-btn primary" type="button">Pobierz brakujące DEM</button>`);
    $('cacheDownloadDem').onclick=downloadDemForSelectedTx;
  }
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
  const TERRAIN_TILE_Z = 12;
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
  async function fetchElevationsFromTerrarium(points, onProgress=null){
    const z=TERRAIN_TILE_Z;
    const out=new Array(points.length);
    const groups=new Map();
    points.forEach((p,i)=>{
      const pos=tilePixel(p.lat,p.lon,z);
      const key=`${z}/${pos.tx}/${pos.ty}`;
      if(!groups.has(key)) groups.set(key, {tx:pos.tx, ty:pos.ty, items:[]});
      groups.get(key).items.push({i, px:pos.px, py:pos.py});
    });
    const tileGroups=[...groups.values()];
    for(let gi=0; gi<tileGroups.length; gi++){
      const g=tileGroups[gi];
      const data=await loadTerrariumTile(g.tx,g.ty,z);
      for(const item of g.items){
        const idx=(item.py*256+item.px)*4;
        const r=data[idx], gr=data[idx+1], b=data[idx+2];
        const elev=(r*256 + gr + b/256) - 32768;
        if(!Number.isFinite(elev) || elev < -500 || elev > 9000) throw new Error('Błędna próbka kafla DEM');
        out[item.i]=Math.round(elev*10)/10;
      }
      if(onProgress) onProgress(gi+1, tileGroups.length);
      if(gi % 4 === 0) await sleep(0);
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
      let lastTerrariumErr='';
      for(let start=0; start<missing.length; start+=64){
        const chunk=missing.slice(start, start+64);
        let filled=false;
        try{
          const terr=await fetchElevationsFromTerrarium(chunk);
          chunk.forEach((p,idx)=>{ out[p.i]=terr[idx]; cache[p.key]=terr[idx]; });
          filled=true;
        }catch(err){
          lastTerrariumErr = err?.message || String(err);
        }
        if(!filled){
          const api=await fetchElevationsFromApi(chunk, `Nie udało się pobrać wysokości DEM. Terrarium: ${lastTerrariumErr}`);
          chunk.forEach((p,idx)=>{ out[p.i]=api[idx]; cache[p.key]=api[idx]; });
        }
      }
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

  function antCacheAvailable(){
    return typeof caches !== 'undefined' && typeof Response !== 'undefined';
  }

  async function getAntCache(){
    if(!antCacheAvailable()) return null;
    try{ return await caches.open(ANT_CACHE_NAME); }catch{ return null; }
  }

  async function readAntTextFromCache(path){
    const cache=await getAntCache();
    if(!cache || !path) return null;
    const r=await cache.match(path);
    if(!r || !r.ok) return null;
    return await r.text();
  }

  async function writeAntTextToCache(path, text){
    const cache=await getAntCache();
    if(!cache || !path || !text) return false;
    try{
      await cache.put(path, new Response(text, {headers:{'Content-Type':'text/plain; charset=utf-8'}}));
      return true;
    }catch{ return false; }
  }

  function antDownloadUrls(mux){
    const raw=String(mux?.ant_file_url || '').trim();
    if(!raw) return [];
    const urls=[];
    if(raw.startsWith('http://')) urls.push(raw.replace(/^http:\/\//,'https://'));
    urls.push(raw);
    return [...new Set(urls)];
  }

  function collectSelectedAntMuxes(t){
    const selected=t || state.selected;
    if(!selected) return [];
    const out=[];
    const seen=new Set();
    for(const mux of selected.muxes || []){
      const path=String(mux.ant_pattern_path || '').trim();
      const url=String(mux.ant_file_url || '').trim();
      const key=path || url || `${mux.name||''}:${mux.channel||''}`;
      if(!key || seen.has(key)) continue;
      seen.add(key);
      out.push({mux, path, url});
    }
    return out;
  }

  async function fetchAntTextForMux(mux, forceDownload=false){
    const path=String(mux?.ant_pattern_path || '').trim();
    if(!path && !mux?.ant_file_url) return {status:'no-data', text:null, source:'brak'};

    if(path && !forceDownload){
      const cached=await readAntTextFromCache(path);
      if(cached) return {status:'ok', text:cached, source:'cache'};
      try{
        const r=await fetch(path+'?v='+Date.now(), {cache:'no-store'});
        if(r.ok){
          const txt=await r.text();
          await writeAntTextToCache(path, txt);
          return {status:'ok', text:txt, source:'lokalny plik'};
        }
      }catch{}
    }

    for(const url of antDownloadUrls(mux)){
      try{
        const r=await fetch(url, {cache:'no-store', mode:'cors'});
        if(!r.ok) continue;
        const txt=await r.text();
        if(path) await writeAntTextToCache(path, txt);
        return {status:'ok', text:txt, source:url.startsWith('https://')?'pobrano z internetu HTTPS':'pobrano z internetu'};
      }catch{}
    }

    return {status:'missing', text:null, source:'brak dostępu'};
  }

  async function checkSelectedTransmitterAnt(){
    const t=state.selected;
    if(!t) return toast('Najpierw wybierz nadajnik.');
    const items=collectSelectedAntMuxes(t);
    if(!items.length){
      openPanel('ANT wybranego nadajnika', `${t.short_name||t.name}`, '<div class="info-card"><strong>Brak danych ANT</strong><span>Wybrany nadajnik nie ma w bazie linków ani ścieżek do plików ANT.</span></div>');
      return;
    }
    const rows=[];
    let ok=0, fromCache=0, downloaded=0, missing=0, bad=0;
    toast('Sprawdzam ANT wybranego nadajnika...');
    openPanel('Sprawdzanie ANT', `${t.short_name||t.name}`, `<div class="info-card"><strong>Start</strong><span>Sprawdzam tylko MUX-y aktualnie wybranego nadajnika. 0/${items.length}</span></div>`);

    for(let i=0;i<items.length;i++){
      const {mux, path, url}=items[i];
      const progress=`${i+1}/${items.length}`;
      const box=$('panelContent');
      if(box) box.innerHTML=`<div class="info-card"><strong>Sprawdzam ANT</strong><span>${progress}: ${esc(mux.name||'MUX')} ${esc(mux.channel||'')}</span></div>`;
      const res=await fetchAntTextForMux(mux, false);
      if(res.status==='ok'){
        const a=analyzeAntPatternText(res.text);
        if(a.ok){
          ok++;
          if(res.source==='cache') fromCache++;
          if(String(res.source).startsWith('pobrano')) downloaded++;
          if(path) state.antPatterns.set(path, a.pattern);
          rows.push(`<div class="tx-item"><strong>${esc(mux.name||'MUX')} · ${esc(mux.channel||'')}</strong><span>OK — ${esc(res.source)}. Punktów: ${a.points}. Zakres azymutów: ${a.min_az ?? '—'}–${a.max_az ?? '—'}°. ${a.approx_full_360?'Zakres prawie 360°':'Zakres częściowy'}.</span></div>`);
        }else{
          bad++;
          rows.push(`<div class="tx-item"><strong>${esc(mux.name||'MUX')} · ${esc(mux.channel||'')}</strong><span>Plik znaleziony, ale parser nie rozpoznał poprawnej charakterystyki. Punktów: ${a.points}. Źródło: ${esc(res.source)}.</span></div>`);
        }
      }else{
        missing++;
        const why = !url ? 'brak linku do pobrania w bazie' : 'nie udało się pobrać; możliwy CORS, blokada HTTP/HTTPS albo brak pliku po stronie źródła';
        rows.push(`<div class="tx-item"><strong>${esc(mux.name||'MUX')} · ${esc(mux.channel||'')}</strong><span>Brak ANT — ${why}. Ścieżka lokalna: ${esc(path||'—')}.</span></div>`);
      }
      await new Promise(r=>setTimeout(r, 80));
    }

    const conclusion = ok>0
      ? `Gotowe. Poprawne ANT: ${ok}. Z cache: ${fromCache}. Pobrane teraz: ${downloaded}. Braki: ${missing}. Błędny format: ${bad}. Obliczanie RF może użyć zapisanych danych ANT dla tego nadajnika.`
      : `Nie mam poprawnego ANT dla tego nadajnika. Braki: ${missing}. Błędny format: ${bad}. RF policzy zasięg bez korekty charakterystyki anteny.`;
    openPanel('Raport ANT wybranego nadajnika', `${t.short_name||t.name}`, `
      <div class="info-card"><strong>Podsumowanie</strong><span>${esc(conclusion)}</span></div>
      <div class="info-card"><strong>Cache</strong><span>Pliki pobrane przez ten przycisk są zapisywane w cache przeglądarki, nie jako fizyczne pliki w folderze data/ant. Dzięki temu następne sprawdzenie tego samego nadajnika nie powinno pobierać ich ponownie.</span></div>
      ${rows.join('')}
    `);
    toast('Sprawdzanie ANT zakończone.');
  }

  async function loadAntPattern(mux){
    const path=mux?.ant_pattern_path;
    if(!path && !mux?.ant_file_url) return null;
    if(path && state.antPatterns.has(path)) return state.antPatterns.get(path);
    try{
      const res=await fetchAntTextForMux(mux, false);
      if(res.status !== 'ok' || !res.text){
        if(path) state.antPatterns.set(path, null);
        return null;
      }
      const parsed=parseAntPattern(res.text);
      if(path) state.antPatterns.set(path, parsed);
      return parsed;
    }catch{
      if(path) state.antPatterns.set(path, null);
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

  function rfDistanceStepKm(maxKm){
    // POPRAWKA KRYTYCZNA 19.26 — NIE ZMIENIAĆ BEZ TESTU ZASIĘGU:
    // Gęsta siatka RF ma wykrywać lokalne przeszkody terenowe dokładniej niż stara siatka 10° / 3 km.
    if(maxKm <= 25) return 0.10;
    if(maxKm <= 50) return 0.20;
    return 0.25;
  }
  function rfCacheSupported(){ return typeof indexedDB !== 'undefined'; }
  function openRfDb(){
    if(!rfCacheSupported()) return Promise.resolve(null);
    return new Promise(resolve=>{
      const req=indexedDB.open(RF_DB_NAME, 1);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains(RF_DB_STORE)){
          const store=db.createObjectStore(RF_DB_STORE, {keyPath:'key'});
          store.createIndex('createdAt','createdAt',{unique:false});
          store.createIndex('txId','txId',{unique:false});
        }
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>resolve(null);
      req.onblocked=()=>resolve(null);
    });
  }
  async function getRfCache(key){
    const db=await openRfDb();
    if(!db) return null;
    return await new Promise(resolve=>{
      const tx=db.transaction(RF_DB_STORE,'readonly');
      const req=tx.objectStore(RF_DB_STORE).get(key);
      req.onsuccess=()=>resolve(req.result || null);
      req.onerror=()=>resolve(null);
      tx.oncomplete=()=>db.close();
      tx.onerror=()=>db.close();
    });
  }
  async function putRfCache(payload){
    const db=await openRfDb();
    if(!db) return false;
    return await new Promise(resolve=>{
      const tx=db.transaction(RF_DB_STORE,'readwrite');
      tx.objectStore(RF_DB_STORE).put(payload);
      tx.oncomplete=()=>{ db.close(); resolve(true); };
      tx.onerror=()=>{ db.close(); resolve(false); };
      tx.onabort=()=>{ db.close(); resolve(false); };
    });
  }
  function rfCacheKey(t, mux, freq, erpKw, txHeight, maxKm, distanceStep, mode='full', local=null){
    const antKey=String(mux?.ant_pattern_path || mux?.ant_file_url || 'no-ant');
    const localKey=local ? `${(+local.lat).toFixed(4)},${(+local.lon).toFixed(4)},r${RF_QUICK_LOCAL_RADIUS_KM},g${RF_QUICK_LOCAL_GRID_STEP_KM}` : 'all';
    return [RF_ALGO_VERSION, mode, t.id, mux?.name||'', mux?.channel||'', Math.round(freq*10)/10, Math.round(erpKw*1000), Math.round(txHeight), Math.round(state.rxHeight*10)/10, Math.round(maxKm*10)/10, RF_BEARING_STEP_DEG, distanceStep, localKey, antKey].join('|');
  }
  function rfLocalCellPolygon(cell){
    const half=Math.max(0.01, (+cell.sizeKm || RF_QUICK_LOCAL_GRID_STEP_KM) / 2);
    const latKm=111.32;
    const lonKm=Math.max(1, 111.32*Math.cos(rad(+cell.lat || 0)));
    const dLat=half/latKm;
    const dLon=half/lonKm;
    return [[cell.lat-dLat,cell.lon-dLon],[cell.lat-dLat,cell.lon+dLon],[cell.lat+dLat,cell.lon+dLon],[cell.lat+dLat,cell.lon-dLon]];
  }
  function rfCellPolygon(t, cell, bearingStep, distanceStep){
    if(cell.kind === 'local' && Number.isFinite(+cell.lat) && Number.isFinite(+cell.lon)) return rfLocalCellPolygon(cell);
    const bs=Number.isFinite(+cell.bearingStep) ? +cell.bearingStep : bearingStep;
    const ds=Number.isFinite(+cell.distanceStep) ? +cell.distanceStep : distanceStep;
    const halfBearing=bs/2;
    const inner=Math.max(0.05, cell.km-ds/2);
    const outer=cell.km+ds/2;
    const a=destinationPoint(t.lat,t.lon,cell.bearing-halfBearing,inner);
    const b=destinationPoint(t.lat,t.lon,cell.bearing+halfBearing,inner);
    const c=destinationPoint(t.lat,t.lon,cell.bearing+halfBearing,outer);
    const dpt=destinationPoint(t.lat,t.lon,cell.bearing-halfBearing,outer);
    return [[a.lat,a.lon],[b.lat,b.lon],[c.lat,c.lon],[dpt.lat,dpt.lon]];
  }
  async function drawRfCells(t, cells, meta, setRfStatus=null){
    clearRfLayer();
    const renderer=L.canvas({padding:.5, tolerance:0});
    state.rfLayer=L.layerGroup();
    const chunkSize=700;
    for(let i=0; i<cells.length; i++){
      const cell=cells[i];
      const color=rfColor(cell.level);
      L.polygon(rfCellPolygon(t, cell, meta.bearingStep, meta.distanceStep), {renderer, color, weight:.45, opacity:.50, fillColor:color, fillOpacity:.26, interactive:false}).addTo(state.rfLayer);
      if(i>0 && i % chunkSize === 0){
        if(setRfStatus) setRfStatus('Rysowanie', `Rysuję siatkę: ${i} / ${cells.length} komórek.`);
        await sleep(0);
      }
    }
    state.rfLayer.addTo(state.map);
  }

  function summarizeRfCells(cells){
    let bestReach=0, blockedCells=0, lossSum=0;
    for(const c of cells){
      if(c.level >= -88 && c.km > bestReach) bestReach=c.km;
      if(c.loss > 6) blockedCells++;
      lossSum += (+c.loss || 0);
    }
    return {
      bestReach,
      blockedCells,
      avgLoss: cells.length ? lossSum / cells.length : 0
    };
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
  function buildItmRays(t, maxKm, bearingStep=RF_BEARING_STEP_DEG, distanceStep=0.25){
    const bearings=[];
    for(let b=0; b<360; b+=bearingStep) bearings.push(+b.toFixed(4));
    const distances=[];
    for(let d=distanceStep; d<=maxKm; d+=distanceStep) distances.push(+d.toFixed(4));
    return bearings.map(bearing=>({
      bearing,
      points: distances.map(km=>({bearing, km, ...destinationPoint(t.lat,t.lon,bearing,km)}))
    }));
  }

  function rfQuickDistanceStepKm(maxKm){
    if(maxKm <= 25) return 0.75;
    if(maxKm <= 50) return 1.25;
    return 2.00;
  }

  function buildLocalEndpointGrid(center, radiusKm=RF_QUICK_LOCAL_RADIUS_KM, stepKm=RF_QUICK_LOCAL_GRID_STEP_KM){
    const pts=[];
    const latKm=111.32;
    const lonKm=Math.max(1, 111.32*Math.cos(rad(center.lat)));
    for(let y=-radiusKm; y<=radiusKm+0.0001; y+=stepKm){
      for(let x=-radiusKm; x<=radiusKm+0.0001; x+=stepKm){
        if(Math.sqrt(x*x+y*y) <= radiusKm + stepKm*.35){
          pts.push({lat:center.lat + y/latKm, lon:center.lon + x/lonKm, localOffsetKm:Math.sqrt(x*x+y*y)});
        }
      }
    }
    return pts;
  }

  function askRfCalcMode(t){
    if(pendingRfModeResolve){
      const old=pendingRfModeResolve;
      pendingRfModeResolve=null;
      old(null);
    }
    return new Promise(resolve=>{
      pendingRfModeResolve=resolve;
      openPanel('Tryb obliczania zasięgu', stationDisplayName(t), `
        <div class="info-card"><strong>Wybierz sposób liczenia</strong><span>Całość liczy bardzo gęstą siatkę dla całego obszaru. Szybkie liczenie robi rzadszą siatkę ogólną, a ekstremalnie gęstą tylko w promieniu ${Math.round(RF_QUICK_LOCAL_RADIUS_KM*1000)} m od punktu odbioru.</span></div>
        <button id="rfQuickModeBtn" class="panel-btn primary" type="button">Szybkie liczenie — dokładnie przy mnie</button>
        <button id="rfFullModeBtn" class="panel-btn" type="button">Oblicz całość — pełna gęsta siatka</button>
        <button id="rfCancelModeBtn" class="panel-btn" type="button">Anuluj</button>
      `);
      const done=(mode)=>{
        pendingRfModeResolve=null;
        closePanel();
        resolve(mode);
      };
      $('rfQuickModeBtn').onclick=()=>done('quick');
      $('rfFullModeBtn').onclick=()=>done('full');
      $('rfCancelModeBtn').onclick=()=>done(null);
    });
  }

  async function buildRfCellsFromRays(rays, freq, erpDbm, antPattern, txAlt, distanceStep, setRfStatus=null, label='Obliczenia'){
    const allPoints=[];
    for(const ray of rays) allPoints.push(...ray.points.map(p=>({lat:p.lat, lon:p.lon})));
    const elev=await fetchElevationsFromTerrarium(allPoints, (done,total)=>{
      if(setRfStatus && (done % 6 === 0 || done === total)) setRfStatus('DEM', `Pobieram kafle DEM: ${done} / ${total}. Próbek: ${allPoints.length}.`);
    });
    let eidx=0;
    for(const ray of rays){
      for(const p of ray.points){ p.elev=+elev[eidx++]; }
    }
    const cells=[];
    for(let r=0; r<rays.length; r++){
      const ray=rays[r];
      for(let i=0;i<ray.points.length;i++){
        const p=ray.points[i];
        const distKm=Math.max(0.05,p.km);
        const fspl=freeSpaceLossDb(freq, distKm);
        const itmLoss=terrainItmLossDb(ray.points, i, freq, txAlt, state.rxHeight);
        const antGain=antennaGainDb(antPattern, ray.bearing);
        const reliabilityMargin=distKm>40 ? (distKm-40)*0.08 : 0;
        const level=erpDbm + antGain - fspl - itmLoss - reliabilityMargin;
        cells.push({bearing:ray.bearing, km:p.km, level:Math.round(level*10)/10, loss:Math.round(itmLoss*10)/10, distanceStep});
      }
      if(setRfStatus && r>0 && r % 12 === 0){
        setRfStatus(label, `Przeliczono kierunki: ${r} / ${rays.length}. Komórek: ${cells.length}.`);
        await sleep(0);
      }
    }
    return cells;
  }

  async function buildQuickLocalCells(t, maxKm, freq, erpDbm, antPattern, txAlt, setRfStatus=null){
    const endpoints=buildLocalEndpointGrid(state.rx, RF_QUICK_LOCAL_RADIUS_KM, RF_QUICK_LOCAL_GRID_STEP_KM)
      .map(p=>({ ...p, km:dist({lat:t.lat,lon:t.lon}, p), bearing:az({lat:t.lat,lon:t.lon}, p) }))
      .filter(p=>p.km <= maxKm + RF_QUICK_LOCAL_RADIUS_KM);
    if(!endpoints.length) return [];

    const routePoints=[];
    const routes=endpoints.map(end=>{
      const points=[];
      for(let d=RF_QUICK_PROFILE_STEP_KM; d<end.km; d+=RF_QUICK_PROFILE_STEP_KM){
        const pp=destinationPoint(t.lat,t.lon,end.bearing,d);
        const rp={km:+d.toFixed(4), lat:pp.lat, lon:pp.lon};
        points.push(rp);
        routePoints.push({lat:rp.lat, lon:rp.lon});
      }
      const endpoint={km:end.km, lat:end.lat, lon:end.lon};
      points.push(endpoint);
      routePoints.push({lat:endpoint.lat, lon:endpoint.lon});
      return {end, points};
    });

    if(setRfStatus) setRfStatus('DEM lokalny', `Pobieram DEM dla dokładnej siatki ${Math.round(RF_QUICK_LOCAL_RADIUS_KM*1000)} m: ${routePoints.length} próbek profilu.`);
    const elev=await fetchElevationsFromTerrarium(routePoints, (done,total)=>{
      if(setRfStatus && (done % 6 === 0 || done === total)) setRfStatus('DEM lokalny', `Kafle DEM lokalne: ${done} / ${total}. Próbek profilu: ${routePoints.length}.`);
    });
    let eidx=0;
    const cells=[];
    for(let r=0; r<routes.length; r++){
      const route=routes[r];
      for(const p of route.points){ p.elev=+elev[eidx++]; }
      const distKm=Math.max(0.05, route.end.km);
      const fspl=freeSpaceLossDb(freq, distKm);
      const itmLoss=terrainItmLossDb(route.points, route.points.length-1, freq, txAlt, state.rxHeight);
      const antGain=antennaGainDb(antPattern, route.end.bearing);
      const reliabilityMargin=distKm>40 ? (distKm-40)*0.08 : 0;
      const level=erpDbm + antGain - fspl - itmLoss - reliabilityMargin;
      cells.push({
        kind:'local', lat:route.end.lat, lon:route.end.lon, sizeKm:RF_QUICK_LOCAL_GRID_STEP_KM,
        bearing:Math.round(route.end.bearing*10)/10, km:Math.round(route.end.km*1000)/1000,
        level:Math.round(level*10)/10, loss:Math.round(itmLoss*10)/10
      });
      if(setRfStatus && r>0 && r % 40 === 0){
        setRfStatus('Lokalna siatka', `Przeliczono lokalne komórki: ${r} / ${routes.length}.`);
        await sleep(0);
      }
    }
    return cells;
  }

  async function calculateRfCoverage(){
    const t=state.selected; if(!t) return toast('Najpierw wybierz nadajnik.');
    if(state.rfBusy) return toast('Obliczanie zasięgu już trwa.');
    const mode=await askRfCalcMode(t);
    if(!mode) return;
    state.rfBusy=true;
    const stationName = stationDisplayName(t);
    openPanel(mode==='quick' ? 'Szybkie obliczanie zasięgu RF / terenowego' : 'Obliczanie gęstego zasięgu RF / terenowego', stationName, `<div id="rfStatusBox" class="info-card"><strong>Start</strong><span>Przygotowuję obliczenia dla wybranego nadajnika...</span></div>`);
    const setRfStatus=(title,msg)=>{ const box=$('rfStatusBox'); if(box) box.innerHTML=`<strong>${esc(title)}</strong><span>${esc(msg)}</span>`; };
    toast(mode==='quick' ? 'Szybkie liczenie: dokładna siatka przy punkcie odbioru...' : 'Liczenie bardzo gęstej siatki zasięgu...');
    try{
      setRfStatus('Parametry', 'Odczytuję ERP, częstotliwość, wysokość anteny i plik ANT.');
      const {freq, erpKw, mux, txHeight}=txMainParams(t);
      const antPattern=await loadAntPattern(mux);
      const maxKm=Math.max(18, Math.min(95, Math.sqrt(erpKw)*23 + txHeight*0.28));
      const distanceStep=mode==='quick' ? rfQuickDistanceStepKm(maxKm) : rfDistanceStepKm(maxKm);
      const localKey=mode==='quick' ? state.rx : null;
      const cacheKey=rfCacheKey(t, mux, freq, erpKw, txHeight, maxKm, distanceStep, mode, localKey);
      const cached=await getRfCache(cacheKey);
      if(cached && cached.meta && Array.isArray(cached.cells) && cached.cells.length){
        setRfStatus('Cache', `Znalazłem zapisany wynik w przeglądarce: ${cached.cells.length} komórek. Rysuję bez ponownego liczenia.`);
        await drawRfCells(t, cached.cells, cached.meta, setRfStatus);
        const {bestReach, blockedCells, avgLoss}=summarizeRfCells(cached.cells);
        state.lastRf={tx:t.id, freq, erpKw, bestReach, antPattern:!!cached.meta.antPattern, model:`ITM-lite ${cached.meta.mode || mode} cached`};
        toast('Narysowano zasięg z cache przeglądarki.');
        openPanel('Obliczony zasięg RF / terenowy', stationName, `<div class="info-card"><strong>Wynik z cache</strong><span>Użyto zapisanego wyniku: ${cached.cells.length} komórek. Tryb: ${cached.meta.mode==='quick'?'szybki':'pełny'}. Najdalszy punkt z poziomem co najmniej średnim: około ${Math.round(bestReach)} km.</span></div><div class="info-card"><strong>Diagnostyka</strong><span>Komórek z istotną stratą terenową: ${blockedCells}/${cached.cells.length}. Średnia dodatkowa strata terenowa: ${avgLoss.toFixed(1)} dB. Cache: IndexedDB przeglądarki.</span></div><div class="legend-rf"><span><i class="rf-good"></i>bardzo/dobry</span><span><i class="rf-mid"></i>średni</span><span><i class="rf-weak"></i>słaby</span><span><i class="rf-bad"></i>bardzo słaby</span></div>`);
        return;
      }

      setRfStatus('DEM', 'Pobieram wysokość nadajnika z kafli Terrarium.');
      const txElevArr=await fetchElevationsFromTerrarium([{lat:t.lat,lon:t.lon}]);
      const txGround=Number.isFinite(+t.site_elevation_m) ? +t.site_elevation_m : txElevArr[0];
      const txAlt=txGround + txHeight;
      const erpDbm=60 + 10*Math.log10(Math.max(0.001, erpKw));
      let cells=[];
      let modeDescription='';

      if(mode === 'quick'){
        setRfStatus('Siatka', `Buduję szybką siatkę: ogólnie ${RF_QUICK_BEARING_STEP_DEG}° / ${distanceStep} km + lokalnie ${Math.round(RF_QUICK_LOCAL_GRID_STEP_KM*1000)} m w promieniu ${Math.round(RF_QUICK_LOCAL_RADIUS_KM*1000)} m.`);
        const coarseRays=buildItmRays(t, maxKm, RF_QUICK_BEARING_STEP_DEG, distanceStep);
        const coarseCells=await buildRfCellsFromRays(coarseRays, freq, erpDbm, antPattern, txAlt, distanceStep, setRfStatus, 'Obliczenia ogólne');
        const localCells=await buildQuickLocalCells(t, maxKm, freq, erpDbm, antPattern, txAlt, setRfStatus);
        cells=coarseCells.concat(localCells);
        modeDescription=`Szybkie liczenie: rzadsza siatka całego obszaru + bardzo dokładne komórki ${Math.round(RF_QUICK_LOCAL_GRID_STEP_KM*1000)} m w promieniu ${Math.round(RF_QUICK_LOCAL_RADIUS_KM*1000)} m od punktu odbioru.`;
      }else{
        setRfStatus('Siatka', `Buduję bardzo gęstą siatkę: ${RF_BEARING_STEP_DEG}° / ${distanceStep} km. Wynik zostanie zapisany w IndexedDB.`);
        const rays=buildItmRays(t, maxKm, RF_BEARING_STEP_DEG, distanceStep);
        cells=await buildRfCellsFromRays(rays, freq, erpDbm, antPattern, txAlt, distanceStep, setRfStatus, 'Obliczenia');
        modeDescription=`Pełne liczenie: bardzo gęsta siatka całego obszaru ${RF_BEARING_STEP_DEG}° / ${distanceStep} km.`;
      }

      const meta={
        algo:RF_ALGO_VERSION,
        mode,
        bearingStep:mode==='quick' ? RF_QUICK_BEARING_STEP_DEG : RF_BEARING_STEP_DEG,
        distanceStep,
        localRadiusKm:mode==='quick' ? RF_QUICK_LOCAL_RADIUS_KM : null,
        localGridStepKm:mode==='quick' ? RF_QUICK_LOCAL_GRID_STEP_KM : null,
        maxKm:Math.round(maxKm*10)/10,
        freq, erpKw, txHeight,
        rxHeight:state.rxHeight,
        rxLat:Math.round(state.rx.lat*100000)/100000,
        rxLon:Math.round(state.rx.lon*100000)/100000,
        antPattern:!!antPattern,
        terrainTileZ:TERRAIN_TILE_Z,
        createdAt:new Date().toISOString()
      };
      setRfStatus('Cache', `Zapisuję wynik w przeglądarce: ${cells.length} komórek.`);
      const saved=await putRfCache({key:cacheKey, txId:t.id, createdAt:meta.createdAt, meta, cells});
      setRfStatus('Rysowanie', `Rysuję siatkę: ${cells.length} komórek.`);
      await drawRfCells(t, cells, meta, setRfStatus);
      const {bestReach, blockedCells, avgLoss}=summarizeRfCells(cells);
      const localCount=cells.filter(c=>c.kind==='local').length;
      state.lastRf={tx:t.id, freq, erpKw, bestReach, antPattern:!!antPattern, model:`ITM-lite terrain diffraction ${mode}`};
      toast(`Narysowano zasięg: ${cells.length} komórek${saved ? ' i zapisano w cache' : ''}.`);
      openPanel(mode==='quick' ? 'Obliczony szybki zasięg RF / terenowy' : 'Obliczony gęsty zasięg RF / terenowy', stationName, `<div class="info-card"><strong>Wynik</strong><span>Najdalszy punkt z poziomem co najmniej średnim: około ${Math.round(bestReach)} km. Komórek: ${cells.length}${mode==='quick' ? `, w tym lokalnych dokładnych: ${localCount}` : ''}. Cache: ${saved ? 'zapisany w IndexedDB' : 'nie udało się zapisać'}.</span></div><div class="info-card"><strong>Model 19.27</strong><span>${esc(modeDescription)} DEM z kafli Terrarium na zoomie ${TERRAIN_TILE_Z}, krzywizna Ziemi, 60% pierwszej strefy Fresnela, strata dyfrakcyjna knife-edge i korekta ANT.</span></div><div class="info-card"><strong>Diagnostyka</strong><span>Komórek z istotną stratą terenową: ${blockedCells}/${cells.length}. Średnia dodatkowa strata terenowa: ${avgLoss.toFixed(1)} dB. Pierwsze liczenie zapisuje się lokalnie w IndexedDB.</span></div><div class="legend-rf"><span><i class="rf-good"></i>bardzo/dobry</span><span><i class="rf-mid"></i>średni</span><span><i class="rf-weak"></i>średni/słaby</span><span><i class="rf-bad"></i>bardzo słaby</span></div>`);
    }catch(err){
      const msg = err?.message || String(err);
      openPanel('Błąd obliczania zasięgu', stationName, `<div class="info-card"><strong>Nie udało się obliczyć zasięgu</strong><span>${esc(msg)}</span></div><div class="info-card"><strong>Co teraz</strong><span>Gęsta siatka pobiera dużo kafli DEM i zapisuje duży wynik w IndexedDB. Jeżeli błąd wraca, sprawdź internet, odśwież stronę albo wyczyść dane strony.</span></div>`);
      toast('Błąd obliczeń RF: ' + msg);
    }finally{
      state.rfBusy=false;
    }
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
    openPanel('Profil terenu', `${state.rx.label} → ${stationDisplayName(t)}`, `<div class="row info-card"><strong>Wysokość anteny odbiorczej</strong><input id="rxHeight" type="number" min="1" max="40" value="${state.rxHeight}"></div><button id="profileDownloadDem" class="panel-btn primary" type="button">Pobierz DEM i odśwież profil</button><div id="profileBox" class="info-card"><strong>Ładuję prawdziwy profil DEM...</strong><span>Pobieram prawdziwe próbki DEM z kafli wysokości. Dopiero gdy kafle nie zadziałają, użyję zapasowego API punktowego.</span></div>`);
    $('rxHeight').onchange=e=>{state.rxHeight=Math.max(1,Math.min(40,+e.target.value||6)); save(); showProfile();};
    $('profileDownloadDem').onclick=async()=>{ await fetchProfile(state.rx,t,true).then(p=>renderProfile(p,t)).catch(err=>renderProfileError(err)); };
    try{ const p=await fetchProfile(state.rx,t,false); renderProfile(p,t); }catch(err){ renderProfileError(err); }
  }

  function renderProfileError(err){
    $('profileBox').innerHTML=`<div class="profile-error"><strong>Nie mam prawdziwych danych DEM dla tej trasy.</strong><span>${esc(err.message||'API wysokości nie odpowiedziało.')}</span><span>Nie rysuję fałszywego profilu prostą linią. Kliknij „Pobierz DEM i odśwież profil” albo spróbuj później, gdy API wysokości przestanie zwracać limit.</span></div>`;
  }

  // POPRAWKA KRYTYCZNA 19.25 — NIE ZMIENIAĆ BEZ TESTU PROFILU TERENU:
  // Profil nie może mieć stałych 128 próbek, bo przy trasach kilkudziesięciu kilometrów
  // daje to odstęp rzędu kilkuset metrów i może pomijać lokalne przeszkody.
  // Liczba próbek jest teraz dobierana dynamicznie: średnio co ok. 40 m,
  // z rozsądnym minimum i limitem, żeby nie przeciążyć przeglądarki.
  const PROFILE_SAMPLE_SPACING_M = 40;
  const PROFILE_MIN_SAMPLES = 256;
  const PROFILE_MAX_SAMPLES = 1800;

  function profileSampleCount(totalDistanceKm){
    const distanceM = Math.max(1, totalDistanceKm * 1000);
    const bySpacing = Math.ceil(distanceM / PROFILE_SAMPLE_SPACING_M) + 1;
    return Math.min(PROFILE_MAX_SAMPLES, Math.max(PROFILE_MIN_SAMPLES, bySpacing));
  }

  async function fetchProfile(a,t,force=false){
    if(profileAbort) profileAbort.abort(); profileAbort=new AbortController();
    const totalDistance = Math.max(0.1, Number.isFinite(+t.distance) ? +t.distance : dist(a,t));
    const n = profileSampleCount(totalDistance);
    const sampleSpacingM = Math.round((totalDistance * 1000) / Math.max(1, n - 1));
    const points=[];
    for(let i=0;i<n;i++){
      const f=i/(n-1);
      points.push({lat:a.lat+(t.lat-a.lat)*f, lon:a.lon+(t.lon-a.lon)*f});
    }
    const routeKey=profileRouteKey(a,t);
    const profileCache=loadProfileCache();
    if(!force && profileCache[routeKey] && Array.isArray(profileCache[routeKey].elev) && profileCache[routeKey].elev.length===n){
      const cached=profileCache[routeKey].elev.map((e,i)=>({d:totalDistance*i/(n-1), e:+e}));
      cached.meta={source:'profile-cache', samples:n, sampleSpacingM};
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
        cached.meta={source:'profile-cache-stale', samples:cached.length, sampleSpacingM: Math.round((totalDistance * 1000) / Math.max(1, cached.length - 1)), apiError};
        return cached;
      }
      throw new Error(`Nie udało się pobrać prawdziwego DEM dla trasy. ${apiError}`);
    }
    profileCache[routeKey]={ts:Date.now(), elev:elev.map(v=>Math.round(+v*10)/10)};
    saveProfileCache(profileCache);
    const result=elev.map((e,i)=>({d:totalDistance*i/(n-1), e:+e}));
    result.meta={source:source, samples:n, sampleSpacingM};
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
    const span=Math.max(60, maxTerrain-minTerrain);
    const min=Math.floor((minTerrain-span*.20)/10)*10;
    const max=Math.ceil((maxTerrain+span*.16)/10)*10;

    // 19.18: profesjonalny renderer SVG. Bez preserveAspectRatio="none", bo ono optycznie
    // rozciągało wykres i dawało wrażenie przekoszenia/krzywego profilu na telefonie.
    const W=760,H=460,padL=66,padR=34,padT=34,padB=70;
    const chartW=W-padL-padR;
    const chartH=H-padT-padB;
    const x=d=>padL+chartW*(d/totalDistance);
    const y=e=>H-padB-chartH*((e-min)/(max-min));
    const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
    const terrainPts=p.map(pt=>[x(pt.d), y(pt.e)]);
    const losPts=p.map(pt=>[x(pt.d), y(rxAlt+(txAlt-rxAlt)*(pt.d/totalDistance))]);
    const terrainPath=terrainPts.map((pt,i)=>`${i?'L':'M'}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(' ');
    // Wypełnienie musi iść dokładnie pod całym profilem terenu, a nie domykać się skośnym klinem.
    const firstTerrain=terrainPts[0];
    const lastTerrain=terrainPts[terrainPts.length-1];
    const terrainArea=`M${firstTerrain[0].toFixed(1)},${H-padB} L${firstTerrain[0].toFixed(1)},${firstTerrain[1].toFixed(1)} ${terrainPts.slice(1).map(pt=>`L${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(' ')} L${lastTerrain[0].toFixed(1)},${H-padB} Z`;
    const losPath=`M${padL},${y(rxAlt).toFixed(1)} L${W-padR},${y(txAlt).toFixed(1)}`;
    const muxForFresnel=(t.muxes||[]).find(m=>Number.isFinite(+m.frequency_mhz)) || {};
    const freqForFresnel=+muxForFresnel.frequency_mhz || 650;
    const lambda=300/Math.max(1,freqForFresnel);
    const fresnelUpper=[], fresnelLower=[];
    for(const pt of p){
      const d1=Math.max(1, pt.d*1000);
      const d2=Math.max(1, (totalDistance-pt.d)*1000);
      const radius=Math.sqrt(lambda*d1*d2/(d1+d2))*0.6;
      const los=rxAlt+(txAlt-rxAlt)*(pt.d/totalDistance);
      fresnelUpper.push([x(pt.d), y(los+radius)]);
      fresnelLower.push([x(pt.d), y(los-radius)]);
    }
    const fresnelArea=`M${fresnelUpper.map(pt=>`${pt[0].toFixed(1)},${clamp(pt[1],padT,H-padB).toFixed(1)}`).join(' L')} L${[...fresnelLower].reverse().map(pt=>`${pt[0].toFixed(1)},${clamp(pt[1],padT,H-padB).toFixed(1)}`).join(' L')} Z`;

    let worst=999, worstD=0, blocked=false;
    const blockedRects=[];
    for(let i=0;i<p.length;i++){
      const pt=p[i];
      const los=rxAlt+(txAlt-rxAlt)*(pt.d/totalDistance);
      const margin=los-pt.e;
      if(margin<worst){worst=margin; worstD=pt.d;}
      if(margin<0){
        blocked=true;
        const w=chartW/(p.length-1)+2;
        blockedRects.push(`<rect x="${(x(pt.d)-w/2).toFixed(1)}" y="${padT}" width="${w.toFixed(1)}" height="${chartH}" fill="rgba(239,68,68,.24)"/>`);
      }
    }

    const ticks=[];
    const tickCount=5;
    for(let i=0;i<=tickCount;i++){
      const val=min+(max-min)*i/tickCount;
      const yy=y(val);
      ticks.push(`<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${W-padR}" y2="${yy.toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>`);
      ticks.push(`<text x="${padL-12}" y="${(yy+4).toFixed(1)}" text-anchor="end" font-size="14" fill="#334155">${Math.round(val)}</text>`);
    }
    const dTicks=[];
    for(let i=0;i<=4;i++){
      const d=totalDistance*i/4;
      const xx=x(d);
      dTicks.push(`<line x1="${xx.toFixed(1)}" y1="${H-padB}" x2="${xx.toFixed(1)}" y2="${H-padB+7}" stroke="#94a3b8" stroke-width="1"/>`);
      dTicks.push(`<text x="${xx.toFixed(1)}" y="${H-28}" text-anchor="middle" font-size="14" fill="#334155">${i===0?'0':d.toFixed(1).replace('.',',')} km</text>`);
    }
    const msg=blocked?'Widoczność: NIE':worst<10?'Widoczność: warunkowa':'Widoczność: TAK';
    const noteClass=blocked?'profile-note bad':worst<10?'profile-note warn':'profile-note ok';
    const meta=p.meta||{};
    const spacingText = meta.sampleSpacingM ? `, średnio co ${meta.sampleSpacingM} m` : '';
    const sourceText = meta.source === 'terrarium-tiles' ? `DEM: pobrano ${meta.samples||p.length} próbek${spacingText} z kafli wysokości Terrarium.` : (meta.source === 'api-live' ? `DEM: pobrano ${meta.samples||p.length} próbek${spacingText} wysokości z API punktowego.` : `DEM: lokalny cache profilu (${meta.samples||p.length} próbek${spacingText}). ${meta.apiError ? 'Odświeżenie nieudane: '+esc(meta.apiError) : ''}`);
    const minElev=Math.round(Math.min(...terrain));
    const maxElev=Math.round(Math.max(...terrain));
    const diffElev=Math.round(txAlt-rxAlt);
    const losAngle=(Math.atan2(txAlt-rxAlt,totalDistance*1000)*180/Math.PI).toFixed(2).replace('.',',');
    const worstTxt = Number.isFinite(worst) ? worst.toFixed(1).replace('.',',') : 'brak';
    const worstDTxt = Number.isFinite(worstD) ? worstD.toFixed(1).replace('.',',') : 'brak';

    $('profileBox').innerHTML=`
      <div class="profile-chart-card profile-pro-card">
        <div class="profile-head-values">
          <div><strong>Dom +${state.rxHeight} m</strong><span>${Math.round(rxGround)} m n.p.m.</span></div>
          <div><strong>Nadajnik +${txHeight} m</strong><span>${Math.round(txGround)} m n.p.m.</span></div>
        </div>
        <svg class="profile-svg pro" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Profil terenu">
          <defs>
            <linearGradient id="terrainFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#22c55e" stop-opacity="0.34"/>
              <stop offset="100%" stop-color="#22c55e" stop-opacity="0.05"/>
            </linearGradient>
            <linearGradient id="fresnelFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.18"/>
              <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.05"/>
            </linearGradient>
            <filter id="softShadow" x="-10%" y="-10%" width="120%" height="120%">
              <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#0f172a" flood-opacity="0.12"/>
            </filter>
          </defs>
          <rect x="${padL}" y="${padT}" width="${chartW}" height="${chartH}" rx="0" fill="#ffffff"/>
          ${ticks.join('')}
          ${dTicks.join('')}
          <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H-padB}" stroke="#94a3b8" stroke-width="1.4"/>
          <line x1="${padL}" y1="${H-padB}" x2="${W-padR}" y2="${H-padB}" stroke="#94a3b8" stroke-width="1.4"/>
          <text x="20" y="${H/2}" transform="rotate(-90 20 ${H/2})" text-anchor="middle" font-size="15" fill="#334155">m n.p.m.</text>
          <text x="${W/2}" y="${H-4}" text-anchor="middle" font-size="15" fill="#475569">Odległość</text>
          <path d="${fresnelArea}" fill="url(#fresnelFill)" stroke="#38bdf8" stroke-width="1.2" stroke-opacity="0.45" vector-effect="non-scaling-stroke"/>
          ${blockedRects.join('')}
          <path d="${terrainArea}" fill="url(#terrainFill)"/>
          <path d="${terrainPath}" fill="none" stroke="#16a34a" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
          <path d="${losPath}" fill="none" stroke="#64748b" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="10 12" vector-effect="non-scaling-stroke"/>
          <circle cx="${padL}" cy="${clamp(y(rxAlt),padT,H-padB).toFixed(1)}" r="7" fill="#2563eb" stroke="#fff" stroke-width="2" vector-effect="non-scaling-stroke"/>
          <circle cx="${W-padR}" cy="${clamp(y(txAlt),padT,H-padB).toFixed(1)}" r="7" fill="#16a34a" stroke="#fff" stroke-width="2" vector-effect="non-scaling-stroke"/>
        </svg>
        <div class="profile-legend"><span><i class="terrain"></i>Profil terenu</span><span><i class="los"></i>Linia LOS</span><span><i class="fresnel"></i>60% strefy Fresnela</span><span><i class="blocked"></i>Przeszkody</span></div>
      </div>
      <div class="${noteClass}"><strong>${msg}</strong><span>Najmniejszy zapas: ${worstTxt} m, w odległości ${worstDTxt} km od punktu odbioru.</span></div>
      <div class="profile-stats"><div><span>Długość trasy</span><strong>${totalDistance.toFixed(1).replace('.',',')} km</strong></div><div><span>Różnica wysokości anten</span><strong>${diffElev>0?'+':''}${diffElev} m</strong></div><div><span>Minimalna wysokość</span><strong>${minElev} m</strong></div><div><span>Maksymalna wysokość</span><strong>${maxElev} m</strong></div><div><span>Kąt LOS</span><strong>${losAngle}°</strong></div></div>
      <div class="profile-meta">${sourceText} Wysokość nadajnika: ${txGroundSource}. Dane DEM są zewnętrzne i mogą mieć ograniczoną dokładność lokalną.</div>`;
  }

  function updateCompass(){
    const t=state.selected; const target=t?Math.round(t.azimuth):0;
    $('targetNeedle').style.transform=`translate(-50%,-100%) rotate(${target}deg)`;
    if(state.heading!=null) $('phoneNeedle').style.transform=`translate(-50%,-100%) rotate(${state.heading}deg)`;

    const northNeedle = $('northNeedle');
    if(northNeedle){
      const northRotation = state.heading == null ? 0 : -state.heading;
      northNeedle.style.transform = `rotate(${northRotation}deg)`;
      northNeedle.classList.toggle('active', state.heading != null);
      $('northBtn').title = state.heading == null
        ? 'Północ / czekam na kompas'
        : `Północ · telefon ${Math.round(state.heading)}°`;
    }

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
    if(typeof e.alpha!=='number') return;
    const source = (e.type === 'deviceorientationabsolute' || e.absolute) ? 'absolute' : 'sensor';
    if(source === 'sensor' && (state.headingSource === 'ios' || state.headingSource === 'absolute')) return;
    applyHeading(e.alpha, source);
  }

  function stopGpsWatch(){
    if(state.gpsWatchId!=null && navigator.geolocation){
      navigator.geolocation.clearWatch(state.gpsWatchId);
      state.gpsWatchId=null;
    }
  }

  function applyGpsPosition(p, pan=true){
    const {latitude, longitude, heading} = p.coords;
    if(!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    state.rx={lat:latitude, lon:longitude, label:'GPS / punkt odbioru'};
    if(Number.isFinite(heading) && heading >= 0 && state.headingSource !== 'ios' && state.headingSource !== 'absolute' && state.headingSource !== 'sensor') applyHeading(heading, 'gps');
    save();
    renderHome();
    renderConnection();
    selectTx(state.selected?.id || bestTx()?.id,false,false);
    if(pan) state.map.setView([latitude,longitude], Math.max(state.map.getZoom(), 12), {animate:true});
  }

  function startGpsWatch(){
    if(!navigator.geolocation) return toast('Brak GPS w tej przeglądarce.');
    // POPRAWKA KRYTYCZNA 19.24 — NIE ZMIENIAĆ BEZ TESTU W TERENIE:
    // Przycisk GPS ma ustawić punkt tylko raz. Nie używać tutaj watchPosition + panTo,
    // bo ciągłe aktualizacje GPS blokują ręczne przesuwanie mapy i wyszukiwarkę miejscowości.
    stopGpsWatch();
    navigator.geolocation.getCurrentPosition(
      p=>{ applyGpsPosition(p, true); toast('Ustawiono punkt z GPS. Mapa nie będzie już automatycznie wracać.'); },
      ()=>toast('Nie udało się pobrać GPS.'),
      {enableHighAccuracy:true, timeout:12000, maximumAge:2500}
    );
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
      <div class="info-card"><strong>Uwaga</strong><span>Wygładzanie jest teraz szybsze i adaptacyjne, więc wskazanie powinno reagować bez dużego opóźnienia. Kompas telefonu nadal może przekłamywać przy maszcie, antenie, blasze, aucie i magnesach. Skalibruj telefon ruchem ósemki.</span></div>`);
    startCompass(true);
    $('manualHeading').oninput=e=>{ $('manualHeadingValue').textContent=`${e.target.value}°`; setManualHeading(e.target.value); };
    $('invertCompassBtn').onclick=()=>{ state.headingInvert=!state.headingInvert; save(); toast(state.headingInvert?'Odwrócono kierunek czujnika.':'Przywrócono standardowy kierunek czujnika.'); };
    $('resetCompassBtn').onclick=()=>{ state.headingOffset=0; state.headingInvert=false; save(); updateCompass(); toast('Zresetowano korektę kompasu.'); };
  }

  function setRx(lat,lon,label,pan,preserveSelected=true, keepZoom=true){
    const keepId = preserveSelected && state.selected?.id ? state.selected.id : null;
    state.rx={lat,lon,label};
    save();
    renderHome();
    renderConnection();
    selectTx(keepId || bestTx()?.id,false,true);
    if(pan){
      if(keepZoom && state.map) state.map.panTo([lat,lon], {animate:true});
      else state.map.setView([lat,lon],12);
    }
  }
  async function search(e){ e.preventDefault(); const q=$('searchInput').value.trim(); if(!q) return; try{ const r=await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=pl&q=${encodeURIComponent(q)}`); const j=await r.json(); if(!j[0]) return toast('Nie znaleziono miejsca.'); setRx(+j[0].lat,+j[0].lon,j[0].display_name.split(',').slice(0,2).join(', '),true,true,false); }catch{toast('Wyszukiwanie wymaga internetu.');} }

  function bind(){
    setDisplayedVersion();
    $('searchForm').onsubmit=search; $('locateBtn').onclick=startGpsWatch; const installBtn=$('installBtn'); if(installBtn) installBtn.onclick=installApp;
    const locationChipBtn = $('locationChip'); if(locationChipBtn) locationChipBtn.onclick=()=>state.map.setView([state.rx.lat,state.rx.lon],12); $('txListBtn').onclick=showTxList; $('northBtn').onclick=()=>{ startCompass(false); toast(state.heading==null?'Włączam kompas. Porusz telefonem, aby wskazać północ.':'Północ wskazuje obrotowa ikona.'); }; $('layersBtn').onclick=showLayers; $('dataBtn').onclick=showData; const aboutBtn=$('aboutBtn'); if(aboutBtn) aboutBtn.onclick=showAbout; $('closePanelBtn').onclick=closePanel;
    $('closeStationBtn').onclick=hideStation; $('openStationBtn').onclick=showStation; $('compassWidget').onclick=()=>{startCompass(false); showCompassPanel();}; $('stationProfileBtn').onclick=showProfile; $('stationMuxBtn').onclick=showMux; $('stationDemBtn').onclick=downloadDemForSelectedTx; $('stationDemCacheBtn').onclick=showSelectedDemStats; $('stationRfBtn').onclick=()=>calculateRfCoverage(); $('stationClearRfBtn').onclick=()=>{ clearRfLayer(); toast('Usunięto obliczony zasięg RF.'); }; $('stationAntBtn').onclick=()=>checkSelectedTransmitterAnt().catch(err=>toast('Błąd sprawdzania ANT: '+(err.message||err))); 
    window.addEventListener('online',()=>{$('onlineChip').textContent='Online';$('onlineChip').classList.add('online-chip');}); window.addEventListener('offline',()=>{$('onlineChip').textContent='Offline';$('onlineChip').classList.remove('online-chip');});
  }
  async function boot(){ load(); setupPwaInstall(); bind(); initMap(); await loadTxs(); if(state.coverageTileUrl) applyCoverageTile(state.coverageTileUrl); startCompass(true); window.addEventListener('pointerdown',()=>startCompass(true),{once:true,passive:true}); if('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js?v=19.27-1905260750').catch(()=>{}); setAppHeight(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
