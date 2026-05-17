const VERSION = "11.0 - 1705261630";
const DEFAULT_HOME = { lat: 50.2865, lon: 21.4239, name: "Mielec / punkt odbioru", source: "default" };
const ALL_MUX = ["MUX-1", "MUX-2", "MUX-3", "MUX-6", "MUX-8"];
const STORAGE_KEY = "dvbt-mapa.home";
const OVERLAY_STORAGE_KEY = "dvbt-mapa.layers";
const MUX_STORAGE_KEY = "dvbt-mapa.muxFilters";
const BASE_LAYER_STORAGE_KEY = "dvbt-mapa.baseLayer";
const COVERAGE_STORAGE_KEY = "dvbt-mapa.coverage";
const CUSTOM_TRANSMITTERS_KEY = "dvbt-mapa.customTransmitters";
const CUSTOM_TRANSMITTERS_META_KEY = "dvbt-mapa.customTransmittersMeta";

const state = {
  map: null,
  activeLayerName: loadSavedBaseLayer(),
  baseLayers: {},
  activeBaseLayer: null,
  home: loadSavedHome(),
  homeMarker: null,
  transmitters: [],
  txMarkers: new Map(),
  selectedTx: null,
  linkLine: null,
  distanceLabel: null,
  compassHeading: null,
  activeMuxFilters: loadSavedMuxFilters(),
  overlays: loadOverlaySettings(),
  profileAbortController: null,
  profileRequestId: 0,
  profile: null,
  receiverAntennaHeightM: loadSavedAntennaHeight(),
  dataAbortController: null,
  searchAbortController: null,
  gpsInProgress: false,
  compassActive: false,
  compassPermission: "unknown",
  compassMode: "auto",
  manualHeading: 0,
  orientationHandler: null,
  deferredInstallPrompt: null,
  swRegistration: null,
  updateWaiting: false,
  coverageLayer: null,
  coverageVisible: loadSavedCoverageVisible(),
  coverageAbortController: null,
  coverageRequestId: 0,
  coverageSummary: null,
  transmittersMeta: loadTransmittersMeta()
};

const $ = (id) => document.getElementById(id);

window.addEventListener("DOMContentLoaded", init);

async function init() {
  document.title = `DVB-T/T2 Mapa Instalatora ${VERSION}`;
  $("versionChip").textContent = VERSION;
  $("locationName").textContent = state.home.name;
  initMap();
  bindUi();
  await loadTransmitters();
  selectBestTransmitter();
  $("antennaHeightInput").value = String(state.receiverAntennaHeightM);
  refreshTerrainProfile();
  initCoverageLayer();
  if (state.coverageVisible) refreshCoverageLayer();
  initPwaStatus();
  registerServiceWorker();
  showToast(`Uruchomiono Etap 11 — ${VERSION}`);
}

function initMap() {
  state.map = L.map("map", {
    zoomControl: false,
    preferCanvas: true,
    worldCopyJump: true
  }).setView([state.home.lat, state.home.lon], 9);

  const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  });

  const topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    maxZoom: 17,
    attribution: "&copy; OpenStreetMap, SRTM, OpenTopoMap"
  });

  const esri = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "Tiles &copy; Esri"
  });

  const carto = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 20,
    attribution: "&copy; OpenStreetMap &copy; CARTO"
  });

  state.baseLayers = {
    "Mapa standardowa": osm,
    "Mapa terenowa": topo,
    "Satelita": esri,
    "Jasna mapa": carto
  };
  state.activeBaseLayer = state.baseLayers[state.activeLayerName] || osm;
  if (!state.baseLayers[state.activeLayerName]) state.activeLayerName = "Mapa standardowa";
  state.activeBaseLayer.addTo(state.map);

  state.homeMarker = L.marker([state.home.lat, state.home.lon], {
    draggable: true,
    icon: L.divIcon({
      className: "",
      html: `<div class="home-marker">⌂</div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    })
  }).addTo(state.map).bindTooltip("Punkt odbioru", { permanent: false });

  state.homeMarker.on("dragend", () => {
    const pos = state.homeMarker.getLatLng();
    updateHome({ lat: pos.lat, lon: pos.lng, name: "Punkt przesunięty na mapie", source: "drag" }, { chooseBest: true, save: true });
  });

  state.map.on("click", (e) => {
    updateHome({ lat: e.latlng.lat, lon: e.latlng.lng, name: "Punkt wskazany na mapie", source: "map" }, { chooseBest: true, save: true });
    showToast("Ustawiono punkt odbioru z mapy");
  });

  L.control.zoom({ position: "bottomright" }).addTo(state.map);
}

function bindUi() {
  $("gpsBtn").addEventListener("click", useGps);
  $("compassBtn").addEventListener("click", showCompassPanel);
  $("txBtn").addEventListener("click", showTransmittersPanel);
  $("layersBtn").addEventListener("click", showLayersPanel);
  $("filterBtn").addEventListener("click", showFiltersPanel);
  $("coverageBtn")?.addEventListener("click", showCoveragePanel);
  $("profileBtn").addEventListener("click", () => {
    $("bottomSheet").classList.remove("collapsed");
    $("profileBox").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  $("reportBtn").addEventListener("click", showReportPanel);
  $("pwaBtn")?.addEventListener("click", showPwaPanel);
  $("showMuxBtn").addEventListener("click", () => $("muxTable").scrollIntoView({ behavior: "smooth", block: "nearest" }));
  $("showProfileBtn").addEventListener("click", () => $("profileBox").scrollIntoView({ behavior: "smooth", block: "nearest" }));
  $("refreshProfileBtn").addEventListener("click", () => refreshTerrainProfile({ force: true }));
  $("antennaHeightInput").addEventListener("change", () => {
    const value = clamp(Number($("antennaHeightInput").value), 1, 40);
    state.receiverAntennaHeightM = value;
    $("antennaHeightInput").value = String(value);
    saveAntennaHeight(value);
    refreshTerrainProfile({ force: true });
  });
  $("showReportBtn").addEventListener("click", showReportPanel);
  $("aimBtn").addEventListener("click", () => {
    $("compassCard").classList.add("visible");
    showCompassPanel();
    startCompass();
    updateCompassHint();
  });
  $("sheetHandle").addEventListener("click", () => $("bottomSheet").classList.toggle("collapsed"));
  $("closeSidePanel").addEventListener("click", hideSidePanel);
  $("searchBtn").addEventListener("click", handleSearch);
  $("addressInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSearch();
  });
  $("locationChip").addEventListener("click", showLocationPanel);
}

async function loadTransmitters() {
  try {
    const custom = loadCustomTransmitters();
    if (custom?.length) {
      state.transmitters = custom.map(normalizeTransmitter);
      state.transmittersMeta = loadTransmittersMeta();
      renderTransmitters();
      showToast("Wczytano lokalnie zaimportowaną bazę nadajników");
      return;
    }

    if (state.dataAbortController) state.dataAbortController.abort();
    state.dataAbortController = new AbortController();
    const response = await fetch("./data/transmitters.json", {
      cache: "no-store",
      signal: state.dataAbortController.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.transmitters = data.map(normalizeTransmitter);
    state.transmittersMeta = {
      mode: "demo",
      source: "Plik demonstracyjny ./data/transmitters.json",
      updatedAt: "brak — dane testowe",
      license: "Nie używać jako oficjalnej bazy nadajników",
      count: state.transmitters.length
    };
    renderTransmitters();
  } catch (error) {
    if (error.name === "AbortError") return;
    showToast("Nie udało się wczytać bazy nadajników");
    console.error(error);
  }
}

function normalizeTransmitter(tx) {
  const muxes = Array.isArray(tx.muxes) ? tx.muxes.map(normalizeMux) : [];
  const muxNames = muxes.map((item) => item.mux).filter(Boolean);
  const polarizations = [...new Set(muxes.map((item) => item.polarization).filter(Boolean))].join("/");
  return {
    ...tx,
    id: tx.id || slugify(`${tx.name || tx.site || "nadajnik"}-${tx.lat}-${tx.lon}`),
    name: tx.name || tx.site || "Nadajnik bez nazwy",
    site: tx.site || tx.name || "",
    lat: Number(tx.lat),
    lon: Number(tx.lon),
    height_m: Number(tx.height_m || tx.height || 0),
    mast_m: Number(tx.mast_m || tx.antenna_height_m || tx.mast || 80),
    muxes,
    muxNames,
    polarizations
  };
}

function normalizeMux(item) {
  const frequency = Number(item.frequency_mhz || item.frequency || item.freq_mhz || 0);
  return {
    mux: String(item.mux || "").trim(),
    channel: String(item.channel || item.kanal || "").trim(),
    frequency_mhz: Number.isFinite(frequency) ? frequency : 0,
    erp_kw: Number(item.erp_kw || item.erp || item.power_kw || 0),
    polarization: String(item.polarization || item.polaryzacja || "?").trim().toUpperCase(),
    band: item.band || inferBand(frequency)
  };
}

function inferBand(frequencyMhz) {
  if (frequencyMhz >= 174 && frequencyMhz <= 230) return "VHF";
  if (frequencyMhz >= 470 && frequencyMhz <= 694) return "UHF";
  return "?";
}

function renderTransmitters() {
  state.txMarkers.forEach((marker) => marker.remove());
  state.txMarkers.clear();

  for (const tx of state.transmitters) {
    const marker = L.marker([tx.lat, tx.lon], { icon: createTxIcon(tx) }).addTo(state.map);
    marker.bindTooltip(`<span class="tx-tooltip">${escapeHtml(tx.name)}</span>`, { direction: "top", offset: [0, -12] });
    marker.on("click", () => selectTransmitter(tx.id, true));
    state.txMarkers.set(tx.id, marker);
  }
  applyFilters();
}

function createTxIcon(tx) {
  const selected = state.selectedTx?.id === tx.id;
  return L.divIcon({
    className: "",
    html: `<div class="tx-marker${selected ? " selected" : ""}">📡</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });
}

function selectBestTransmitter() {
  const visible = getFilteredTransmitters();
  if (!visible.length) {
    state.selectedTx = null;
    updateBottomSheet(null);
    showToast("Brak nadajników dla wybranych filtrów MUX");
    return;
  }
  const sorted = visible
    .map((tx) => ({ tx, distance: distanceKm(state.home.lat, state.home.lon, tx.lat, tx.lon) }))
    .sort((a, b) => a.distance - b.distance);
  selectTransmitter(sorted[0].tx.id, false);
}

function selectTransmitter(id, openSheet) {
  const tx = state.transmitters.find((item) => item.id === id);
  if (!tx) return;
  state.selectedTx = tx;
  state.txMarkers.forEach((marker, txId) => marker.setIcon(createTxIcon(state.transmitters.find((item) => item.id === txId))));
  updateSelectionMetrics();
  if (openSheet) $("bottomSheet").classList.remove("collapsed");
}

function updateHome(home, options = {}) {
  const nextHome = {
    lat: Number(home.lat),
    lon: Number(home.lon),
    name: home.name || "Punkt odbioru",
    source: home.source || "manual"
  };
  if (!Number.isFinite(nextHome.lat) || !Number.isFinite(nextHome.lon)) {
    showToast("Nieprawidłowe współrzędne punktu odbioru");
    return;
  }
  state.home = nextHome;
  state.homeMarker.setLatLng([nextHome.lat, nextHome.lon]);
  syncOverlayVisibility();
  $("locationName").textContent = nextHome.name;

  if (options.save !== false) saveHome(nextHome);
  if (options.center) state.map.setView([nextHome.lat, nextHome.lon], options.zoom || 12, { animate: true });
  if (options.chooseBest) selectBestTransmitter();
  else updateSelectionMetrics();

  updateTransmitterListActiveState();
}

function updateSelectionMetrics() {
  if (!state.selectedTx) return;
  updateBottomSheet(state.selectedTx);
  drawLink();
  refreshTerrainProfile();
  if (state.coverageVisible) refreshCoverageLayer();
  updateCompassHint();
  updateTransmitterListActiveState();
}

function updateBottomSheet(tx) {
  if (!tx) {
    $("txName").textContent = "Brak nadajnika";
    $("azimuthValue").textContent = "—";
    $("distanceValue").textContent = "—";
    $("polarizationValue").textContent = "—";
    $("muxValue").textContent = "—";
    $("muxTable").innerHTML = "";
    return;
  }
  const dist = distanceKm(state.home.lat, state.home.lon, tx.lat, tx.lon);
  const az = bearingDeg(state.home.lat, state.home.lon, tx.lat, tx.lon);
  $("txName").textContent = tx.name;
  $("azimuthValue").textContent = `${Math.round(az)}°`;
  $("distanceValue").textContent = `${dist.toFixed(dist < 10 ? 1 : 0)} km`;
  $("polarizationValue").textContent = tx.polarizations;
  $("muxValue").textContent = tx.muxNames.map((m) => m.replace("MUX-", "")).join(" / ");
  renderMuxTable(tx);
}

function renderMuxTable(tx) {
  const rows = [
    `<div class="mux-row header"><span>MUX</span><span>Kanał</span><span>Częstotliwość</span><span>ERP</span><span>Pol.</span></div>`,
    ...tx.muxes.map((m) => `
      <div class="mux-row">
        <span data-label="MUX"><strong>${escapeHtml(m.mux)}</strong></span>
        <span data-label="Kanał">${escapeHtml(m.channel)}</span>
        <span data-label="Częstotliwość">${m.frequency_mhz} MHz</span>
        <span data-label="ERP">${m.erp_kw} kW</span>
        <span data-label="Pol.">${escapeHtml(m.polarization)} / ${escapeHtml(m.band)}</span>
      </div>`)
  ];
  $("muxTable").innerHTML = rows.join("");
}

function drawLink() {
  if (!state.selectedTx) return;
  const points = [[state.home.lat, state.home.lon], [state.selectedTx.lat, state.selectedTx.lon]];
  if (state.linkLine) state.linkLine.remove();
  if (state.distanceLabel) state.distanceLabel.remove();

  state.linkLine = L.polyline(points, { color: "#2563eb", weight: 4, opacity: 0.82, dashArray: "8 10" });
  const mid = [(state.home.lat + state.selectedTx.lat) / 2, (state.home.lon + state.selectedTx.lon) / 2];
  const dist = distanceKm(state.home.lat, state.home.lon, state.selectedTx.lat, state.selectedTx.lon);
  state.distanceLabel = L.marker(mid, {
    icon: L.divIcon({ className: "distance-label", html: `${dist.toFixed(0)} km`, iconAnchor: [22, 12] }),
    interactive: false
  });
  syncOverlayVisibility();
}

function applyFilters() {
  for (const tx of state.transmitters) {
    const marker = state.txMarkers.get(tx.id);
    if (!marker) continue;
    const visible = isVisibleByFilter(tx) && state.overlays.transmitters;
    if (visible) {
      if (!state.map.hasLayer(marker)) marker.addTo(state.map);
    } else {
      if (state.map.hasLayer(marker)) state.map.removeLayer(marker);
    }
  }
  if (state.selectedTx && !isVisibleByFilter(state.selectedTx)) selectBestTransmitter();
  updateTransmitterListActiveState();
}

function isVisibleByFilter(tx) {
  return tx.muxNames.some((mux) => state.activeMuxFilters.has(mux));
}

function getFilteredTransmitters() {
  return state.transmitters.filter(isVisibleByFilter);
}

function showTransmittersPanel() {
  setSidePanel("Nadajniki", "Lista według odległości od punktu odbioru", renderTransmittersList());
}

function renderTransmittersList() {
  const rows = getFilteredTransmitters()
    .map((tx) => ({
      tx,
      dist: distanceKm(state.home.lat, state.home.lon, tx.lat, tx.lon),
      az: bearingDeg(state.home.lat, state.home.lon, tx.lat, tx.lon)
    }))
    .sort((a, b) => a.dist - b.dist)
    .map(({ tx, dist, az }) => `
      <button type="button" class="tx-item ${state.selectedTx?.id === tx.id ? "active" : ""}" data-tx-id="${tx.id}">
        <strong>${escapeHtml(tx.name)}</strong>
        <span>${dist.toFixed(dist < 10 ? 1 : 0)} km • azymut ${Math.round(az)}° • ${tx.muxNames.join(", ")} • ${tx.polarizations}</span>
      </button>`)
    .join("");
  return `<div class="tx-list">${rows || "<p>Brak nadajników dla aktywnych filtrów.</p>"}</div>`;
}

function updateTransmitterListActiveState() {
  document.querySelectorAll(".tx-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.txId === state.selectedTx?.id);
  });
}

function showLocationPanel() {
  const body = `
    <div class="tx-list">
      <div class="tx-item">
        <strong>Aktualny punkt odbioru</strong>
        <span>${escapeHtml(state.home.name)}<br>${state.home.lat.toFixed(6)}, ${state.home.lon.toFixed(6)}<br>Źródło: ${escapeHtml(locationSourceName(state.home.source))}</span>
      </div>
      <button type="button" class="panel-action" id="panelGpsBtn">Użyj GPS telefonu</button>
      <button type="button" class="panel-action" id="panelCenterBtn">Przenieś mapę do punktu odbioru</button>
      <button type="button" class="panel-action" id="panelResetLocationBtn">Resetuj do Mielca</button>
      <div class="hint-box">Punkt odbioru możesz też ustawić kliknięciem na mapie albo przeciągając ikonę domu.</div>
    </div>`;
  setSidePanel("Lokalizacja", "Punkt odbioru", body);
  $("panelGpsBtn")?.addEventListener("click", useGps);
  $("panelCenterBtn")?.addEventListener("click", () => state.map.setView([state.home.lat, state.home.lon], 13, { animate: true }));
  $("panelResetLocationBtn")?.addEventListener("click", () => {
    updateHome({ ...DEFAULT_HOME }, { chooseBest: true, center: true, zoom: 10, save: true });
    showLocationPanel();
  });
}

function showFiltersPanel() {
  const body = `
    <div class="filter-grid">
      ${ALL_MUX.map((mux) => `
        <label class="filter-tile">
          <span><strong>${mux}</strong><br><small>Pokaż nadajniki z ${mux}</small></span>
          <input type="checkbox" data-mux="${mux}" ${state.activeMuxFilters.has(mux) ? "checked" : ""}>
        </label>`).join("")}
    </div>`;
  setSidePanel("Filtry MUX", "Widoczność nadajników", body);
  $("sidePanelBody").querySelectorAll("input[data-mux]").forEach((input) => {
    input.addEventListener("change", () => {
      const mux = input.dataset.mux;
      if (input.checked) state.activeMuxFilters.add(mux);
      else state.activeMuxFilters.delete(mux);
      if (state.activeMuxFilters.size === 0) {
        state.activeMuxFilters.add(mux);
        input.checked = true;
        showToast("Musi zostać aktywny przynajmniej jeden MUX");
      }
      saveMuxFilters();
      applyFilters();
      selectBestTransmitter();
    });
  });
}

function showLayersPanel() {
  const body = `
    <div class="layer-section">
      <div class="panel-subtitle">Podkład mapy</div>
      <div class="layer-list">${Object.keys(state.baseLayers).map((name) => `
        <button type="button" class="layer-btn ${name === state.activeLayerName ? "active" : ""}" data-layer="${name}">${name}</button>`).join("")}</div>
    </div>
    <div class="layer-section">
      <div class="panel-subtitle">Warstwy robocze</div>
      <div class="filter-grid">
        ${renderOverlayToggle("home", "Punkt odbioru", "Ikona domu / lokalizacja klienta")}
        ${renderOverlayToggle("transmitters", "Nadajniki", "Znaczniki nadajników zgodne z filtrami MUX")}
        ${renderOverlayToggle("link", "Linia do nadajnika", "Kierunek od klienta do wybranego nadajnika")}
        ${renderOverlayToggle("distance", "Etykieta odległości", "Odległość na linii kierunku")}
        ${renderOverlayToggle("compass", "Mini kompas", "Pływający kompas na mapie")}
        ${renderOverlayToggle("profile", "Panel profilu", "Widoczność wykresu profilu terenu w dolnym panelu")}
        ${renderOverlayToggle("coverage", "Pokrycie orientacyjne", "Punkty pokrycia wokół wybranego nadajnika")}
      </div>
      <div class="hint-box">Warstwy są zapisywane lokalnie w przeglądarce. Po wrzuceniu na GitHub Pages ustawienia zostaną na danym telefonie/komputerze.</div>
    </div>`;
  setSidePanel("Warstwy", "Podkład i widoczność elementów", body);
  $("sidePanelBody").querySelectorAll("button[data-layer]").forEach((button) => {
    button.addEventListener("click", () => setBaseLayer(button.dataset.layer));
  });
  $("sidePanelBody").querySelectorAll("input[data-overlay]").forEach((input) => {
    input.addEventListener("change", () => {
      state.overlays[input.dataset.overlay] = input.checked;
      saveOverlaySettings();
      syncOverlayVisibility();
      applyFilters();
    });
  });
}

function setBaseLayer(name) {
  const layer = state.baseLayers[name];
  if (!layer) return;
  if (state.activeBaseLayer) state.map.removeLayer(state.activeBaseLayer);
  state.activeBaseLayer = layer;
  state.activeLayerName = name;
  layer.addTo(state.map);
  showLayersPanel();
  saveBaseLayer(name);
  showToast(`Podkład mapy: ${name}`);
}


function renderOverlayToggle(key, title, description) {
  return `
    <label class="filter-tile layer-toggle">
      <span><strong>${title}</strong><br><small>${description}</small></span>
      <input type="checkbox" data-overlay="${key}" ${state.overlays[key] ? "checked" : ""}>
    </label>`;
}

function syncOverlayVisibility() {
  if (!state.map) return;
  toggleLayer(state.homeMarker, state.overlays.home);
  toggleLayer(state.linkLine, state.overlays.link && Boolean(state.selectedTx));
  toggleLayer(state.distanceLabel, state.overlays.distance && state.overlays.link && Boolean(state.selectedTx));
  toggleLayer(state.coverageLayer, state.overlays.coverage && state.coverageVisible);

  if ($("compassCard")) {
    $("compassCard").classList.toggle("hidden-by-layer", !state.overlays.compass);
  }
  if ($("profileBox")) {
    $("profileBox").classList.toggle("hidden-by-layer", !state.overlays.profile);
  }
  $("layersBtn")?.classList.toggle("active", hasAnyOverlayHidden());
}

function toggleLayer(layer, shouldShow) {
  if (!layer || !state.map) return;
  if (shouldShow) {
    if (!state.map.hasLayer(layer)) layer.addTo(state.map);
  } else {
    if (state.map.hasLayer(layer)) state.map.removeLayer(layer);
  }
}

function hasAnyOverlayHidden() {
  return Object.values(state.overlays).some((value) => value === false);
}

function loadOverlaySettings() {
  const defaults = {
    home: true,
    transmitters: true,
    link: true,
    distance: true,
    compass: true,
    profile: true,
    coverage: true
  };
  try {
    const raw = localStorage.getItem(OVERLAY_STORAGE_KEY);
    if (!raw) return defaults;
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

function saveOverlaySettings() {
  try {
    localStorage.setItem(OVERLAY_STORAGE_KEY, JSON.stringify(state.overlays));
  } catch (error) {
    console.warn("Nie udało się zapisać ustawień warstw", error);
  }
}

function showReportPanel() {
  const tx = state.selectedTx;
  if (!tx) return;
  const dist = distanceKm(state.home.lat, state.home.lon, tx.lat, tx.lon);
  const az = bearingDeg(state.home.lat, state.home.lon, tx.lat, tx.lon);
  const body = `
    <div class="tx-list">
      <div class="tx-item">
        <strong>Raport roboczy</strong>
        <span>Lokalizacja: ${escapeHtml(state.home.name)}<br>
        Współrzędne: ${state.home.lat.toFixed(6)}, ${state.home.lon.toFixed(6)}<br>
        Nadajnik: ${escapeHtml(tx.name)}<br>
        Odległość: ${dist.toFixed(1)} km<br>
        Azymut: ${Math.round(az)}°<br>
        MUX: ${tx.muxNames.join(", ")}<br>
        Polaryzacja: ${tx.polarizations}<br>
        Profil terenu: ${state.profile?.statusLabel || "brak danych"}<br>
        Antena odbiorcza: ${state.receiverAntennaHeightM} m<br>
        Pokrycie orientacyjne: ${state.coverageSummary?.label || "brak danych"}</span>
      </div>
      <div class="tx-item">
        <strong>Etap 11</strong>
        <span>Raport korzysta z aktualnego punktu odbioru, wybranego nadajnika, kompasu antenowego, profilu terenu i orientacyjnej warstwy pokrycia. Baza nadajników może być demonstracyjna albo lokalnie zaimportowana — sprawdź panel PWA / Dane.</span>
      </div>
    </div>`;
  setSidePanel("Raport", "Podgląd danych", body);
}

function setSidePanel(title, eyebrow, bodyHtml) {
  $("sidePanelTitle").textContent = title;
  $("sidePanelEyebrow").textContent = eyebrow;
  $("sidePanelBody").innerHTML = bodyHtml;
  $("sidePanel").classList.remove("hidden");
  $("sidePanelBody").querySelectorAll("button[data-tx-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectTransmitter(button.dataset.txId, true);
      const tx = state.selectedTx;
      if (tx) state.map.setView([tx.lat, tx.lon], Math.max(state.map.getZoom(), 9), { animate: true });
    });
  });
}

function hideSidePanel() {
  $("sidePanel").classList.add("hidden");
}

async function handleSearch() {
  const query = $("addressInput").value.trim();
  if (!query) return;

  const foundTx = state.transmitters.find((tx) => tx.name.toLowerCase().includes(query.toLowerCase()) || tx.site.toLowerCase().includes(query.toLowerCase()));
  if (foundTx) {
    state.map.setView([foundTx.lat, foundTx.lon], 10, { animate: true });
    selectTransmitter(foundTx.id, true);
    showToast(`Znaleziono nadajnik: ${foundTx.name}`);
    return;
  }

  await geocodeAddress(query);
}

async function geocodeAddress(query) {
  try {
    if (state.searchAbortController) state.searchAbortController.abort();
    state.searchAbortController = new AbortController();
    showToast("Szukam lokalizacji...");
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("countrycodes", "pl");
    url.searchParams.set("q", query);
    const response = await fetch(url.toString(), {
      signal: state.searchAbortController.signal,
      headers: { "Accept": "application/json" }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const results = await response.json();
    if (!results.length) {
      showToast("Nie znaleziono adresu. Ustaw punkt kliknięciem na mapie.");
      return;
    }
    const first = results[0];
    updateHome({
      lat: Number(first.lat),
      lon: Number(first.lon),
      name: first.display_name?.split(",").slice(0, 2).join(",") || query,
      source: "search"
    }, { chooseBest: true, center: true, zoom: 13, save: true });
    showToast("Ustawiono punkt odbioru z wyszukiwarki");
  } catch (error) {
    if (error.name === "AbortError") return;
    console.error(error);
    showToast("Nie udało się wyszukać adresu. Sprawdź internet albo ustaw punkt na mapie.");
  }
}

function useGps() {
  if (!navigator.geolocation) {
    showToast("Ta przeglądarka nie udostępnia GPS");
    return;
  }
  if (state.gpsInProgress) return;
  state.gpsInProgress = true;
  showToast("Pobieram lokalizację GPS...");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.gpsInProgress = false;
      const accuracy = Math.round(pos.coords.accuracy || 0);
      const home = { lat: pos.coords.latitude, lon: pos.coords.longitude, name: `Lokalizacja GPS ±${accuracy} m`, source: "gps" };
      updateHome(home, { chooseBest: true, center: true, zoom: 13, save: true });
      showToast("Ustawiono lokalizację GPS");
    },
    (error) => {
      state.gpsInProgress = false;
      console.warn(error);
      showToast("Nie udało się pobrać GPS. Sprawdź uprawnienia przeglądarki.");
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
  );
}

function showCompassPanel() {
  $("compassCard").classList.add("visible");
  updateCompassHint();
  const target = state.selectedTx ? bearingDeg(state.home.lat, state.home.lon, state.selectedTx.lat, state.selectedTx.lon) : null;
  const body = `
    <div class="compass-control-box">
      <div class="compass-status-card">
        <strong>Tryb kompasu antenowego</strong>
        <span>Telefon pokazuje aktualny kierunek, a aplikacja porównuje go z azymutem wybranego nadajnika. Cel: ${target === null ? "—" : Math.round(target) + "°"}.</span>
      </div>
      <div class="compass-actions">
        <button type="button" class="panel-action" id="panelStartCompassBtn">Włącz kompas telefonu</button>
        <button type="button" class="panel-action" id="panelStopCompassBtn">Zatrzymaj kompas</button>
      </div>
      <div class="manual-heading-wrap">
        <label for="manualHeadingRange">Ręczny kierunek telefonu: <span id="manualHeadingText">${Math.round(state.manualHeading)}°</span></label>
        <input id="manualHeadingRange" type="range" min="0" max="359" step="1" value="${Math.round(state.manualHeading)}">
        <div class="hint-box">To jest tryb awaryjny, gdy przeglądarka albo telefon nie udostępnia czujnika kompasu.</div>
      </div>
      <div class="compass-warning">Kompas w telefonie może przekłamywać przy maszcie, antenie, samochodzie, rynnie, dachu z blachy albo przewodach. Traktuj go jako pomoc do wstępnego ustawienia kierunku, nie jako miernik sygnału.</div>
    </div>`;
  setSidePanel("Kompas", "Ustawianie anteny", body);
  $("panelStartCompassBtn")?.addEventListener("click", startCompass);
  $("panelStopCompassBtn")?.addEventListener("click", stopCompass);
  const range = $("manualHeadingRange");
  range?.addEventListener("input", () => {
    state.compassMode = "manual";
    state.manualHeading = Number(range.value);
    state.compassHeading = normalizeDeg(state.manualHeading);
    $("manualHeadingText").textContent = `${Math.round(state.manualHeading)}°`;
    $("compassNeedle").style.transform = `rotate(${state.compassHeading}deg)`;
    updateCompassHint();
  });
}

function startCompass() {
  const start = () => {
    if (state.compassActive) {
      showToast("Kompas już działa");
      return;
    }
    state.orientationHandler = handleOrientation;
    window.addEventListener("deviceorientationabsolute", state.orientationHandler, true);
    window.addEventListener("deviceorientation", state.orientationHandler, true);
    state.compassActive = true;
    state.compassMode = "auto";
    $("compassBtn").classList.add("active");
    $("compassCard").classList.add("visible");
    updateCompassHint();
    showToast("Kompas włączony. Telefon trzymaj z dala od metalu.");
  };

  if (!window.DeviceOrientationEvent) {
    state.compassPermission = "unsupported";
    updateCompassHint();
    showToast("Kompas nie jest dostępny w tej przeglądarce. Użyj trybu ręcznego.");
    return;
  }

  if (typeof DeviceOrientationEvent.requestPermission === "function") {
    DeviceOrientationEvent.requestPermission()
      .then((permission) => {
        state.compassPermission = permission;
        if (permission === "granted") start();
        else {
          updateCompassHint();
          showToast("Brak zgody na kompas. Użyj trybu ręcznego.");
        }
      })
      .catch(() => {
        state.compassPermission = "error";
        updateCompassHint();
        showToast("Nie udało się uruchomić kompasu. Użyj trybu ręcznego.");
      });
    return;
  }

  if ("ondeviceorientationabsolute" in window || "ondeviceorientation" in window) start();
  else {
    state.compassPermission = "unsupported";
    updateCompassHint();
    showToast("Kompas nie jest dostępny w tej przeglądarce. Użyj trybu ręcznego.");
  }
}

function stopCompass() {
  if (state.orientationHandler) {
    window.removeEventListener("deviceorientationabsolute", state.orientationHandler, true);
    window.removeEventListener("deviceorientation", state.orientationHandler, true);
  }
  state.orientationHandler = null;
  state.compassActive = false;
  state.compassMode = "manual";
  $("compassBtn").classList.remove("active");
  updateCompassHint();
  showToast("Kompas zatrzymany. Możesz użyć suwaka ręcznego.");
}

function handleOrientation(event) {
  let heading = null;
  if (typeof event.webkitCompassHeading === "number") heading = event.webkitCompassHeading;
  else if (typeof event.alpha === "number") heading = event.absolute ? event.alpha : 360 - event.alpha;
  if (heading === null || Number.isNaN(heading)) return;
  state.compassMode = "auto";
  state.compassHeading = normalizeDeg(heading);
  $("compassNeedle").style.transform = `rotate(${state.compassHeading}deg)`;
  updateCompassHint();
}

function updateCompassHint() {
  const targetEl = $("targetAzimuthValue");
  const currentEl = $("currentHeadingValue");
  const noteEl = $("compassNote");

  if (!state.selectedTx) {
    $("compassHint").textContent = "Wybierz nadajnik";
    if (targetEl) targetEl.textContent = "—";
    if (currentEl) currentEl.textContent = state.compassHeading === null ? "—" : `${Math.round(state.compassHeading)}°`;
    if (noteEl) noteEl.textContent = "Najpierw wybierz nadajnik z listy albo z mapy.";
    return;
  }

  const target = bearingDeg(state.home.lat, state.home.lon, state.selectedTx.lat, state.selectedTx.lon);
  $("targetNeedle").style.transform = `rotate(${target}deg)`;
  if (targetEl) targetEl.textContent = `${Math.round(target)}°`;

  if (state.compassHeading === null) {
    $("compassHint").textContent = `Azymut do nadajnika: ${Math.round(target)}°`;
    if (currentEl) currentEl.textContent = "—";
    if (noteEl) noteEl.textContent = "Włącz kompas albo ustaw kierunek ręcznie suwakiem.";
    return;
  }

  if (currentEl) currentEl.textContent = `${Math.round(state.compassHeading)}°`;
  const diff = shortestAngle(state.compassHeading, target);
  const abs = Math.abs(Math.round(diff));
  if (abs <= 5) $("compassHint").textContent = "Kierunek prawidłowy";
  else $("compassHint").textContent = `Obróć ${abs}° ${diff > 0 ? "w prawo" : "w lewo"}`;

  if (noteEl) {
    noteEl.textContent = state.compassMode === "manual"
      ? "Tryb ręczny — używany, gdy czujnik kompasu jest niedostępny."
      : "Tryb telefonu — wskazanie zależy od czujników urządzenia.";
  }
}


async function refreshTerrainProfile(options = {}) {
  if (!state.selectedTx) {
    state.profile = null;
    drawProfilePlaceholder("Wybierz nadajnik, aby pobrać profil terenu.");
    return;
  }

  const requestId = ++state.profileRequestId;
  const tx = state.selectedTx;
  const distance = distanceKm(state.home.lat, state.home.lon, tx.lat, tx.lon);
  const pointsCount = clamp(Math.round(distance * 1.7), 36, 90);
  const samples = buildProfileSamples(state.home, tx, pointsCount);

  if (state.profileAbortController) state.profileAbortController.abort();
  state.profileAbortController = new AbortController();

  setProfileStatus("Pobieram profil terenu...", "Open-Meteo DEM");

  try {
    const elevations = await fetchElevations(samples, state.profileAbortController.signal);
    if (requestId !== state.profileRequestId) return;
    const profile = analyzeTerrainProfile(samples, elevations, tx, state.receiverAntennaHeightM);
    state.profile = profile;
    drawProfile(profile);
  } catch (error) {
    if (error.name === "AbortError") return;
    console.warn("Profil terenu:", error);
    const fallback = buildDemoProfile(samples, tx, state.receiverAntennaHeightM, "Nie udało się pobrać wysokości terenu. Pokazuję profil demonstracyjny.");
    state.profile = fallback;
    drawProfile(fallback);
  }
}

function buildProfileSamples(home, tx, count) {
  const totalDistance = distanceKm(home.lat, home.lon, tx.lat, tx.lon);
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    const lat = home.lat + (tx.lat - home.lat) * t;
    const lon = home.lon + (tx.lon - home.lon) * t;
    return { lat, lon, t, distanceKm: totalDistance * t };
  });
}

async function fetchElevations(samples, signal) {
  const url = new URL("https://api.open-meteo.com/v1/elevation");
  url.searchParams.set("latitude", samples.map((p) => p.lat.toFixed(5)).join(","));
  url.searchParams.set("longitude", samples.map((p) => p.lon.toFixed(5)).join(","));
  const response = await fetch(url.toString(), { signal, headers: { "Accept": "application/json" } });
  if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
  const data = await response.json();
  const elevations = data.elevation;
  if (!Array.isArray(elevations) || elevations.length !== samples.length) throw new Error("Brak kompletnego profilu wysokości");
  const clean = elevations.map((value) => Number(value));
  if (clean.some((value) => !Number.isFinite(value))) throw new Error("Nieprawidłowe dane wysokości");
  return clean;
}

function analyzeTerrainProfile(samples, elevations, tx, receiverHeight) {
  const totalDistance = samples.at(-1)?.distanceKm || 0;
  const txMast = Number(tx.mast_m || 0);
  const receiverTop = elevations[0] + receiverHeight;
  const transmitterTop = elevations[elevations.length - 1] + txMast;
  const points = samples.map((sample, index) => {
    const lineHeight = receiverTop + (transmitterTop - receiverTop) * sample.t;
    const terrain = elevations[index];
    const clearance = lineHeight - terrain;
    return { ...sample, elevation: terrain, lineHeight, clearance };
  });
  const innerPoints = points.slice(1, -1);
  const minClearance = innerPoints.length ? Math.min(...innerPoints.map((p) => p.clearance)) : 0;
  const worst = innerPoints.find((p) => p.clearance === minClearance) || points[0];
  let status = "clear";
  let statusLabel = "Teren wygląda czysto";
  let warning = "Profil z API wysokości — wynik orientacyjny, nie zastępuje pomiaru miernikiem.";
  if (minClearance < -15) {
    status = "blocked";
    statusLabel = "Silne zasłonięcie terenu";
    warning = `Silna przeszkoda około ${worst.distanceKm.toFixed(1)} km od punktu odbioru. Rozważ wyższy maszt albo inny nadajnik.`;
  } else if (minClearance < 10) {
    status = "partial";
    statusLabel = "Częściowe zasłonięcie terenu";
    warning = `Mały zapas nad terenem około ${worst.distanceKm.toFixed(1)} km od punktu odbioru. Odbiór może być niestabilny.`;
  }
  return {
    mode: "real",
    source: "Open-Meteo elevation API",
    points,
    totalDistance,
    receiverHeight,
    txMast,
    minClearance,
    worst,
    status,
    statusLabel,
    warning
  };
}

function buildDemoProfile(samples, tx, receiverHeight, reason) {
  const seed = Math.abs(hashString(tx.id + state.home.lat.toFixed(2) + state.home.lon.toFixed(2)));
  const elevations = samples.map((sample, i) => {
    const base = 210 + ((seed + i * 41) % 110);
    const hill = 310 * Math.exp(-Math.pow((sample.t - 0.58) / 0.16, 2));
    const wave = 80 * Math.sin(i / 4 + seed % 5);
    return Math.max(70, Math.round(base + hill + wave));
  });
  const profile = analyzeTerrainProfile(samples, elevations, tx, receiverHeight);
  profile.mode = "demo";
  profile.source = "DEMO";
  profile.statusLabel = "Profil demonstracyjny";
  profile.warning = reason;
  return profile;
}

function drawProfile(profile) {
  const canvas = $("profileCanvas");
  if (!canvas || !profile?.points?.length) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, width, height);

  const margin = { left: 46, right: 28, top: 20, bottom: 42 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const allHeights = profile.points.flatMap((p) => [p.elevation, p.lineHeight]);
  let min = Math.floor((Math.min(...allHeights) - 45) / 50) * 50;
  let max = Math.ceil((Math.max(...allHeights) + 45) / 50) * 50;
  if (max - min < 120) max = min + 120;

  const xFor = (p) => margin.left + plotW * (p.distanceKm / Math.max(profile.totalDistance, 0.001));
  const yFor = (value) => margin.top + plotH - ((value - min) / (max - min)) * plotH;

  ctx.strokeStyle = "#dbe3ef";
  ctx.lineWidth = 1;
  ctx.font = "13px system-ui";
  ctx.fillStyle = "#64748b";
  for (let i = 0; i <= 4; i++) {
    const value = min + (max - min) * (1 - i / 4);
    const y = yFor(value);
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(width - margin.right, y);
    ctx.stroke();
    ctx.fillText(`${Math.round(value)} m`, 4, y + 4);
  }

  const pts = profile.points.map((p) => ({ ...p, x: xFor(p), y: yFor(p.elevation), ly: yFor(p.lineHeight) }));
  const grad = ctx.createLinearGradient(0, margin.top, 0, margin.top + plotH);
  grad.addColorStop(0, profile.status === "blocked" ? "#fdba74" : profile.status === "partial" ? "#fde68a" : "#86efac");
  grad.addColorStop(1, "#dcfce7");
  ctx.beginPath();
  ctx.moveTo(pts[0].x, margin.top + plotH);
  pts.forEach((p) => ctx.lineTo(p.x, p.y));
  ctx.lineTo(pts.at(-1).x, margin.top + plotH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  ctx.strokeStyle = profile.status === "blocked" ? "#ea580c" : profile.status === "partial" ? "#ca8a04" : "#16a34a";
  ctx.lineWidth = 3;
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.stroke();

  ctx.beginPath();
  ctx.strokeStyle = "rgba(37,99,235,.72)";
  ctx.setLineDash([8, 8]);
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.ly) : ctx.lineTo(p.x, p.ly));
  ctx.stroke();
  ctx.setLineDash([]);

  const dangerPoints = pts.filter((p) => p.clearance < 10 && p.distanceKm > 0 && p.distanceKm < profile.totalDistance);
  if (dangerPoints.length) {
    ctx.beginPath();
    ctx.strokeStyle = profile.status === "blocked" ? "#dc2626" : "#f97316";
    ctx.lineWidth = 5;
    dangerPoints.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke();
  }

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 14px system-ui";
  ctx.fillText(`Dom +${profile.receiverHeight} m`, margin.left, height - 13);
  ctx.fillText(`Nadajnik +${profile.txMast} m`, width - margin.right - 118, height - 13);
  ctx.fillStyle = "#64748b";
  ctx.font = "12px system-ui";
  ctx.fillText("0 km", margin.left, height - 28);
  ctx.fillText(`${profile.totalDistance.toFixed(1)} km`, width - margin.right - 52, height - 28);

  setProfileStatus(profile.warning, profile.source);
  $("profileStats").innerHTML = `
    <span><strong>Ocena:</strong> ${escapeHtml(profile.statusLabel)}</span>
    <span><strong>Najmniejszy zapas:</strong> ${Math.round(profile.minClearance)} m</span>
    <span><strong>Odległość:</strong> ${profile.totalDistance.toFixed(1)} km</span>
  `;
  $("profileWarning").classList.toggle("demo", profile.mode === "demo");
}

function drawProfilePlaceholder(message) {
  const canvas = $("profileCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#64748b";
  ctx.font = "bold 18px system-ui";
  ctx.fillText(message, 38, 110);
  setProfileStatus(message, "—");
  $("profileStats").textContent = "Brak profilu.";
}

function setProfileStatus(message, source) {
  if ($("profileWarning")) $("profileWarning").textContent = message;
  if ($("profileSource")) $("profileSource").textContent = source || "—";
}


// Etap 10 — orientacyjne pokrycie zasięgiem
function initCoverageLayer() {
  state.coverageLayer = L.layerGroup();
  if (state.coverageVisible && state.overlays.coverage) state.coverageLayer.addTo(state.map);
  updateCoverageButton();
}

function showCoveragePanel() {
  const summary = state.coverageSummary;
  const tx = state.selectedTx;
  const body = `
    <div class="tx-list">
      <div class="tx-item">
        <strong>Pokrycie orientacyjne</strong>
        <span>Nadajnik: ${tx ? escapeHtml(tx.name) : "brak"}<br>
        Status: ${summary ? escapeHtml(summary.label) : "nieprzeliczone"}<br>
        Punkty: ${summary ? summary.total : 0}<br>
        Dobre: ${summary ? summary.good : 0} • Średnie: ${summary ? summary.medium : 0} • Słabe: ${summary ? summary.weak : 0} • Brak: ${summary ? summary.none : 0}</span>
      </div>
      <button type="button" class="panel-action" id="panelBuildCoverageBtn">Przelicz pokrycie dla wybranego nadajnika</button>
      <button type="button" class="panel-action" id="panelToggleCoverageBtn">${state.coverageVisible ? "Ukryj pokrycie" : "Pokaż pokrycie"}</button>
      <button type="button" class="panel-action danger" id="panelClearCoverageBtn">Wyczyść warstwę pokrycia</button>
      <div class="coverage-legend">
        <span><i class="cov-dot cov-good"></i> dobry</span>
        <span><i class="cov-dot cov-medium"></i> średni</span>
        <span><i class="cov-dot cov-weak"></i> słaby</span>
        <span><i class="cov-dot cov-none"></i> brak / cień</span>
      </div>
      <div class="hint-box">To jest warstwa orientacyjna. Aplikacja liczy punkty wokół nadajnika, pobiera wysokości terenu z Open-Meteo i szuka przeszkód na profilu. Nie uwzględnia pełnej charakterystyki anten, odbić, zabudowy, lasu, zakłóceń LTE/5G ani rzeczywistego pomiaru miernikiem.</div>
    </div>`;
  setSidePanel("Pokrycie", "Warstwa zasięgu", body);
  $("panelBuildCoverageBtn")?.addEventListener("click", () => refreshCoverageLayer({ force: true }));
  $("panelToggleCoverageBtn")?.addEventListener("click", () => {
    state.coverageVisible = !state.coverageVisible;
    saveCoverageVisible();
    syncOverlayVisibility();
    updateCoverageButton();
    showCoveragePanel();
  });
  $("panelClearCoverageBtn")?.addEventListener("click", clearCoverageLayer);
}

async function refreshCoverageLayer(options = {}) {
  if (!state.selectedTx || !state.coverageLayer) return;
  if (!state.coverageVisible && !options.force) return;
  if (!navigator.onLine) {
    showToast("Pokrycie wymaga internetu do pobrania wysokości terenu");
    return;
  }
  const requestId = ++state.coverageRequestId;
  const tx = state.selectedTx;
  const samples = buildCoverageSamples(tx);
  if (state.coverageAbortController) state.coverageAbortController.abort();
  state.coverageAbortController = new AbortController();
  state.coverageVisible = true;
  saveCoverageVisible();
  updateCoverageButton(true);
  showToast("Liczę orientacyjne pokrycie terenu...");
  try {
    const profiles = buildCoverageProfiles(tx, samples);
    const uniquePoints = flattenCoveragePoints(profiles);
    const elevations = await fetchElevationsChunked(uniquePoints, state.coverageAbortController.signal);
    if (requestId !== state.coverageRequestId) return;
    const elevationMap = new Map(uniquePoints.map((p, i) => [p.key, elevations[i]]));
    const results = profiles.map((profile) => evaluateCoverageProfile(tx, profile, elevationMap));
    renderCoverageResults(results);
    state.coverageSummary = summarizeCoverage(results);
    syncOverlayVisibility();
    updateCoverageButton(false);
    showToast(state.coverageSummary.label);
    if ($("sidePanelTitle")?.textContent === "Pokrycie") showCoveragePanel();
  } catch (error) {
    if (error.name === "AbortError") return;
    console.error("Pokrycie:", error);
    updateCoverageButton(false);
    showToast("Nie udało się przeliczyć pokrycia. Sprawdź internet albo spróbuj ponownie.");
  }
}

function buildCoverageSamples(tx) {
  const maxKm = estimateCoverageRadiusKm(tx);
  const distances = [0.25, 0.4, 0.55, 0.72, 0.9, 1].map((f) => Math.max(2, Math.round(maxKm * f)));
  const bearings = Array.from({ length: 24 }, (_, i) => i * 15);
  const samples = [];
  for (const bearing of bearings) {
    for (const distance of distances) {
      const point = destinationPoint(tx.lat, tx.lon, distance, bearing);
      samples.push({ ...point, bearing, distanceKm: distance });
    }
  }
  return samples;
}

function estimateCoverageRadiusKm(tx) {
  const maxErp = Math.max(...tx.muxes.map((m) => Number(m.erp_kw) || 1));
  const base = 18 + Math.sqrt(maxErp) * 6;
  return clamp(Math.round(base), 24, 85);
}

function buildCoverageProfiles(tx, samples) {
  return samples.map((sample) => {
    const count = sample.distanceKm > 45 ? 7 : 5;
    const points = Array.from({ length: count }, (_, i) => {
      const t = i / (count - 1);
      const lat = tx.lat + (sample.lat - tx.lat) * t;
      const lon = tx.lon + (sample.lon - tx.lon) * t;
      return { lat, lon, t, key: coverageKey(lat, lon) };
    });
    return { sample, points };
  });
}

function flattenCoveragePoints(profiles) {
  const map = new Map();
  for (const profile of profiles) {
    for (const point of profile.points) {
      if (!map.has(point.key)) map.set(point.key, point);
    }
  }
  return [...map.values()];
}

async function fetchElevationsChunked(points, signal) {
  const result = [];
  const chunkSize = 90;
  for (let i = 0; i < points.length; i += chunkSize) {
    const chunk = points.slice(i, i + chunkSize);
    const elevations = await fetchElevations(chunk, signal);
    result.push(...elevations);
    await delay(60);
  }
  return result;
}

function evaluateCoverageProfile(tx, profile, elevationMap) {
  const elevations = profile.points.map((p) => elevationMap.get(p.key));
  const txMast = Number(tx.mast_m || 0);
  const receiverHeight = state.receiverAntennaHeightM;
  const startTop = elevations[0] + txMast;
  const endTop = elevations.at(-1) + receiverHeight;
  const clearances = profile.points.map((p, index) => {
    const lineHeight = startTop + (endTop - startTop) * p.t;
    return lineHeight - elevations[index];
  }).slice(1, -1);
  const minClearance = clearances.length ? Math.min(...clearances) : 999;
  const maxErp = Math.max(...tx.muxes.map((m) => Number(m.erp_kw) || 1));
  const distancePenalty = profile.sample.distanceKm / estimateCoverageRadiusKm(tx);
  const terrainPenalty = minClearance < -20 ? 1 : minClearance < 0 ? 0.7 : minClearance < 15 ? 0.42 : 0.12;
  const erpBonus = Math.min(0.25, Math.log10(maxErp + 1) / 10);
  const score = clamp(1 - distancePenalty - terrainPenalty + erpBonus, 0, 1);
  let level = "none";
  if (score >= 0.62) level = "good";
  else if (score >= 0.42) level = "medium";
  else if (score >= 0.23) level = "weak";
  return { ...profile.sample, minClearance, score, level };
}

function renderCoverageResults(results) {
  state.coverageLayer.clearLayers();
  const groups = { good: [], medium: [], weak: [], none: [] };
  for (const result of results) groups[result.level].push([result.lat, result.lon]);
  const colors = { good: "#16a34a", medium: "#ca8a04", weak: "#f97316", none: "#dc2626" };
  for (const [level, latlngs] of Object.entries(groups)) {
    for (const latlng of latlngs) {
      L.circleMarker(latlng, {
        radius: level === "none" ? 5 : 6,
        color: colors[level],
        fillColor: colors[level],
        fillOpacity: level === "good" ? 0.34 : level === "medium" ? 0.42 : 0.55,
        weight: 1,
        opacity: 0.74,
        interactive: false
      }).addTo(state.coverageLayer);
    }
  }
  if (!state.map.hasLayer(state.coverageLayer) && state.coverageVisible && state.overlays.coverage) state.coverageLayer.addTo(state.map);
}

function summarizeCoverage(results) {
  const counts = { good: 0, medium: 0, weak: 0, none: 0 };
  for (const item of results) counts[item.level]++;
  const total = results.length;
  const label = `Pokrycie orientacyjne: ${counts.good} dobrych, ${counts.medium} średnich, ${counts.weak} słabych, ${counts.none} brak/cień`;
  return { ...counts, total, label };
}

function clearCoverageLayer() {
  state.coverageAbortController?.abort();
  state.coverageLayer?.clearLayers();
  state.coverageSummary = null;
  state.coverageVisible = false;
  saveCoverageVisible();
  syncOverlayVisibility();
  updateCoverageButton(false);
  showCoveragePanel();
  showToast("Wyczyszczono pokrycie");
}

function updateCoverageButton(loading = false) {
  const btn = $("coverageBtn");
  if (!btn) return;
  btn.classList.toggle("active", state.coverageVisible || loading);
  btn.classList.toggle("loading", loading);
  btn.title = loading ? "Liczenie pokrycia..." : "Pokrycie zasięgiem";
}

function saveCoverageVisible() {
  try { localStorage.setItem(COVERAGE_STORAGE_KEY, JSON.stringify({ visible: state.coverageVisible })); } catch {}
}

function loadSavedCoverageVisible() {
  try {
    const raw = localStorage.getItem(COVERAGE_STORAGE_KEY);
    return raw ? Boolean(JSON.parse(raw).visible) : false;
  } catch { return false; }
}

function coverageKey(lat, lon) {
  return `${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`;
}

function destinationPoint(lat, lon, distanceKmValue, bearing) {
  const radius = 6371;
  const delta = distanceKmValue / radius;
  const theta = toRad(bearing);
  const phi1 = toRad(lat);
  const lambda1 = toRad(lon);
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
  const lambda2 = lambda1 + Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2));
  return { lat: toDeg(phi2), lon: normalizeLon(toDeg(lambda2)) };
}

function normalizeLon(lon) {
  return ((lon + 540) % 360) - 180;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function initPwaStatus() {
  updateOnlineStatus();
  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    updateInstallUi();
    showToast("Aplikację można zainstalować jako PWA");
  });

  window.addEventListener("appinstalled", () => {
    state.deferredInstallPrompt = null;
    updateInstallUi();
    showToast("Aplikacja została zainstalowana");
  });
}

function updateOnlineStatus() {
  const online = navigator.onLine;
  document.body.classList.toggle("is-offline", !online);
  const status = $("networkStatus");
  if (status) {
    status.textContent = online ? "Online" : "Offline";
    status.title = online ? "Połączenie internetowe działa" : "Brak internetu — mapa, wyszukiwarka i profil mogą być ograniczone";
  }
}

function updateInstallUi() {
  const btn = $("pwaBtn");
  if (!btn) return;
  btn.classList.toggle("active", Boolean(state.deferredInstallPrompt || state.updateWaiting));
}

async function installPwa() {
  if (!state.deferredInstallPrompt) {
    showToast("Jeśli przeglądarka pozwala, użyj opcji: Dodaj do ekranu głównego / Zainstaluj aplikację.");
    return;
  }
  state.deferredInstallPrompt.prompt();
  const result = await state.deferredInstallPrompt.userChoice;
  state.deferredInstallPrompt = null;
  updateInstallUi();
  showToast(result.outcome === "accepted" ? "Instalacja PWA zaakceptowana" : "Instalacja PWA anulowana");
}

function showPwaPanel() {
  const online = navigator.onLine ? "Online" : "Offline";
  const installed = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone ? "Tak" : "Nie / przeglądarka";
  const body = `
    <div class="tx-list">
      <div class="tx-item">
        <strong>Status PWA</strong>
        <span>Wersja: ${VERSION}<br>Połączenie: ${online}<br>Tryb zainstalowany: ${installed}<br>Aktualizacja czeka: ${state.updateWaiting ? "tak" : "nie"}</span>
      </div>
      <button type="button" class="panel-action" id="panelInstallPwaBtn">Zainstaluj / dodaj do ekranu głównego</button>
      <button type="button" class="panel-action" id="panelUpdatePwaBtn">Wymuś aktualizację aplikacji</button>
      <button type="button" class="panel-action" id="panelExportSettingsBtn">Eksportuj ustawienia lokalne</button>
      <label class="panel-action file-action" for="panelImportSettingsInput">Importuj ustawienia lokalne</label>
      <input id="panelImportSettingsInput" type="file" accept="application/json" hidden>
      <button type="button" class="panel-action" id="panelExportTxBtn">Eksportuj bazę nadajników JSON</button>
      <label class="panel-action file-action" for="panelImportTxInput">Importuj bazę nadajników JSON/CSV</label>
      <input id="panelImportTxInput" type="file" accept="application/json,.json,text/csv,.csv" hidden>
      <button type="button" class="panel-action danger" id="panelClearTxBtn">Usuń lokalnie zaimportowaną bazę nadajników</button>
      <button type="button" class="panel-action danger" id="panelClearLocalBtn">Wyczyść lokalne ustawienia</button>
      <div class="hint-box"><strong>Status bazy nadajników:</strong><br>${renderDataSourceStatus()}<br><br>Etap 11 dodaje lokalny import bazy nadajników. Kafelki mapy, wyszukiwarka adresu, profil terenu i dokładniejsze pokrycie nadal wymagają internetu, jeśli dane nie są wcześniej w cache.</div>
    </div>`;
  setSidePanel("PWA / Offline", "Instalacja i pamięć lokalna", body);
  $("panelInstallPwaBtn")?.addEventListener("click", installPwa);
  $("panelUpdatePwaBtn")?.addEventListener("click", forceAppUpdate);
  $("panelExportSettingsBtn")?.addEventListener("click", exportLocalSettings);
  $("panelImportSettingsInput")?.addEventListener("change", importLocalSettings);
  $("panelExportTxBtn")?.addEventListener("click", exportTransmittersJson);
  $("panelImportTxInput")?.addEventListener("change", importTransmittersFile);
  $("panelClearTxBtn")?.addEventListener("click", clearCustomTransmitters);
  $("panelClearLocalBtn")?.addEventListener("click", clearLocalSettings);
}


function renderDataSourceStatus() {
  const meta = state.transmittersMeta || {};
  return `Tryb: ${escapeHtml(meta.mode || "demo")}<br>Źródło: ${escapeHtml(meta.source || "brak")}<br>Aktualizacja: ${escapeHtml(meta.updatedAt || "brak")}<br>Licencja/uwagi: ${escapeHtml(meta.license || "brak")}<br>Liczba obiektów: ${state.transmitters.length}`;
}

function loadCustomTransmitters() {
  try {
    const raw = localStorage.getItem(CUSTOM_TRANSMITTERS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : null;
  } catch (error) {
    console.warn("Nie udało się odczytać lokalnej bazy nadajników", error);
    return null;
  }
}

function loadTransmittersMeta() {
  try {
    const raw = localStorage.getItem(CUSTOM_TRANSMITTERS_META_KEY);
    if (!raw) return { mode: "demo", source: "Plik demonstracyjny", updatedAt: "brak", license: "dane testowe", count: 0 };
    return JSON.parse(raw);
  } catch {
    return { mode: "demo", source: "Plik demonstracyjny", updatedAt: "brak", license: "dane testowe", count: 0 };
  }
}

function saveCustomTransmitters(transmitters, meta) {
  localStorage.setItem(CUSTOM_TRANSMITTERS_KEY, JSON.stringify(transmitters));
  localStorage.setItem(CUSTOM_TRANSMITTERS_META_KEY, JSON.stringify(meta));
}

function clearCustomTransmitters() {
  localStorage.removeItem(CUSTOM_TRANSMITTERS_KEY);
  localStorage.removeItem(CUSTOM_TRANSMITTERS_META_KEY);
  showToast("Usunięto lokalną bazę nadajników. Wczytuję dane z paczki...");
  setTimeout(() => location.reload(), 600);
}

function exportTransmittersJson() {
  const payload = state.transmitters.map((tx) => ({
    id: tx.id,
    name: tx.name,
    site: tx.site,
    lat: tx.lat,
    lon: tx.lon,
    height_m: tx.height_m,
    mast_m: tx.mast_m,
    region: tx.region || "",
    source: tx.source || state.transmittersMeta?.source || "",
    muxes: tx.muxes
  }));
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dvbt-mapa-nadajniki-${VERSION.replaceAll(" ", "_")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importTransmittersFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    let imported;
    if (file.name.toLowerCase().endsWith(".csv")) {
      imported = convertCsvRowsToTransmitters(parseCsv(text));
    } else {
      const json = JSON.parse(text);
      imported = Array.isArray(json) ? json : json.transmitters;
    }
    if (!Array.isArray(imported) || !imported.length) throw new Error("Brak nadajników w pliku");
    const normalized = imported.map(normalizeTransmitter).filter((tx) => Number.isFinite(tx.lat) && Number.isFinite(tx.lon) && tx.muxes.length);
    if (!normalized.length) throw new Error("Nie znaleziono poprawnych nadajników po normalizacji");
    const meta = {
      mode: "local-import",
      source: file.name,
      updatedAt: new Date().toISOString(),
      license: "Źródło/licencję musi potwierdzić użytkownik przed użyciem produkcyjnym",
      count: normalized.length
    };
    saveCustomTransmitters(normalized, meta);
    state.transmitters = normalized;
    state.transmittersMeta = meta;
    renderTransmitters();
    selectBestTransmitter();
    refreshTerrainProfile({ force: true });
    if (state.coverageVisible) refreshCoverageLayer();
    showToast(`Zaimportowano nadajniki: ${normalized.length}`);
  } catch (error) {
    console.error(error);
    showToast("Nie udało się zaimportować bazy nadajników");
  } finally {
    event.target.value = "";
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted && ch === '"' && next === '"') { cell += '"'; i++; continue; }
    if (ch === '"') { quoted = !quoted; continue; }
    if (!quoted && ch === ',') { row.push(cell.trim()); cell = ""; continue; }
    if (!quoted && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += ch;
  }
  if (cell || row.length) { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift().map((h) => slugHeader(h));
  return rows.map((values) => Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""])));
}

function slugHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function convertCsvRowsToTransmitters(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const name = row.name || row.nazwa || row.obiekt || row.object_name || row.site;
    const lat = Number(row.lat || row.latitude || row.szerokosc);
    const lon = Number(row.lon || row.lng || row.longitude || row.dlugosc);
    const mux = row.mux || row.multipleks || row.multiplex;
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon) || !mux) continue;
    const key = `${slugify(name)}-${lat.toFixed(5)}-${lon.toFixed(5)}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        id: key,
        name,
        site: row.site || row.obiekt || name,
        lat,
        lon,
        height_m: Number(row.height_m || row.wysokosc_terenu_m || 0),
        mast_m: Number(row.mast_m || row.wysokosc_masztu_m || row.antenna_height_m || 80),
        region: row.region || row.wojewodztwo || "",
        source: row.source || row.zrodlo || "import CSV",
        muxes: []
      });
    }
    grouped.get(key).muxes.push(normalizeMux({
      mux,
      channel: row.channel || row.kanal,
      frequency_mhz: row.frequency_mhz || row.czestotliwosc_mhz || row.frequency,
      erp_kw: row.erp_kw || row.erp || row.moc_kw,
      polarization: row.polarization || row.polaryzacja,
      band: row.band || row.pasmo
    }));
  }
  return [...grouped.values()];
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "nadajnik";
}

function exportLocalSettings() {
  const payload = {
    version: VERSION,
    exportedAt: new Date().toISOString(),
    home: state.home,
    antennaHeightM: state.receiverAntennaHeightM,
    overlays: state.overlays,
    muxFilters: [...state.activeMuxFilters],
    baseLayer: state.activeLayerName,
    coverageVisible: state.coverageVisible
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dvbt-mapa-ustawienia-${VERSION.replaceAll(" ", "_")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importLocalSettings(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.home) updateHome(data.home, { chooseBest: true, center: true, zoom: 12, save: true });
    if (Number.isFinite(Number(data.antennaHeightM))) {
      state.receiverAntennaHeightM = clamp(Number(data.antennaHeightM), 1, 40);
      saveAntennaHeight(state.receiverAntennaHeightM);
      $("antennaHeightInput").value = String(state.receiverAntennaHeightM);
    }
    if (data.overlays && typeof data.overlays === "object") {
      state.overlays = { ...state.overlays, ...data.overlays };
      saveOverlaySettings();
      syncOverlayVisibility();
    }
    if (Array.isArray(data.muxFilters)) {
      state.activeMuxFilters = new Set(data.muxFilters.filter((mux) => ALL_MUX.includes(mux)));
      if (!state.activeMuxFilters.size) state.activeMuxFilters = new Set(ALL_MUX);
      saveMuxFilters();
      applyFilters();
      selectBestTransmitter();
    }
    if (data.baseLayer && state.baseLayers[data.baseLayer]) setBaseLayer(data.baseLayer);
    if (typeof data.coverageVisible === "boolean") { state.coverageVisible = data.coverageVisible; saveCoverageVisible(); syncOverlayVisibility(); updateCoverageButton(); }
    showToast("Zaimportowano ustawienia lokalne");
  } catch (error) {
    console.error(error);
    showToast("Nie udało się zaimportować ustawień");
  } finally {
    event.target.value = "";
  }
}

async function clearLocalSettings() {
  [STORAGE_KEY, OVERLAY_STORAGE_KEY, MUX_STORAGE_KEY, BASE_LAYER_STORAGE_KEY, COVERAGE_STORAGE_KEY, "dvbt-mapa.antennaHeightM"].forEach((key) => localStorage.removeItem(key));
  showToast("Wyczyszczono ustawienia lokalne. Odświeżam aplikację...");
  setTimeout(() => location.reload(), 600);
}

function forceAppUpdate() {
  if (state.swRegistration?.waiting) {
    state.swRegistration.waiting.postMessage({ type: "SKIP_WAITING" });
    showToast("Aktualizuję aplikację...");
    return;
  }
  if (state.swRegistration) {
    state.swRegistration.update();
    showToast("Sprawdzam aktualizację...");
    return;
  }
  location.reload();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./service-worker.js");
      state.swRegistration = registration;
      if (registration.waiting) {
        state.updateWaiting = true;
        updateInstallUi();
      }
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            state.updateWaiting = true;
            updateInstallUi();
            showToast("Jest nowa wersja aplikacji — otwórz PWA i kliknij aktualizację");
          }
        });
      });
      navigator.serviceWorker.addEventListener("controllerchange", () => location.reload());
    } catch (error) {
      console.warn("Service Worker:", error);
    }
  });
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showToast.timeoutId);
  showToast.timeoutId = setTimeout(() => toast.classList.remove("visible"), 2600);
}

function loadSavedAntennaHeight() {
  try {
    const value = Number(localStorage.getItem("dvbt-mapa.antennaHeightM"));
    return Number.isFinite(value) ? clamp(value, 1, 40) : 6;
  } catch {
    return 6;
  }
}

function saveAntennaHeight(value) {
  try {
    localStorage.setItem("dvbt-mapa.antennaHeightM", String(value));
  } catch (error) {
    console.warn("Nie udało się zapisać wysokości anteny", error);
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function loadSavedHome() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_HOME };
    const data = JSON.parse(raw);
    if (!Number.isFinite(Number(data.lat)) || !Number.isFinite(Number(data.lon))) return { ...DEFAULT_HOME };
    return { lat: Number(data.lat), lon: Number(data.lon), name: data.name || "Zapisany punkt odbioru", source: data.source || "saved" };
  } catch {
    return { ...DEFAULT_HOME };
  }
}

function saveHome(home) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(home));
  } catch (error) {
    console.warn("Nie udało się zapisać lokalizacji", error);
  }
}

function loadSavedBaseLayer() {
  try {
    return localStorage.getItem(BASE_LAYER_STORAGE_KEY) || "Mapa standardowa";
  } catch {
    return "Mapa standardowa";
  }
}

function saveBaseLayer(name) {
  try {
    localStorage.setItem(BASE_LAYER_STORAGE_KEY, name);
  } catch (error) {
    console.warn("Nie udało się zapisać podkładu mapy", error);
  }
}

function loadSavedMuxFilters() {
  try {
    const raw = localStorage.getItem(MUX_STORAGE_KEY);
    if (!raw) return new Set(ALL_MUX);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set(ALL_MUX);
    const valid = parsed.filter((mux) => ALL_MUX.includes(mux));
    return new Set(valid.length ? valid : ALL_MUX);
  } catch {
    return new Set(ALL_MUX);
  }
}

function saveMuxFilters() {
  try {
    localStorage.setItem(MUX_STORAGE_KEY, JSON.stringify([...state.activeMuxFilters]));
  } catch (error) {
    console.warn("Nie udało się zapisać filtrów MUX", error);
  }
}

function locationSourceName(source) {
  const map = {
    default: "domyślny",
    saved: "zapisany",
    gps: "GPS",
    map: "kliknięcie mapy",
    drag: "przeciągnięcie znacznika",
    search: "wyszukiwarka",
    manual: "ręcznie"
  };
  return map[source] || source || "nieznane";
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return normalizeDeg(toDeg(Math.atan2(y, x)));
}

function shortestAngle(from, to) {
  return ((to - from + 540) % 360) - 180;
}

function normalizeDeg(value) {
  return ((value % 360) + 360) % 360;
}

function toRad(deg) {
  return deg * Math.PI / 180;
}

function toDeg(rad) {
  return rad * 180 / Math.PI;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash) + value.charCodeAt(i);
  return hash | 0;
}
