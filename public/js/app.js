import * as api from './api.js';
import { buildItinerary, autoSelect, toMinutes } from './planner.js';
import { formatKm, formatDuration } from './routing.js';
import * as exporter from './exporter.js';

/* ------------------------------ État ------------------------------- */
const app = {
  points: [],
  selected: [],        // ids, dans l'ordre choisi
  filters: new Set(),
  search: '',
  itinerary: null,
  placing: false,
  editingId: null,
  markers: new Map(),
  routeLayer: null,
};

const CATEGORY_META = {
  monument: { label: 'Monument', color: '#ff6b4a', icon: '🏛' },
  musee: { label: 'Musée', color: '#a855f7', icon: '🖼' },
  parc: { label: 'Parc', color: '#36c48b', icon: '🌳' },
  vue: { label: 'Point de vue', color: '#4aa8ff', icon: '🔭' },
  quartier: { label: 'Quartier', color: '#ffb547', icon: '🏙' },
  food: { label: 'Food', color: '#f2545b', icon: '🍕' },
  shopping: { label: 'Shopping', color: '#ec4899', icon: '🛍' },
  photo: { label: 'Spot photo', color: '#22d3ee', icon: '📸' },
  sport: { label: 'Sport', color: '#84cc16', icon: '⚾' },
  hotel: { label: 'Hôtel', color: '#94a3b8', icon: '🏨' },
  autre: { label: 'Autre', color: '#64748b', icon: '📍' },
};

const $ = (id) => document.getElementById(id);

/* ------------------------------ Carte ------------------------------ */
// Leaflet vient d'un CDN : s'il est injoignable (hors ligne, réseau filtré),
// le reste du site doit continuer à fonctionner sans la carte.
const mapReady = typeof L !== 'undefined';
let map = null;

if (mapReady) {
  map = L.map('map', { zoomControl: true, center: [40.7484, -73.9857], zoom: 13 });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap, &copy; CARTO',
    maxZoom: 20,
  }).addTo(map);

  map.on('click', (e) => {
    if (!app.placing) return;
    openPointModal(null, { lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) });
    stopPlacing();
  });
} else {
  document.getElementById('map').innerHTML =
    '<div class="map-offline"><p>🗺️ La carte n\'a pas pu se charger.</p>'
    + '<p>Rechargez la page ; les fonds de carte nécessitent une connexion internet.</p>'
    + '<p>Les listes de lieux et la génération d\'itinéraires restent utilisables.</p></div>';
}

function markerIcon(point, index = null) {
  const meta = CATEGORY_META[point.category] || CATEGORY_META.autre;
  const inner = index !== null ? `<span>${index}</span>` : `<span>${meta.icon}</span>`;
  return L.divIcon({
    className: '',
    html: `<div class="pin" style="background:${meta.color}">${inner}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    popupAnchor: [0, -26],
  });
}

function popupHtml(point) {
  const meta = CATEGORY_META[point.category] || CATEGORY_META.autre;
  const chosen = app.selected.includes(point.id);
  return `
    <div class="popup-title">${escapeHtml(point.name)}</div>
    <div class="popup-meta">${meta.icon} ${meta.label} · ${point.duration} min${point.price ? ` · ${escapeHtml(point.price)}` : ''}<br>
      ${point.openTime}–${point.closeTime} · ajouté par ${escapeHtml(point.author || '?')}</div>
    ${point.description ? `<div>${escapeHtml(point.description)}</div>` : ''}
    <div class="popup-actions">
      <button class="btn btn-primary" data-act="toggle" data-id="${point.id}">${chosen ? 'Retirer de ma journée' : 'Ajouter à ma journée'}</button>
      <button class="btn" data-act="edit" data-id="${point.id}">Modifier</button>
      <button class="btn" data-act="gmaps" data-id="${point.id}">Google Maps</button>
    </div>`;
}

function renderMarkers() {
  if (!mapReady) return;
  for (const marker of app.markers.values()) marker.remove();
  app.markers.clear();
  for (const point of visiblePoints()) {
    const orderIndex = app.selected.indexOf(point.id);
    const marker = L.marker([point.lat, point.lng], {
      icon: markerIcon(point, orderIndex >= 0 ? orderIndex + 1 : null),
      title: point.name,
    }).addTo(map);
    marker.bindPopup(() => popupHtml(point));
    app.markers.set(point.id, marker);
  }
}

// Délégation des clics dans les popups Leaflet.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.popup-actions [data-act]');
  if (!btn) return;
  const point = app.points.find((p) => p.id === btn.dataset.id);
  if (!point) return;
  if (btn.dataset.act === 'toggle') toggleSelection(point.id);
  if (btn.dataset.act === 'edit') openPointModal(point);
  if (btn.dataset.act === 'gmaps') window.open(exporter.googleMapsPlace(point), '_blank', 'noopener');
});

/* ---------------------------- Liste lieux --------------------------- */
function visiblePoints() {
  const q = app.search.trim().toLowerCase();
  return app.points.filter((p) => {
    if (app.filters.size && !app.filters.has(p.category)) return false;
    if (!q) return true;
    return `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(q);
  });
}

function renderCategoryChips() {
  const counts = {};
  for (const p of app.points) counts[p.category] = (counts[p.category] || 0) + 1;
  $('categoryChips').innerHTML = Object.entries(CATEGORY_META)
    .filter(([key]) => counts[key])
    .map(([key, meta]) => `<button class="chip ${app.filters.has(key) ? 'active' : ''}" data-cat="${key}">${meta.icon} ${meta.label} (${counts[key]})</button>`)
    .join('');
}

function renderPointList() {
  const list = visiblePoints();
  $('pointsCount').textContent = `${list.length} lieu${list.length > 1 ? 'x' : ''} affiché${list.length > 1 ? 's' : ''} sur ${app.points.length}`;
  $('pointList').innerHTML = list.map((p) => {
    const meta = CATEGORY_META[p.category] || CATEGORY_META.autre;
    const chosen = app.selected.includes(p.id);
    return `<div class="item ${chosen ? 'selected' : ''}" data-id="${p.id}">
      <div class="item-head">
        <div>
          <div class="item-title"><span class="cat-dot" style="background:${meta.color}"></span>${escapeHtml(p.name)}</div>
          <div class="item-meta"><span>${meta.label}</span><span>${p.duration} min</span>${p.price ? `<span>${escapeHtml(p.price)}</span>` : ''}<span>${p.openTime}–${p.closeTime}</span></div>
        </div>
      </div>
      ${p.description ? `<div class="item-desc">${escapeHtml(p.description)}</div>` : ''}
      <div class="item-actions">
        <button class="btn ${chosen ? 'btn-primary' : ''}" data-act="toggle">${chosen ? '✓ Dans ma journée' : '+ Ma journée'}</button>
        <button class="btn" data-act="locate">Voir</button>
        <button class="btn" data-act="edit">Modifier</button>
      </div>
    </div>`;
  }).join('') || '<p class="empty">Aucun lieu ne correspond.</p>';
}

$('pointList').addEventListener('click', (e) => {
  const item = e.target.closest('.item');
  if (!item) return;
  const point = app.points.find((p) => p.id === item.dataset.id);
  if (!point) return;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'toggle') return toggleSelection(point.id);
  if (act === 'edit') return openPointModal(point);
  focusPoint(point);
});

$('categoryChips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const cat = chip.dataset.cat;
  app.filters.has(cat) ? app.filters.delete(cat) : app.filters.add(cat);
  renderCategoryChips();
  renderPointList();
  renderMarkers();
});

$('search').addEventListener('input', (e) => {
  app.search = e.target.value;
  renderPointList();
  renderMarkers();
});

function focusPoint(point) {
  if (!mapReady) return;
  map.setView([point.lat, point.lng], Math.max(map.getZoom(), 15), { animate: true });
  app.markers.get(point.id)?.openPopup();
  if (window.innerWidth <= 860) $('panel').classList.remove('open');
}

/* --------------------------- Sélection ------------------------------ */
function toggleSelection(id) {
  const index = app.selected.indexOf(id);
  if (index >= 0) app.selected.splice(index, 1);
  else app.selected.push(id);
  refreshSelection();
}

function refreshSelection() {
  $('selCount').textContent = app.selected.length;
  const items = app.selected.map((id) => app.points.find((p) => p.id === id)).filter(Boolean);
  $('selectedList').innerHTML = items.map((p, i) => `
    <li draggable="true" data-id="${p.id}">
      <span class="grip">⋮⋮</span>
      <span class="idx">${i + 1}</span>
      <span class="name">${escapeHtml(p.name)}</span>
      <button class="rm" data-id="${p.id}" title="Retirer">×</button>
    </li>`).join('') || '<li style="justify-content:center;color:var(--muted);cursor:default">Aucune étape pour l\'instant</li>';
  renderPointList();
  renderMarkers();
}

$('selectedList').addEventListener('click', (e) => {
  const id = e.target.closest('.rm')?.dataset.id;
  if (id) toggleSelection(id);
});

$('clearSelection').addEventListener('click', () => {
  app.selected = [];
  refreshSelection();
});

// Réordonnancement par glisser-déposer.
let dragId = null;
$('selectedList').addEventListener('dragstart', (e) => {
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  dragId = li.dataset.id;
  li.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});
$('selectedList').addEventListener('dragend', (e) => {
  e.target.closest('li')?.classList.remove('dragging');
  document.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
});
$('selectedList').addEventListener('dragover', (e) => {
  e.preventDefault();
  const li = e.target.closest('li[data-id]');
  if (!li || li.dataset.id === dragId) return;
  document.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
  li.classList.add('drop-target');
});
$('selectedList').addEventListener('drop', (e) => {
  e.preventDefault();
  const li = e.target.closest('li[data-id]');
  if (!li || !dragId || li.dataset.id === dragId) return;
  const from = app.selected.indexOf(dragId);
  const to = app.selected.indexOf(li.dataset.id);
  app.selected.splice(to, 0, app.selected.splice(from, 1)[0]);
  dragId = null;
  refreshSelection();
});

/* --------------------------- Hôtel / départ -------------------------- */
function renderHotelSelect() {
  const select = $('hotelSelect');
  const previous = select.value;
  const hotels = app.points.filter((p) => p.category === 'hotel');
  const others = app.points.filter((p) => p.category !== 'hotel');
  select.innerHTML = [
    '<option value="">— Times Square (par défaut) —</option>',
    hotels.length ? `<optgroup label="Hôtels / logements">${hotels.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}</optgroup>` : '',
    `<optgroup label="Autres lieux">${others.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}</optgroup>`,
  ].join('');
  if (previous) select.value = previous;
}

function currentHotel() {
  const point = app.points.find((p) => p.id === $('hotelSelect').value);
  return point || { id: '__default', name: 'Times Square', lat: 40.7580, lng: -73.9855, category: 'hotel', duration: 0, openTime: '00:00', closeTime: '23:59' };
}

/* --------------------------- Génération ------------------------------ */
const PACE_FACTOR = { tranquille: 1.3, normal: 1, intense: 0.8 };

$('autofillBtn').addEventListener('click', () => {
  const hotel = currentHotel();
  const budget = Math.max(60, toMinutes($('endTime').value) - toMinutes($('startTime').value));
  const maxStops = Number($('maxStops').value) || 7;
  const categories = app.filters.size ? [...app.filters] : null;
  const picks = autoSelect(hotel, app.points, { budgetMinutes: budget * 0.85, categories, maxStops });
  if (!picks.length) return toast('Aucun lieu ne rentre dans ce créneau. Élargissez les horaires.', true);
  app.selected = picks.map((p) => p.id);
  refreshSelection();
  toast(`${picks.length} lieux proposés. Réordonnez-les ou générez directement.`);
});

$('generateBtn').addEventListener('click', () => {
  const stops = app.selected.map((id) => app.points.find((p) => p.id === id)).filter(Boolean);
  if (!stops.length) return toast('Sélectionnez au moins un lieu (ou cliquez sur « Me proposer des lieux »).', true);
  const hotel = currentHotel();
  const factor = PACE_FACTOR[$('pace').value] || 1;

  const adjusted = stops.map((p) => ({ ...p, duration: Math.round((p.duration || 45) * factor) }));
  app.itinerary = buildItinerary({
    hotel,
    stops: adjusted,
    startTime: $('startTime').value || '09:00',
    endTime: $('endTime').value || '22:00',
    keepOrder: false,
    meals: $('mealsCheck').checked,
    returnToHotel: $('returnCheck').checked,
  });
  // L'ordre optimisé devient l'ordre affiché, pour que l'utilisateur puisse le retoucher.
  app.selected = app.itinerary.order.map((p) => p.id);
  refreshSelection();
  renderItinerary();
  switchTab('itineraire');
  toast('Itinéraire généré ! Vous pouvez réordonner les étapes puis regénérer.');
});

function itineraryPoints() {
  const hotel = currentHotel();
  const stops = app.itinerary.order;
  const list = [hotel, ...stops];
  if ($('returnCheck').checked) list.push(hotel);
  return list;
}

function renderItinerary() {
  const iti = app.itinerary;
  $('itineraryEmpty').hidden = true;
  $('itineraryContent').hidden = false;

  const s = iti.stats;
  $('itineraryStats').innerHTML = `
    <div class="stat"><b>${s.startTime} → ${s.endTime}</b><span>Journée de ${s.label}</span></div>
    <div class="stat"><b>${s.stops}</b><span>étapes</span></div>
    <div class="stat"><b>${formatDuration(s.travelMinutes)}</b><span>de trajet (${s.subwayLegs} en métro)</span></div>
    <div class="stat"><b>${s.walkKm.toFixed(1)} km</b><span>à pied</span></div>`;

  $('itineraryWarnings').innerHTML = iti.warnings.map((w) => `<div class="warning">⚠️ ${escapeHtml(w)}</div>`).join('');

  $('timeline').innerHTML = iti.schedule.map((step, i) => {
    if (step.type === 'travel') {
      const icon = step.mode === 'subway' ? '🚇' : '🚶';
      const alt = step.walkAlternativeMinutes ? `<div class="tl-note">À pied : ${step.walkAlternativeMinutes} min (${formatKm(step.km)})</div>` : '';
      return `<div class="tl travel"><div class="tl-time">${step.time}</div><div>
        <div class="tl-title">${icon} ${escapeHtml(step.to)} — ${step.minutes} min</div>
        <div class="tl-note">${escapeHtml(step.detail)} depuis ${escapeHtml(step.from)}</div>
        <ul class="tl-steps">${step.steps.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>${alt}
      </div></div>`;
    }
    if (step.type === 'visit') {
      return `<div class="tl visit"><div class="tl-time">${step.time}</div><div>
        <div class="tl-title">📍 ${escapeHtml(step.name)}</div>
        <div class="tl-note">Jusqu'à ${step.endTime} · ${step.duration} min${step.point.price ? ` · ${escapeHtml(step.point.price)}` : ''}</div>
        ${step.note ? `<div class="tl-note">${escapeHtml(step.note)}</div>` : ''}
        <div class="tl-actions">
          <button class="btn" data-tl="locate" data-id="${step.point.id}">Voir sur la carte</button>
          <button class="btn" data-tl="shorter" data-i="${i}">− 15 min</button>
          <button class="btn" data-tl="longer" data-i="${i}">+ 15 min</button>
          <button class="btn btn-danger" data-tl="remove" data-id="${step.point.id}">Retirer</button>
        </div>
      </div></div>`;
    }
    if (step.type === 'meal') {
      return `<div class="tl meal"><div class="tl-time">${step.time}</div><div>
        <div class="tl-title">🍽️ ${escapeHtml(step.name)}</div>
        <div class="tl-note">Jusqu'à ${step.endTime} · ${escapeHtml(step.note)}</div></div></div>`;
    }
    if (step.type === 'wait') {
      return `<div class="tl wait"><div class="tl-time">${step.time}</div><div><div class="tl-note">⏳ ${escapeHtml(step.note)}</div></div></div>`;
    }
    return `<div class="tl"><div class="tl-time">${step.time}</div><div>
      <div class="tl-title">🏨 ${escapeHtml(step.name)}</div><div class="tl-note">${escapeHtml(step.note)}</div></div></div>`;
  }).join('');

  drawRoute();
  renderGmapsLinks();
}

$('timeline').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tl]');
  if (!btn) return;
  const action = btn.dataset.tl;
  if (action === 'locate') {
    const point = app.points.find((p) => p.id === btn.dataset.id);
    if (point) focusPoint(point);
    return;
  }
  if (action === 'remove') {
    toggleSelection(btn.dataset.id);
    $('generateBtn').click();
    return;
  }
  // Ajuster la durée de visite modifie le point sur le serveur (visible par tous).
  const step = app.itinerary.schedule[Number(btn.dataset.i)];
  if (!step?.point) return;
  const delta = action === 'longer' ? 15 : -15;
  const point = app.points.find((p) => p.id === step.point.id);
  if (!point) return;
  const duration = Math.max(0, (point.duration || 45) + delta);
  api.updatePoint(point.id, { ...point, duration })
    .then((updated) => {
      Object.assign(point, updated);
      $('generateBtn').click();
    })
    .catch((err) => toast(err.message, true));
});

function drawRoute() {
  if (!mapReady) return;
  app.routeLayer?.remove();
  const coords = itineraryPoints().map((p) => [p.lat, p.lng]);
  if (coords.length < 2) return;
  app.routeLayer = L.polyline(coords, { color: '#ff6b4a', weight: 4, opacity: .85, dashArray: '2 8', lineCap: 'round' }).addTo(map);
  map.fitBounds(app.routeLayer.getBounds(), { padding: [50, 50] });
}

function renderGmapsLinks() {
  const chunks = exporter.googleMapsChunks(itineraryPoints(), 'walking');
  $('gmapsLinks').innerHTML = chunks.length > 1
    ? chunks.map((url, i) => `<a href="${url}" target="_blank" rel="noopener">Partie ${i + 1} sur Google Maps →</a>`).join('')
    : '';
}

/* ----------------------------- Exports ------------------------------- */
$('exportGmapsWalk').addEventListener('click', () => openGmaps('walking'));
$('exportGmapsTransit').addEventListener('click', () => openGmaps('transit'));

function openGmaps(mode) {
  const points = itineraryPoints();
  const url = exporter.googleMapsDirections(points.slice(0, 11), mode);
  if (!url) return toast('Itinéraire trop court.', true);
  window.open(url, '_blank', 'noopener');
  if (points.length > 11) toast('Plus de 10 étapes : les liens des parties suivantes sont listés en bas.');
}

$('exportKml').addEventListener('click', () => {
  exporter.download('journee-new-york.kml', exporter.toKml(itineraryPoints(), 'Ma journée à New York'), 'application/vnd.google-earth.kml+xml');
  toast('KML téléchargé. Importez-le dans Google My Maps (Créer une carte → Importer).');
});
$('exportGpx').addEventListener('click', () => {
  exporter.download('journee-new-york.gpx', exporter.toGpx(itineraryPoints(), 'Ma journée à New York'), 'application/gpx+xml');
});
$('copyText').addEventListener('click', async () => {
  const text = exporter.toText(app.itinerary);
  try {
    await navigator.clipboard.writeText(text);
    toast('Programme copié dans le presse-papiers.');
  } catch {
    exporter.download('journee-new-york.txt', text);
  }
});
$('exportAllKml').addEventListener('click', () => {
  exporter.download('points-new-york.kml', exporter.toKml(app.points, 'Tous les lieux — New York'), 'application/vnd.google-earth.kml+xml');
});
$('exportAllJson').addEventListener('click', () => {
  exporter.download('points-new-york.json', JSON.stringify(app.points, null, 2), 'application/json');
});

/* --------------------------- Sauvegardes ----------------------------- */
$('saveItineraryBtn').addEventListener('click', async () => {
  const title = prompt('Nom de cette journée :', `Journée du ${new Date().toLocaleDateString('fr-FR')}`);
  if (title === null) return;
  try {
    await api.saveItinerary({
      title,
      startTime: $('startTime').value,
      stops: app.itinerary.order.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng })),
    });
    await loadSaved();
    toast('Itinéraire enregistré et partagé avec le groupe.');
  } catch (err) {
    toast(err.message, true);
  }
});

async function loadSaved() {
  let saved = [];
  try { saved = await api.getItineraries(); } catch { /* non bloquant */ }
  $('savedList').innerHTML = saved.map((it) => `
    <div class="item" data-id="${it.id}">
      <div class="item-title">${escapeHtml(it.title)}</div>
      <div class="item-meta"><span>${it.stops.length} étapes</span><span>par ${escapeHtml(it.author)}</span><span>${new Date(it.createdAt).toLocaleDateString('fr-FR')}</span></div>
      <div class="item-actions">
        <button class="btn btn-primary" data-act="load">Charger</button>
        <button class="btn btn-danger" data-act="del">Supprimer</button>
      </div>
    </div>`).join('') || '<p class="empty">Aucune journée enregistrée.</p>';
}

$('savedList').addEventListener('click', async (e) => {
  const item = e.target.closest('.item');
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!item || !act) return;
  const saved = (await api.getItineraries()).find((i) => i.id === item.dataset.id);
  if (!saved) return;
  if (act === 'del') {
    try { await api.deleteItinerary(saved.id); await loadSaved(); toast('Supprimé.'); }
    catch (err) { toast(err.message, true); }
    return;
  }
  // Recharge les étapes encore existantes ; celles supprimées entre-temps sont ignorées.
  const ids = saved.stops.map((s) => s.id).filter((id) => app.points.some((p) => p.id === id));
  if (!ids.length) return toast('Les lieux de cette journée n\'existent plus.', true);
  app.selected = ids;
  if (saved.startTime) $('startTime').value = saved.startTime;
  refreshSelection();
  switchTab('journee');
  toast(`« ${saved.title} » chargée. Cliquez sur Générer.`);
});

/* ------------------------- Ajout / édition --------------------------- */
$('addPointBtn').addEventListener('click', () => {
  if (!api.state.user) return toast('Connectez-vous pour ajouter un lieu.', true);
  startPlacing();
});

function startPlacing() {
  if (!mapReady) return toast('La carte n\'est pas disponible : saisissez les coordonnées à la main.', true);
  app.placing = true;
  $('mapHint').hidden = false;
  map.getContainer().style.cursor = 'crosshair';
  if (window.innerWidth <= 860) $('panel').classList.remove('open');
}

function stopPlacing() {
  app.placing = false;
  $('mapHint').hidden = true;
  if (mapReady) map.getContainer().style.cursor = '';
}

$('cancelPlacing').addEventListener('click', stopPlacing);

function openPointModal(point, coords = null) {
  if (!api.state.user) return toast('Connectez-vous pour modifier la carte.', true);
  app.editingId = point?.id || null;
  $('modalTitle').textContent = point ? 'Modifier le lieu' : 'Nouveau lieu';
  $('fName').value = point?.name || '';
  $('fCategory').value = point?.category || 'monument';
  $('fDuration').value = point?.duration ?? 45;
  $('fOpen').value = point?.openTime || '00:00';
  $('fClose').value = point?.closeTime || '23:59';
  $('fPrice').value = point?.price || '';
  $('fDesc').value = point?.description || '';
  $('fLat').value = point?.lat ?? coords?.lat ?? '';
  $('fLng').value = point?.lng ?? coords?.lng ?? '';
  $('deletePointBtn').hidden = !point;
  $('formError').hidden = true;
  $('pointModal').hidden = false;
  $('fName').focus();
}

function closeModal() {
  $('pointModal').hidden = true;
  app.editingId = null;
}
$('modalClose').addEventListener('click', closeModal);
$('cancelForm').addEventListener('click', closeModal);
$('pointModal').addEventListener('click', (e) => { if (e.target.id === 'pointModal') closeModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('pointModal').hidden) closeModal();
  else if (app.placing) stopPlacing();
});

$('pointForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fields = {
    name: $('fName').value.trim(),
    category: $('fCategory').value,
    duration: Number($('fDuration').value),
    openTime: $('fOpen').value,
    closeTime: $('fClose').value,
    price: $('fPrice').value.trim(),
    description: $('fDesc').value.trim(),
    lat: Number($('fLat').value),
    lng: Number($('fLng').value),
  };
  try {
    if (app.editingId) {
      const updated = await api.updatePoint(app.editingId, fields);
      const index = app.points.findIndex((p) => p.id === app.editingId);
      app.points[index] = updated;
      toast('Lieu mis à jour.');
    } else {
      const created = await api.addPoint(fields);
      app.points.push(created);
      toast('Lieu ajouté et partagé avec le groupe.');
    }
    closeModal();
    refreshAll();
  } catch (err) {
    $('formError').textContent = err.message;
    $('formError').hidden = false;
  }
});

$('deletePointBtn').addEventListener('click', async () => {
  if (!app.editingId || !confirm('Supprimer définitivement ce lieu pour tout le monde ?')) return;
  try {
    await api.deletePoint(app.editingId);
    app.points = app.points.filter((p) => p.id !== app.editingId);
    app.selected = app.selected.filter((id) => id !== app.editingId);
    closeModal();
    refreshAll();
    toast('Lieu supprimé.');
  } catch (err) {
    toast(err.message, true);
  }
});

/* ------------------------------ Onglets ------------------------------ */
function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
  if (window.innerWidth <= 860) $('panel').classList.add('open');
}
document.querySelector('.tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) switchTab(tab.dataset.tab);
});
$('panelToggle').addEventListener('click', () => $('panel').classList.toggle('open'));

/* --------------------------- Connexion ------------------------------- */
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginError').hidden = true;
  try {
    await api.login($('username').value, $('password').value);
    $('login').style.display = 'none';
    updateUserChip();
    await refreshAll();
  } catch (err) {
    $('loginError').textContent = err.message;
    $('loginError').hidden = false;
  }
});

$('guestBtn').addEventListener('click', async () => {
  $('login').style.display = 'none';
  updateUserChip();
  await refreshAll();
});

$('logoutBtn').addEventListener('click', () => {
  api.logout();
  location.reload();
});

function updateUserChip() {
  $('userChip').textContent = api.state.user || 'invité';
  $('logoutBtn').textContent = api.state.user ? 'Déconnexion' : 'Se connecter';
  if (!api.state.user) $('logoutBtn').onclick = () => location.reload();
  const badge = $('modeBadge');
  badge.textContent = api.state.mode === 'server' ? 'partagé' : 'local';
  badge.classList.toggle('local', api.state.mode !== 'server');
  badge.title = api.state.mode === 'server'
    ? 'Les points sont enregistrés sur le serveur et visibles par tout le groupe.'
    : 'Pas de serveur détecté : les points sont enregistrés dans ce navigateur uniquement.';
}

/* ----------------------------- Utilitaires --------------------------- */
function escapeHtml(value) {
  return String(value ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer = null;
function toast(message, isError = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
}

async function refreshAll() {
  app.points = await api.getPoints();
  renderCategoryChips();
  renderPointList();
  renderMarkers();
  renderHotelSelect();
  refreshSelection();
  await loadSaved();
}

/* ------------------------------ Démarrage ---------------------------- */
(async function start() {
  await api.detectMode();
  updateUserChip();
  if (api.state.user) {
    $('login').style.display = 'none';
    await refreshAll();
  } else {
    // On charge quand même la carte derrière l'écran de connexion.
    await refreshAll();
  }
})();
