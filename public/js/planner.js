// Génération automatique d'une journée à New York.
import { computeLeg, walkMinutes, formatDuration } from './routing.js';

const MEAL = { lunch: { at: 12 * 60 + 30, duration: 60, label: 'Déjeuner' }, dinner: { at: 19 * 60, duration: 75, label: 'Dîner' } };

export function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function toClock(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Ordonne les points par plus proche voisin depuis le départ, puis affine en 2-opt. */
function orderPoints(start, points) {
  const remaining = [...points];
  const route = [];
  let current = start;
  while (remaining.length) {
    let bestIndex = 0;
    let bestCost = Infinity;
    remaining.forEach((p, i) => {
      const cost = walkMinutes(current, p);
      if (cost < bestCost) {
        bestCost = cost;
        bestIndex = i;
      }
    });
    current = remaining[bestIndex];
    route.push(current);
    remaining.splice(bestIndex, 1);
  }
  return twoOpt(start, route);
}

function routeCost(start, route) {
  let total = 0;
  let prev = start;
  for (const p of route) {
    total += walkMinutes(prev, p);
    prev = p;
  }
  return total;
}

function twoOpt(start, route) {
  if (route.length < 4) return route;
  let best = route;
  let bestCost = routeCost(start, best);
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 60) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
        const cost = routeCost(start, candidate);
        if (cost < bestCost - 0.5) {
          best = candidate;
          bestCost = cost;
          improved = true;
        }
      }
    }
  }
  return best;
}

const INTEREST_SCORE = {
  monument: 10, vue: 10, musee: 8, parc: 7, quartier: 7, photo: 6, food: 5, shopping: 4, sport: 4, autre: 3, hotel: 0,
};

/**
 * Sélectionne automatiquement les points qui tiennent dans la journée,
 * en équilibrant intérêt et proximité avec l'hôtel.
 */
export function autoSelect(hotel, points, { budgetMinutes, categories = null, maxStops = 8 }) {
  const candidates = points
    .filter((p) => p.category !== 'hotel')
    .filter((p) => !categories || categories.includes(p.category))
    .map((p) => {
      const distance = walkMinutes(hotel, p);
      return { point: p, score: (INTEREST_SCORE[p.category] ?? 3) * 10 - distance * 0.8 };
    })
    .sort((a, b) => b.score - a.score);

  const chosen = [];
  let used = 0;
  for (const { point } of candidates) {
    if (chosen.length >= maxStops) break;
    // Estimation : visite + ~18 min de trajet moyen.
    const cost = (point.duration || 45) + 18;
    if (used + cost > budgetMinutes) continue;
    chosen.push(point);
    used += cost;
  }
  return chosen;
}

/**
 * Construit le programme détaillé : horaires, trajets, repas, avertissements.
 * `stops` est déjà dans l'ordre souhaité si `keepOrder` est vrai.
 */
export function buildItinerary({ hotel, stops, startTime = '09:00', endTime = '22:00', keepOrder = false, meals = true, returnToHotel = true }) {
  const ordered = keepOrder ? [...stops] : orderPoints(hotel, stops);
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);

  const schedule = [];
  const warnings = [];
  let clock = start;
  let current = hotel;
  let mealsDone = { lunch: false, dinner: false };

  schedule.push({ type: 'start', name: hotel.name, point: hotel, time: toClock(clock), note: 'Départ de l\'hébergement' });

  for (const point of ordered) {
    const leg = computeLeg(current, point);
    schedule.push({
      type: 'travel',
      from: current.name,
      to: point.name,
      mode: leg.mode,
      minutes: leg.minutes,
      km: leg.km,
      steps: leg.steps,
      detail: leg.detail,
      walkAlternativeMinutes: leg.walkAlternativeMinutes,
      time: toClock(clock),
    });
    clock += leg.minutes;

    // Pause repas si l'heure est venue et qu'on n'a pas encore mangé.
    for (const key of ['lunch', 'dinner']) {
      if (meals && !mealsDone[key] && clock >= MEAL[key].at) {
        const meal = MEAL[key];
        schedule.push({
          type: 'meal',
          name: `${meal.label} — près de ${point.name}`,
          point,
          time: toClock(clock),
          endTime: toClock(clock + meal.duration),
          duration: meal.duration,
          note: key === 'lunch'
            ? 'Pause déjeuner : cherchez un deli ou un food truck du quartier.'
            : 'Pause dîner : réservez si vous visez un restaurant précis.',
        });
        clock += meal.duration;
        mealsDone[key] = true;
      }
    }

    const openAt = toMinutes(point.openTime || '00:00');
    let closeAt = toMinutes(point.closeTime || '23:59');
    // Une fermeture « avant » l'ouverture (ex. 02:00) se situe le lendemain.
    if (closeAt <= openAt) closeAt += 1440;

    let waited = 0;
    if (clock < openAt) {
      waited = openAt - clock;
      clock = openAt;
      schedule.push({ type: 'wait', minutes: waited, note: `${Math.round(waited)} min d'attente : ${point.name} ouvre à ${point.openTime}.`, time: toClock(clock - waited) });
    }

    const arrival = clock;
    const duration = point.duration || 45;
    const departure = arrival + duration;

    if (arrival > closeAt) {
      warnings.push(`${point.name} sera probablement fermé à votre arrivée (${toClock(arrival)}, fermeture ${point.closeTime}).`);
    } else if (departure > closeAt) {
      warnings.push(`${point.name} ferme à ${point.closeTime} : il vous restera moins de temps que prévu.`);
    }
    if (departure > end) {
      warnings.push(`${point.name} dépasse votre heure de fin (${endTime}).`);
    }

    schedule.push({
      type: 'visit',
      point,
      name: point.name,
      time: toClock(arrival),
      endTime: toClock(departure),
      duration,
      note: point.description,
    });

    clock = departure;
    current = point;
  }

  if (returnToHotel && ordered.length) {
    const back = computeLeg(current, hotel);
    schedule.push({
      type: 'travel',
      from: current.name,
      to: hotel.name,
      mode: back.mode,
      minutes: back.minutes,
      km: back.km,
      steps: back.steps,
      detail: back.detail,
      time: toClock(clock),
    });
    clock += back.minutes;
    schedule.push({ type: 'end', name: hotel.name, point: hotel, time: toClock(clock), note: 'Retour à l\'hébergement' });
  }

  const travelMinutes = schedule.filter((s) => s.type === 'travel').reduce((sum, s) => sum + s.minutes, 0);
  const visitMinutes = schedule.filter((s) => s.type === 'visit').reduce((sum, s) => sum + s.duration, 0);

  return {
    schedule,
    warnings,
    order: ordered,
    stats: {
      stops: ordered.length,
      travelMinutes,
      visitMinutes,
      totalMinutes: clock - start,
      startTime: toClock(start),
      endTime: toClock(clock),
      walkKm: schedule.filter((s) => s.type === 'travel' && s.mode === 'walk').reduce((sum, s) => sum + s.km, 0),
      subwayLegs: schedule.filter((s) => s.type === 'travel' && s.mode === 'subway').length,
      label: formatDuration(clock - start),
    },
  };
}
