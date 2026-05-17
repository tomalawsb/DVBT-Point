(() => {
  'use strict';
  const VERSION = '15.0 - 1705261308';
  const Q = '15.0-1705261308';
  const STORE = 'dvbt-point-v15';
  const DEFAULT_RX = { lat: 50.2871, lon: 21.4238, label: 'Mielec / punkt odbioru' };
  const $ = id => document.getElementById(id);
  const saved = safeJson(localStorage.getItem(STORE)) || {};
  const state = { rx: saved.rx || DEFAULT_RX, rxHeight: saved.rxHeight || 6, txs: [], selected: null, base: saved.base || 'osm', mux: saved.mux || 'ALL', heading: saved.heading ?? null, compassOn: false };
  let map, rxMarker, txLayer, lineLayer, distMarker, baseLayer, resizeTimer, profileAbort;

  const rad = d => d*Math.PI/180, deg = r => r*180/Math.PI;
  const km = (a,b) => { const R=6371,dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon),la1=rad(a.lat),la2=rad(b.lat); const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2; return 2*R*Math.asin(Math.sqrt(h)); };
  const bearing = (a,b) => { const p1=rad(a.lat),p2=rad(b.lat),dl=rad(b.lon-a.lon); const y=Math.sin(dl)*Math.cos(p2); const x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl); return (deg(Math.atan2(y,x))+360)%360; };
  const diff = (from,to) => ((to-from+540)%360)-180;
  const fmtKm = n => n < 10 ? `${n.toFixed(1)} km` : `${Math.round(n)} km`;
  function save(){ localStorage.setItem(STORE, JSON.stringify({rx:state.rx, rxHeight:state.rxHeight, base:state.base, mux:state.mux, heading:state.heading})); }
  function safeJson(s){ try{return JSON.parse(s)}catch{return null} }
  function toast(msg){ const t=$('toast'); t.textContent=msg; t.hidden=false; clearTimeout(toast.t); toast.t=setTimeout(()=>t.hidden=true,2400); }

  function initMap(){
    map = L.map('map', { zoomControl:false, attributionControl:true, preferCanvas:true, fadeAnimation:false, markerZoomAnimation:false, zoomAnimation:true, trackResize:true, tap:false }).setView([state.rx.lat,state.rx.lon], 8);
    map.attributionControl.setPrefix('');
    setBase(state.base);
    txLayer=L.layerGroup().addTo(map); lineLayer=L.layerGroup().addTo(map);
    rxMarker=L.marker([state.rx.lat,state.rx.lon], { draggable:true, icon:icon('⌂','rx-icon') }).addTo(map);
    rxMarker.on('dragend',()=>{ const p=rxMarker.getLatLng(); setRx(p.lat,p.lng,'Punkt wskazany na mapie',false); });
    map.on('click',e=>{ if(e.originalEvent.target.closest('.top-ui,.fab-stack,.drawer,.station-sheet,.compass-overlay,.open-station,.toast,.leaflet-control')) return; closeDrawer(); hideSheet(); setRx(e.latlng.lat,e.latlng.lng,'Punkt wskazany na mapie',false); });
    map.whenReady(()=>{ hardResize(); setTimeout(hardResize,300); setTimeout(hardResize,1200); });
    window.addEventListener('resize', queueResize); window.addEventListener('orientationchange',()=>setTimeout(hardResize,400)); document.addEventListener('visibilitychange',()=>{ if(!document.hidden) setTimeout(hardResize,180); });
  }
  function setBase(name){
    if(baseLayer) map.removeLayer(baseLayer);
    state.base=name;
    const opts={maxZoom:19, minZoom:3, keepBuffer:5, updateWhenIdle:true, updateWhenZooming:false, detectRetina:false, crossOrigin:true};
    if(name==='light') baseLayer=L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {...opts, maxZoom:20, attribution:'© OpenStreetMap, © CARTO'});
    else if(name==='terrain') baseLayer=L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {...opts, maxZoom:17, keepBuffer:3, attribution:'© OpenTopoMap'});
    else baseLayer=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {...opts, attribution:'© OpenStreetMap'});
    baseLayer.addTo(map); save(); setTimeout(hardResize,80);
  }
  function queueResize(){ clearTimeout(resizeTimer); resizeTimer=setTimeout(hardResize,80); }
  function hardResize(){ if(!map) return; const el=$('map'); el.style.height='100dvh'; el.style.width='100vw'; map.invalidateSize({pan:false, animate:false}); }
  function icon(txt, cls){ return L.divIcon({className:`dvbt-marker ${cls}`, html:`<span>${txt}</span>`, iconSize:[32,32], iconAnchor:[16,16]}); }

  async function loadTxs(){
    const r=await fetch(`./data/transmitters.json?v=${Q}`, {cache:'no-cache'}); const j=await r.json();
    state.txs=(j.transmitters||[]).map((t,i)=>({
      id:t.id||`tx${i}`, name:t.short_name||t.name||'Nadajnik', full:t.name||t.short_name||'Nadajnik', lat:+t.lat, lon:+t.lon, height:+(t.mast_height_m||t.height_m||80), elevation:+(t.site_elevation_m||0),
      muxes:(t.muxes||[]).map(m=>({name:m.name||m.mux||'MUX', channel:m.channel||'—', frequency:+(m.frequency_mhz||0), erp:+(m.erp_kw||0), pol:m.polarization||'—', band:m.band||'—'}))
    })).filter(t=>Number.isFinite(t.lat)&&Number.isFinite(t.lon));
    renderTxs(); selectBest(); updateLocationChip();
  }
  function txPass(t){ return state.mux==='ALL' || t.muxes.some(m=>m.name===state.mux); }
  function score(t){ const d=km(state.rx,t); const erp=Math.max(1,...t.muxes.map(m=>m.erp)); return d - Math.log10(erp+1)*14 - t.muxes.length*2; }
  function sortedTxs(){ return state.txs.filter(txPass).map(t=>({...t, distance:km(state.rx,t), az:bearing(state.rx,t)})).sort((a,b)=>score(a)-score(b)); }
  function renderTxs(){
    txLayer.clearLayers();
    for(const t of state.txs.filter(txPass)){
      const sel=state.selected && state.selected.id===t.id;
      L.marker([t.lat,t.lon], {icon:icon('📡', sel?'tx-selected':'tx-icon')}).addTo(txLayer).on('click',()=>selectTx(t.id,true));
    }
  }
  function selectBest(show=true){ const first=sortedTxs()[0]; if(first) selectTx(first.id,show); }
  function selectTx(id,show=true){
    const t=state.txs.find(x=>x.id===id); if(!t) return; state.selected={...t, distance:km(state.rx,t), az:bearing(state.rx,t)}; renderTxs(); drawLink(); updateSheet(); updateCompass(); if(show) showSheet();
  }
  function drawLink(){
    lineLayer.clearLayers(); if(!state.selected) return; const t=state.selected;
    const a=[state.rx.lat,state.rx.lon], b=[t.lat,t.lon]; L.polyline([a,b],{color:'#2563eb',weight:3,opacity:.85}).addTo(lineLayer);
    const mid=[(a[0]+b[0])/2,(a[1]+b[1])/2]; distMarker=L.marker(mid,{interactive:false,icon:L.divIcon({className:'distance-label',html:fmtKm(t.distance)})}).addTo(lineLayer);
    state.targetBearing=t.az;
  }
  function setRx(lat,lon,label,pan=true){ state.rx={lat,lon,label}; rxMarker.setLatLng([lat,lon]); if(pan) map.setView([lat,lon], Math.max(map.getZoom(),9)); updateLocationChip(); save(); selectBest(false); hardResize(); }
  function updateLocationChip(){ $('locationChip').textContent='🏠 '+(state.rx.label||'Punkt odbioru'); }
  function updateSheet(){
    const t=state.selected; if(!t) return;
    $('sheetName').textContent=t.name; $('sheetAzimuth').textContent=`${Math.round(t.az)}°`; $('sheetDistance').textContent=fmtKm(t.distance);
    $('sheetPol').textContent=[...new Set(t.muxes.map(m=>m.pol))].join('/')||'—'; $('sheetMux').textContent=t.muxes.map(m=>m.name.replace('MUX-','')).join(' / ')||'—';
    $('openStationBtn').hidden=false;
  }
  function showSheet(){ $('stationSheet').hidden=false; $('openStationBtn').hidden=true; setTimeout(hardResize,60); }
  function hideSheet(){ $('stationSheet').hidden=true; $('openStationBtn').hidden=false; }

  function openDrawer(title, html){ $('drawerTitle').textContent=title; $('drawerBody').innerHTML=html; $('drawer').hidden=false; setTimeout(hardResize,60); }
  function closeDrawer(){ $('drawer').hidden=true; }
  function showTxList(){ const list=sortedTxs().map(t=>`<button class="tx-item ${state.selected?.id===t.id?'active':''}" data-tx="${t.id}"><strong>${esc(t.name)}</strong><span>${fmtKm(t.distance)} · azymut ${Math.round(t.az)}° · ${t.muxes.map(m=>m.name.replace('MUX-','')).join('/')}</span></button>`).join(''); openDrawer('Nadajniki',`<div class="panel-list">${list}</div>`); $('drawerBody').querySelectorAll('[data-tx]').forEach(b=>b.onclick=()=>{selectTx(b.dataset.tx,true); closeDrawer();}); }
  function showMux(){ const t=state.selected; if(!t) return; const rows=t.muxes.map(m=>`<div class="tx-item"><strong>${esc(m.name)} · ${esc(m.channel)}</strong><span>${m.frequency||'—'} MHz · ERP ${m.erp||'—'} kW · ${esc(m.pol)} / ${esc(m.band)}</span></div>`).join(''); openDrawer('Multipleksy',`<div class="panel-list">${rows}</div>`); }
  function showFilters(){ const muxes=['ALL',...[...new Set(state.txs.flatMap(t=>t.muxes.map(m=>m.name)))].sort()]; const html=`<div class="panel-list">${muxes.map(m=>`<button class="tx-item ${state.mux===m?'active':''}" data-mux="${m}"><strong>${m==='ALL'?'Wszystkie MUX-y':m}</strong><span>Filtr nadajników na mapie i liście</span></button>`).join('')}</div>`; openDrawer('Filtry MUX',html); $('drawerBody').querySelectorAll('[data-mux]').forEach(b=>b.onclick=()=>{state.mux=b.dataset.mux; save(); renderTxs(); selectBest(false); closeDrawer();}); }
  function showLayers(){ openDrawer('Warstwy mapy',`<div class="panel-list"><button class="tx-item ${state.base==='osm'?'active':''}" data-base="osm"><strong>Mapa standardowa</strong><span>Najstabilniejsza na telefonie</span></button><button class="tx-item ${state.base==='light'?'active':''}" data-base="light"><strong>Mapa jasna</strong><span>Lżejsza wizualnie</span></button><button class="tx-item ${state.base==='terrain'?'active':''}" data-base="terrain"><strong>Mapa terenowa</strong><span>Może ładować się wolniej</span></button></div>`); $('drawerBody').querySelectorAll('[data-base]').forEach(b=>b.onclick=()=>{setBase(b.dataset.base); closeDrawer();}); }
  function showData(){ openDrawer('Dane i API',`<div class="panel-list"><div class="control-card"><strong>Profil terenu</strong><br><span>Realny: Open-Meteo Elevation API. Brak trybu demo — gdy API nie odpowie, pokazuję błąd.</span></div><div class="control-card"><strong>Nadajniki</strong><br><span>Baza lokalna: data/transmitters.json. Można podmienić na eksport z UKE/Emitela/RadioPolska zgodnie z licencją.</span></div><div class="control-card"><strong>Płatne API / kafelki</strong><br><span>Tu później można podpiąć licencjonowany URL warstwy pokrycia albo własne kafelki GeoJSON/XYZ.</span></div><button class="action primary" id="updateAppBtn">Wymuś aktualizację PWA</button></div>`); $('updateAppBtn').onclick=async()=>{ const regs=await navigator.serviceWorker?.getRegistrations?.()||[]; for(const r of regs) await r.update(); location.reload(); }; }

  async function showProfile(){
    const t=state.selected; if(!t) return toast('Najpierw wybierz nadajnik');
    openDrawer('Profil terenu', `<div class="panel-list"><div class="row"><label>Wysokość anteny</label><input id="rxHeightInput" type="number" min="1" max="40" value="${state.rxHeight}"> m</div><div id="profileBox" class="control-card">Pobieram realny profil terenu...</div></div>`);
    $('rxHeightInput').onchange=e=>{state.rxHeight=Math.max(1,Math.min(40,+e.target.value||6)); save(); showProfile();};
    try{ const p=await fetchProfile(state.rx,t); renderProfile(p,t); }catch(err){ $('profileBox').innerHTML=`<strong>Błąd profilu</strong><br><span>${esc(err.message||'Nie udało się pobrać realnych wysokości terenu.')}</span>`; }
  }
  async function fetchProfile(a,t){
    if(profileAbort) profileAbort.abort(); profileAbort=new AbortController();
    const n=80; const lats=[], lons=[]; for(let i=0;i<n;i++){ const f=i/(n-1); lats.push(a.lat+(t.lat-a.lat)*f); lons.push(a.lon+(t.lon-a.lon)*f); }
    const url=`https://api.open-meteo.com/v1/elevation?latitude=${lats.map(x=>x.toFixed(5)).join(',')}&longitude=${lons.map(x=>x.toFixed(5)).join(',')}`;
    const r=await fetch(url,{signal:profileAbort.signal}); if(!r.ok) throw new Error('Open-Meteo Elevation API nie odpowiedziało.'); const j=await r.json(); const elev=j.elevation||[]; if(elev.length<n) throw new Error('API zwróciło niepełne dane wysokości.'); return elev.map((e,i)=>({d:t.distance*i/(n-1), e:+e}));
  }
  function renderProfile(p,t){
    const rxAlt=p[0].e+state.rxHeight, txAlt=p[p.length-1].e+(t.height||60); const min=Math.min(...p.map(x=>x.e))-20, max=Math.max(txAlt,...p.map(x=>x.e))+30; const W=600,H=180, pad=28;
    const x=d=>pad+(W-pad*2)*(d/t.distance), y=e=>H-pad-(H-pad*2)*((e-min)/(max-min));
    const terrain=p.map((pt,i)=>`${i?'L':'M'}${x(pt.d).toFixed(1)},${y(pt.e).toFixed(1)}`).join(' '); const area=`M${pad},${H-pad} ${terrain} L${W-pad},${H-pad} Z`;
    let worst=999, worstD=0; p.forEach(pt=>{ const los=rxAlt+(txAlt-rxAlt)*(pt.d/t.distance); const margin=los-pt.e; if(margin<worst){worst=margin; worstD=pt.d;} });
    const cls=worst<0?'Silne zasłonięcie terenu':worst<20?'Częściowe zasłonięcie terenu':'Profil wygląda czysto';
    $('profileBox').innerHTML=`<svg class="profile-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${area}" fill="#dcfce7" stroke="none"/><path d="${terrain}" fill="none" stroke="#16a34a" stroke-width="3"/><line x1="${pad}" y1="${y(rxAlt)}" x2="${W-pad}" y2="${y(txAlt)}" stroke="#2563eb" stroke-dasharray="7 6" stroke-width="2"/><circle cx="${pad}" cy="${y(rxAlt)}" r="5" fill="#2563eb"/><circle cx="${W-pad}" cy="${y(txAlt)}" r="5" fill="#16a34a"/><text x="${pad}" y="18" font-size="13" font-weight="800">Dom +${state.rxHeight} m</text><text x="${W-pad-90}" y="18" font-size="13" font-weight="800">Nadajnik +${t.height} m</text></svg><div class="profile-note">${cls}. Najmniejszy zapas: ${Math.round(worst)} m, około ${worstD.toFixed(1)} km od punktu odbioru.</div>`;
  }

  function updateCompass(){ const t=state.selected; const target=t?Math.round(t.az):null; $('targetNeedle').style.transform=`translate(-50%,-100%) rotate(${target||0}deg)`; if(state.heading!=null) $('phoneNeedle').style.transform=`translate(-50%,-100%) rotate(${state.heading}deg)`; const d=state.heading==null?null:diff(state.heading,target); let txt='Włącz kompas'; if(d!=null){ const ad=Math.abs(Math.round(d)); txt=ad<=5?'Kierunek prawidłowy':`Obróć ${ad}° w ${d>0?'prawo':'lewo'}`; } $('turnText').textContent=txt; $('headingText').textContent=`Telefon: ${state.heading==null?'—':Math.round(state.heading)+'°'} · Cel: ${target==null?'—':target+'°'}`; }
  async function startCompass(){ $('compassOverlay').hidden=false; state.compassOn=true; if(window.DeviceOrientationEvent?.requestPermission){ try{ const p=await DeviceOrientationEvent.requestPermission(); if(p!=='granted') throw new Error(); }catch{ toast('Brak zgody na czujnik kierunku.'); } }
    window.addEventListener('deviceorientationabsolute', onOrientation, true); window.addEventListener('deviceorientation', onOrientation, true); updateCompass(); }
  function onOrientation(e){ let h=null; if(typeof e.webkitCompassHeading==='number') h=e.webkitCompassHeading; else if(typeof e.alpha==='number') h=(360-e.alpha)%360; if(h!=null){state.heading=h; $('compassNote').textContent='Tryb czujnika telefonu.'; updateCompass(); save();} }
  function stopCompass(){ state.compassOn=false; window.removeEventListener('deviceorientationabsolute', onOrientation, true); window.removeEventListener('deviceorientation', onOrientation, true); $('compassOverlay').hidden=true; }

  async function search(e){ e.preventDefault(); const q=$('searchInput').value.trim(); if(!q) return; try{ const r=await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=pl&q=${encodeURIComponent(q)}`); const j=await r.json(); if(!j[0]) return toast('Nie znaleziono miejsca.'); setRx(+j[0].lat,+j[0].lon,j[0].display_name.split(',').slice(0,2).join(', '),true); }catch{ toast('Wyszukiwanie wymaga internetu.'); } }
  function esc(s){ return String(s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
  function initEvents(){
    $('searchForm').onsubmit=search; $('gpsBtn').onclick=()=>navigator.geolocation?.getCurrentPosition(p=>setRx(p.coords.latitude,p.coords.longitude,'GPS / punkt odbioru',true),()=>toast('Nie udało się pobrać GPS.'),{enableHighAccuracy:true,timeout:10000});
    $('txListBtn').onclick=showTxList; $('layersBtn').onclick=showLayers; $('filtersBtn').onclick=showFilters; $('dataBtn').onclick=showData; $('profileBtn').onclick=showProfile; $('sheetProfileBtn').onclick=showProfile; $('sheetMuxBtn').onclick=showMux; $('antennaBtn').onclick=startCompass; $('compassBtn').onclick=()=> $('compassOverlay').hidden ? startCompass() : stopCompass(); $('compassClose').onclick=stopCompass;
    $('sheetClose').onclick=hideSheet; $('openStationBtn').onclick=showSheet; $('drawerClose').onclick=closeDrawer; $('locationChip').onclick=()=>{ map.setView([state.rx.lat,state.rx.lon],12); hardResize(); };
    window.addEventListener('online',()=>{$('onlineChip').textContent='Online';$('onlineChip').classList.add('chip-online')}); window.addEventListener('offline',()=>{$('onlineChip').textContent='Offline';$('onlineChip').classList.remove('chip-online')});
  }
  async function boot(){ initEvents(); initMap(); await loadTxs(); if('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(()=>{}); }
  boot().catch(e=>{ console.error(e); toast('Błąd startu aplikacji.'); });
})();
