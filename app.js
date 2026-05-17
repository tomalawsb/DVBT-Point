(() => {
  'use strict';
  const APP_VERSION = '16.0 - 1705261322';
  const STORE = 'dvbt-point-v16-state';
  const $ = id => document.getElementById(id);
  const state = {
    map:null, baseLayer:null, base:'osm', rx:{lat:50.2871, lon:21.4238, label:'Mielec / punkt odbioru'}, rxHeight:6,
    txs:[], selected:null, markers:L.layerGroup(), line:null, range:null, homeMarker:null, heading:null, compassOn:false
  };
  let profileAbort = null;

  function setAppHeight(){
    const h = Math.round((window.visualViewport && window.visualViewport.height) || window.innerHeight || document.documentElement.clientHeight);
    document.documentElement.style.setProperty('--app-h', `${h}px`);
    if (state.map) requestAnimationFrame(() => state.map.invalidateSize(true));
  }
  setAppHeight();
  window.addEventListener('resize', setAppHeight);
  window.visualViewport?.addEventListener('resize', setAppHeight);
  window.addEventListener('orientationchange', () => setTimeout(setAppHeight, 250));

  function save(){ localStorage.setItem(STORE, JSON.stringify({rx:state.rx, rxHeight:state.rxHeight, base:state.base, selectedId:state.selected?.id || null})); }
  function load(){ try{ const s=JSON.parse(localStorage.getItem(STORE)||'{}'); Object.assign(state, {rx:s.rx||state.rx, rxHeight:s.rxHeight||state.rxHeight, base:s.base||state.base}); state._selectedId=s.selectedId; }catch{} }
  function toast(msg){ const t=$('toast'); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>t.hidden=true,2600); }
  function esc(s){ return String(s ?? '').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function rad(d){ return d*Math.PI/180; }
  function dist(a,b){ const R=6371; const dLat=rad(b.lat-a.lat), dLon=rad(b.lon-a.lon); const x=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2; return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)); }
  function az(a,b){ const y=Math.sin(rad(b.lon-a.lon))*Math.cos(rad(b.lat)); const x=Math.cos(rad(a.lat))*Math.sin(rad(b.lat))-Math.sin(rad(a.lat))*Math.cos(rad(b.lat))*Math.cos(rad(b.lon-a.lon)); return (Math.atan2(y,x)*180/Math.PI+360)%360; }
  function diff(from,to){ return ((to-from+540)%360)-180; }
  function fmtKm(k){ return k<10 ? `${k.toFixed(1)} km` : `${Math.round(k)} km`; }
  function muxNames(t){ return [...new Set((t.muxes||[]).map(m=>m.name))]; }
  function pols(t){ return [...new Set((t.muxes||[]).map(m=>m.polarization||m.pol).filter(Boolean))].join('/') || '—'; }

  function normalizeTx(raw){
    const muxes=(raw.muxes||[]).map(m=>({name:m.name||m.mux||'MUX', channel:m.channel||m.kanal||'—', frequency_mhz:m.frequency_mhz||m.frequency||m.czestotliwosc||'', erp_kw:m.erp_kw||m.erp||'', polarization:m.polarization||m.pol||'—', band:m.band||'—'}));
    return {...raw, short_name:raw.short_name||raw.name, height:raw.mast_height_m||raw.height||60, muxes};
  }

  function initMap(){
    state.map = L.map('map', {center:[state.rx.lat,state.rx.lon], zoom:8, minZoom:5, maxZoom:18, zoomControl:false, attributionControl:true, inertia:true, tap:true, preferCanvas:true});
    L.control.zoom({position:'bottomright'}).addTo(state.map);
    state.markers.addTo(state.map);
    setBase(state.base, false);
    state.map.on('click', () => { closePanel(); });
    state.map.on('resize zoomend moveend', () => state.map.invalidateSize(true));
    state.map.on('contextmenu', e => setRx(e.latlng.lat, e.latlng.lng, 'Punkt wskazany na mapie', true));
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
    setTimeout(()=>state.map.invalidateSize(true),80);
    if(persist) save();
  }
  async function loadTxs(){
    const r=await fetch(`data/transmitters.json?v=${Date.now()}`, {cache:'no-store'});
    const j=await r.json();
    state.txs=(j.transmitters||j).map(normalizeTx).filter(t=>Number.isFinite(+t.lat)&&Number.isFinite(+t.lon));
    renderAll();
    selectTx(state._selectedId || bestTx()?.id, true, false);
  }
  function bestTx(){ return sortedTxs()[0]; }
  function sortedTxs(){ return state.txs.map(t=>({...t, distance:dist(state.rx,t), azimuth:az(state.rx,t)})).sort((a,b)=>a.distance-b.distance); }
  function txById(id){ return sortedTxs().find(t=>t.id===id); }
  function passesFilter(t){ return true; }

  function renderAll(){ renderHome(); renderTxMarkers(); }
  function renderHome(){
    if(state.homeMarker) state.map.removeLayer(state.homeMarker);
    const icon=L.divIcon({html:'<div class="home-marker">🏠</div>', className:'', iconSize:[32,32], iconAnchor:[16,16]});
    state.homeMarker=L.marker([state.rx.lat,state.rx.lon], {icon, draggable:true}).addTo(state.map);
    state.homeMarker.on('dragend', e=>setRx(e.target.getLatLng().lat, e.target.getLatLng().lng, 'Punkt wskazany na mapie', false));
    $('locationChip').textContent = `🏠 ${state.rx.label || 'Punkt odbioru'}`;
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
    $('stationMux').textContent=muxNames(t).map(x=>x.replace('MUX-','')).join(' / ') || '—';
  }

  function openPanel(title, subtitle, html){ $('panelTitle').textContent=title; $('panelSubtitle').textContent=subtitle||''; $('panelContent').innerHTML=html; $('appPanel').classList.remove('collapsed'); setTimeout(()=>state.map.invalidateSize(true),80); }
  function closePanel(){ $('appPanel').classList.add('collapsed'); }
  function showTxList(){
    const html=sortedTxs().map(t=>`<button class="tx-item ${state.selected?.id===t.id?'active':''}" data-tx="${esc(t.id)}"><strong>${esc(t.short_name||t.name)}</strong><span>${fmtKm(t.distance)} · azymut ${Math.round(t.azimuth)}° · MUX ${muxNames(t).map(m=>m.replace('MUX-','')).join('/')}</span></button>`).join('');
    openPanel('Nadajniki','Lista według odległości od punktu odbioru.',html);
    $('panelContent').querySelectorAll('[data-tx]').forEach(b=>b.onclick=()=>{selectTx(b.dataset.tx,true,true); closePanel();});
  }
  function showMux(){
    const t=state.selected; if(!t) return;
    const rows=t.muxes.map(m=>`<div class="tx-item"><strong>${esc(m.name)} · ${esc(m.channel)}</strong><span>${m.frequency_mhz||'—'} MHz · ERP ${m.erp_kw||'—'} kW · pol. ${esc(m.polarization)} · ${esc(m.band)}</span></div>`).join('');
    openPanel('MUX-y', t.short_name||t.name, rows);
  }
  function showLayers(){
    openPanel('Warstwy','Podkład mapy.', `<button class="tx-item ${state.base==='osm'?'active':''}" data-base="osm"><strong>Plan OSM</strong><span>Najstabilniejsza mapa.</span></button><button class="tx-item ${state.base==='light'?'active':''}" data-base="light"><strong>Jasna CARTO</strong><span>Lżejsza wizualnie.</span></button><button class="tx-item ${state.base==='sat'?'active':''}" data-base="sat"><strong>Satelita Esri</strong><span>Cięższa, wymaga internetu.</span></button>`);
    $('panelContent').querySelectorAll('[data-base]').forEach(b=>b.onclick=()=>{setBase(b.dataset.base); closePanel();});
  }
  function showFilters(){
    const all=[...new Set(state.txs.flatMap(t=>muxNames(t)))].sort();
    openPanel('Filtry MUX','W tej wersji filtr jest przygotowany do rozbudowy.', all.map(m=>`<div class="info-card"><strong>${esc(m)}</strong><span>Dostępny w bazie nadajników.</span></div>`).join(''));
  }
  function showData(){
    openPanel('Dane / API','Status źródeł danych.', `<div class="info-card"><strong>Profil terenu</strong><span>Prawdziwy profil z Open-Meteo Elevation API. Brak profilu demo.</span></div><div class="info-card"><strong>Nadajniki</strong><span>Ładowane z data/transmitters.json. Można podmienić na legalny eksport CSV/JSON.</span></div><button id="refreshPwa" class="panel-btn primary">Wymuś aktualizację PWA</button>`);
    $('refreshPwa').onclick=async()=>{ const regs=await navigator.serviceWorker?.getRegistrations?.()||[]; for(const r of regs){ await r.unregister(); } const keys=await caches.keys(); await Promise.all(keys.map(k=>caches.delete(k))); location.reload(); };
  }

  async function showProfile(){
    const t=state.selected; if(!t) return toast('Najpierw wybierz nadajnik.');
    openPanel('Profil terenu', `${state.rx.label} → ${t.short_name||t.name}`, `<div class="row info-card"><strong>Wysokość anteny</strong><input id="rxHeight" type="number" min="1" max="40" value="${state.rxHeight}"></div><div id="profileBox" class="info-card"><strong>Pobieram realny profil...</strong><span>Open-Meteo Elevation API</span></div>`);
    $('rxHeight').onchange=e=>{state.rxHeight=Math.max(1,Math.min(40,+e.target.value||6)); save(); showProfile();};
    try{ const p=await fetchProfile(state.rx,t); renderProfile(p,t); }catch(err){ $('profileBox').innerHTML=`<strong>Błąd profilu terenu</strong><span>${esc(err.message||'Nie udało się pobrać realnych danych wysokości.')}</span>`; }
  }
  async function fetchProfile(a,t){
    if(profileAbort) profileAbort.abort(); profileAbort=new AbortController();
    const n=90, lats=[], lons=[]; for(let i=0;i<n;i++){ const f=i/(n-1); lats.push(a.lat+(t.lat-a.lat)*f); lons.push(a.lon+(t.lon-a.lon)*f); }
    const url=`https://api.open-meteo.com/v1/elevation?latitude=${lats.map(x=>x.toFixed(5)).join(',')}&longitude=${lons.map(x=>x.toFixed(5)).join(',')}`;
    const r=await fetch(url,{signal:profileAbort.signal}); if(!r.ok) throw new Error('Open-Meteo Elevation API nie odpowiedziało.');
    const j=await r.json(); if(!Array.isArray(j.elevation)||j.elevation.length<n) throw new Error('API zwróciło niepełny profil.');
    return j.elevation.map((e,i)=>({d:t.distance*i/(n-1), e:+e}));
  }
  function renderProfile(p,t){
    const rxAlt=p[0].e+state.rxHeight, txAlt=p[p.length-1].e+(+t.height||60); const min=Math.min(...p.map(x=>x.e))-30, max=Math.max(txAlt,rxAlt,...p.map(x=>x.e))+40; const W=620,H=210,pad=30;
    const x=d=>pad+(W-pad*2)*(d/t.distance), y=e=>H-pad-(H-pad*2)*((e-min)/(max-min));
    const path=p.map((pt,i)=>`${i?'L':'M'}${x(pt.d).toFixed(1)},${y(pt.e).toFixed(1)}`).join(' '); const area=`M${pad},${H-pad} ${path} L${W-pad},${H-pad} Z`;
    let worst=999, worstD=0; for(const pt of p){ const los=rxAlt+(txAlt-rxAlt)*(pt.d/t.distance); const margin=los-pt.e; if(margin<worst){worst=margin; worstD=pt.d;} }
    const msg=worst<0?'Silne zasłonięcie terenu':worst<20?'Częściowe zasłonięcie terenu':'Profil wygląda czysto';
    $('profileBox').innerHTML=`<svg class="profile-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${area}" fill="#dcfce7"/><path d="${path}" fill="none" stroke="#16a34a" stroke-width="3"/><line x1="${pad}" y1="${y(rxAlt)}" x2="${W-pad}" y2="${y(txAlt)}" stroke="#2563eb" stroke-dasharray="7 6" stroke-width="2"/><circle cx="${pad}" cy="${y(rxAlt)}" r="5" fill="#2563eb"/><circle cx="${W-pad}" cy="${y(txAlt)}" r="5" fill="#16a34a"/><text x="${pad}" y="18" font-size="13" font-weight="850">Dom +${state.rxHeight} m</text><text x="${W-pad-110}" y="18" font-size="13" font-weight="850">Nadajnik +${t.height||60} m</text></svg><div class="profile-note">${msg}. Najmniejszy zapas: ${Math.round(worst)} m, około ${worstD.toFixed(1)} km od punktu odbioru.</div>`;
  }

  function updateCompass(){
    const t=state.selected; const target=t?Math.round(t.azimuth):0; $('targetNeedle').style.transform=`translate(-50%,-100%) rotate(${target}deg)`; if(state.heading!=null) $('phoneNeedle').style.transform=`translate(-50%,-100%) rotate(${state.heading}deg)`;
    let txt='Dotknij, aby włączyć'; if(state.heading!=null && t){ const d=diff(state.heading,target); const a=Math.abs(Math.round(d)); txt=a<=5?'Kierunek prawidłowy':`Obróć ${a}° w ${d>0?'prawo':'lewo'}`; }
    $('turnText').textContent=txt; $('headingText').textContent=`Telefon: ${state.heading==null?'—':Math.round(state.heading)+'°'} · Cel: ${t?target+'°':'—'}`;
  }
  async function startCompass(){
    if(window.DeviceOrientationEvent?.requestPermission){ try{ const p=await DeviceOrientationEvent.requestPermission(); if(p!=='granted') return toast('Brak zgody na kompas.'); }catch{return toast('Przeglądarka nie udostępniła kompasu.');} }
    window.addEventListener('deviceorientationabsolute', onOrientation, true); window.addEventListener('deviceorientation', onOrientation, true); toast('Kompas włączony.');
  }
  function onOrientation(e){ let h=null; if(typeof e.webkitCompassHeading==='number') h=e.webkitCompassHeading; else if(typeof e.alpha==='number') h=(360-e.alpha)%360; if(h!=null){state.heading=h; updateCompass();} }

  function setRx(lat,lon,label,pan){ state.rx={lat,lon,label}; save(); renderHome(); renderConnection(); selectTx(bestTx()?.id,false,true); if(pan) state.map.setView([lat,lon],12); }
  async function search(e){ e.preventDefault(); const q=$('searchInput').value.trim(); if(!q) return; try{ const r=await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=pl&q=${encodeURIComponent(q)}`); const j=await r.json(); if(!j[0]) return toast('Nie znaleziono miejsca.'); setRx(+j[0].lat,+j[0].lon,j[0].display_name.split(',').slice(0,2).join(', '),true); }catch{toast('Wyszukiwanie wymaga internetu.');} }

  function bind(){
    $('searchForm').onsubmit=search; $('locateBtn').onclick=()=>navigator.geolocation?.getCurrentPosition(p=>setRx(p.coords.latitude,p.coords.longitude,'GPS / punkt odbioru',true),()=>toast('Nie udało się pobrać GPS.'),{enableHighAccuracy:true,timeout:10000});
    $('locationChip').onclick=()=>state.map.setView([state.rx.lat,state.rx.lon],12); $('txListBtn').onclick=showTxList; $('profileBtn').onclick=showProfile; $('layersBtn').onclick=showLayers; $('filtersBtn').onclick=showFilters; $('dataBtn').onclick=showData; $('closePanelBtn').onclick=closePanel;
    $('closeStationBtn').onclick=hideStation; $('openStationBtn').onclick=showStation; $('antennaBtn').onclick=startCompass; $('compassWidget').onclick=startCompass; $('stationProfileBtn').onclick=showProfile; $('stationMuxBtn').onclick=showMux;
    window.addEventListener('online',()=>{$('onlineChip').textContent='Online';$('onlineChip').classList.add('online-chip');}); window.addEventListener('offline',()=>{$('onlineChip').textContent='Offline';$('onlineChip').classList.remove('online-chip');});
  }
  async function boot(){ load(); bind(); initMap(); await loadTxs(); if('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js?v=16.0-1705261322').catch(()=>{}); setAppHeight(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
