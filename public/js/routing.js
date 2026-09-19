// Calcul des temps de trajet entre deux points : à pied, ou à pied + métro.
import { STATIONS } from './subway.js';

const WALK_SPEED_KMH = 4.6;          // vitesse de marche moyenne en ville
const STREET_FACTOR = 1.28;          // Manhattan est un damier : on ne marche pas à vol d'oiseau
const SUBWAY_SPEED_KMH = 28;         // vitesse moyenne d'une rame, arrêts compris
const SUBWAY_WAIT_MIN = 6;           // attente moyenne sur le quai
const SUBWAY_ACCESS_MIN = 3;         // descendre puis remonter les escaliers
const MAX_STATION_WALK_KM = 1.0;     // au-delà, la station n'est pas pertinente
const MIN_SUBWAY_GAIN_MIN = 6;       // on ne prend le métro que si on gagne vraiment du temps

export function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function walkKm(a, b) {
  return haversineKm(a, b) * STREET_FACTOR;
}

export function walkMinutes(a, b) {
  return (walkKm(a, b) / WALK_SPEED_KMH) * 60;
}

function nearestStations(point, limit = 4) {
  return STATIONS
    .map((s) => ({ station: s, km: walkKm(point, s) }))
    .filter((s) => s.km <= MAX_STATION_WALK_KM)
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}

function sharedLines(a, b) {
  return a.lines.filter((l) => b.lines.includes(l));
}

/**
 * Meilleur trajet entre deux points.
 * Renvoie { mode, minutes, km, steps[], detail }.
 */
export function computeLeg(from, to) {
  const wMin = walkMinutes(from, to);
  const wKm = walkKm(from, to);
  const walking = {
    mode: 'walk',
    minutes: Math.round(wMin),
    km: wKm,
    steps: [`Marcher ${formatKm(wKm)} (${Math.round(wMin)} min)`],
    detail: 'À pied',
  };

  // Sous 1,1 km, le métro n'a aucun intérêt (accès + attente).
  if (wKm < 1.1) return walking;

  let best = null;
  for (const origin of nearestStations(from)) {
    for (const dest of nearestStations(to)) {
      if (origin.station.name === dest.station.name) continue;
      const rideKm = haversineKm(origin.station, dest.station) * 1.15;
      if (rideKm < 0.6) continue;

      const common = sharedLines(origin.station, dest.station);
      // Sans ligne commune il faut changer : on ajoute une correspondance.
      const transfer = common.length ? 0 : SUBWAY_WAIT_MIN * 0.8 + 2;
      const rideMin = (rideKm / SUBWAY_SPEED_KMH) * 60;
      const accessWalk = (origin.km / WALK_SPEED_KMH) * 60;
      const egressWalk = (dest.km / WALK_SPEED_KMH) * 60;
      const total = accessWalk + SUBWAY_ACCESS_MIN + SUBWAY_WAIT_MIN + rideMin + transfer + egressWalk;

      if (!best || total < best.total) {
        best = { total, origin, dest, common, rideMin, accessWalk, egressWalk, transfer };
      }
    }
  }

  if (!best || best.total > wMin - MIN_SUBWAY_GAIN_MIN) return walking;

  const lineLabel = best.common.length
    ? `ligne ${best.common.slice(0, 3).join(' / ')}`
    : `${best.origin.station.lines[0]} puis ${best.dest.station.lines[0]} (1 correspondance)`;

  return {
    mode: 'subway',
    minutes: Math.round(best.total),
    km: wKm,
    line: best.common[0] || best.origin.station.lines[0],
    steps: [
      `Marcher ${formatKm(best.origin.km)} jusqu'à ${best.origin.station.name} (${Math.round(best.accessWalk)} min)`,
      `Prendre le métro ${lineLabel} jusqu'à ${best.dest.station.name} (~${Math.round(best.rideMin + SUBWAY_WAIT_MIN)} min avec l'attente)`,
      `Marcher ${formatKm(best.dest.km)} jusqu'à destination (${Math.round(best.egressWalk)} min)`,
    ],
    detail: `Métro ${lineLabel}`,
    walkAlternativeMinutes: Math.round(wMin),
  };
}

export function formatKm(km) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

export function formatDuration(minutes) {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${String(rest).padStart(2, '0')}` : `${h} h`;
}
