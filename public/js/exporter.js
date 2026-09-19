// Exports : Google Maps, KML (importable dans Google My Maps), GPX, et texte.

/** Lien d'itinéraire Google Maps (départ, étapes, arrivée). Max 9 waypoints intermédiaires. */
export function googleMapsDirections(points, travelmode = 'walking') {
  if (points.length < 2) return null;
  const coord = (p) => `${p.lat},${p.lng}`;
  const origin = points[0];
  const destination = points[points.length - 1];
  const middle = points.slice(1, -1).slice(0, 9);
  const params = new URLSearchParams({
    api: '1',
    origin: coord(origin),
    destination: coord(destination),
    travelmode,
  });
  if (middle.length) params.set('waypoints', middle.map(coord).join('|'));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** Découpe un long itinéraire en plusieurs liens Google Maps de 10 étapes. */
export function googleMapsChunks(points, travelmode = 'walking') {
  const chunks = [];
  for (let i = 0; i < points.length - 1; i += 10) {
    const slice = points.slice(i, i + 11);
    if (slice.length >= 2) chunks.push(googleMapsDirections(slice, travelmode));
  }
  return chunks;
}

/** Lien de recherche d'un point unique sur Google Maps. */
export function googleMapsPlace(point) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${point.lat},${point.lng}`)}`;
}

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

/** KML : à importer dans Google My Maps (maps.google.com/mymaps → Importer). */
export function toKml(points, title = 'New York') {
  const placemarks = points.map((p, i) => `    <Placemark>
      <name>${escapeXml(`${i + 1}. ${p.name}`)}</name>
      <description>${escapeXml([p.description, p.price && `Prix : ${p.price}`, p.duration && `Durée conseillée : ${p.duration} min`].filter(Boolean).join('\n'))}</description>
      <Point><coordinates>${p.lng},${p.lat},0</coordinates></Point>
    </Placemark>`).join('\n');

  const line = points.length > 1 ? `    <Placemark>
      <name>${escapeXml(`Tracé — ${title}`)}</name>
      <LineString><tessellate>1</tessellate><coordinates>${points.map((p) => `${p.lng},${p.lat},0`).join(' ')}</coordinates></LineString>
    </Placemark>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(title)}</name>
${placemarks}
${line}
  </Document>
</kml>`;
}

/** GPX : pour les applis de randonnée / GPS. */
export function toGpx(points, title = 'New York') {
  const waypoints = points.map((p) => `  <wpt lat="${p.lat}" lon="${p.lng}"><name>${escapeXml(p.name)}</name></wpt>`).join('\n');
  const track = points.map((p) => `      <trkpt lat="${p.lat}" lon="${p.lng}"><name>${escapeXml(p.name)}</name></trkpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Carte Interactive New York" xmlns="http://www.topografix.com/GPX/1/1">
${waypoints}
  <trk><name>${escapeXml(title)}</name><trkseg>
${track}
  </trkseg></trk>
</gpx>`;
}

/** Résumé texte du programme, prêt à coller dans un message. */
export function toText(itinerary, title = 'Ma journée à New York') {
  const lines = [`🗽 ${title}`, ''];
  for (const step of itinerary.schedule) {
    if (step.type === 'travel') {
      const icon = step.mode === 'subway' ? '🚇' : '🚶';
      lines.push(`${step.time}  ${icon} ${step.from} → ${step.to} (${step.minutes} min, ${step.detail})`);
      step.steps.forEach((s) => lines.push(`         · ${s}`));
    } else if (step.type === 'visit') {
      lines.push(`${step.time}  📍 ${step.name} — jusqu'à ${step.endTime} (${step.duration} min)`);
      if (step.note) lines.push(`         ${step.note}`);
    } else if (step.type === 'meal') {
      lines.push(`${step.time}  🍽️ ${step.name} — jusqu'à ${step.endTime}`);
    } else if (step.type === 'wait') {
      lines.push(`${step.time}  ⏳ ${step.note}`);
    } else {
      lines.push(`${step.time}  🏨 ${step.name} — ${step.note}`);
    }
  }
  const s = itinerary.stats;
  lines.push('', `Total : ${s.label} · ${s.stops} étapes · ${Math.round(s.travelMinutes)} min de trajet · ${s.walkKm.toFixed(1)} km à pied · ${s.subwayLegs} trajet(s) en métro`);
  if (itinerary.warnings.length) {
    lines.push('', '⚠️ À vérifier :');
    itinerary.warnings.forEach((w) => lines.push(`  - ${w}`));
  }
  return lines.join('\n');
}

export function download(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
