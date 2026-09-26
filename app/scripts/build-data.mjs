// Builds the static data the app loads, from the snapshots in data-src/.
//   public/data/cells.json          [{ h3, nta, lat, lng }]  H3 res-8 cells over residential neighborhoods
//   public/data/neighborhoods.json  { [nta]: { name, borough, rent, rentEstimated, violentPer1k } }
// Run: node scripts/build-data.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { polygonToCells, cellToLatLng } from "h3-js";

const RES = 8;
const src = (f) => JSON.parse(readFileSync(new URL(`../data-src/${f}`, import.meta.url)));
const outDir = new URL("../public/data/", import.meta.url);

const ntaGeo = src("nta2020.geojson");
const rent = src("streeteasy_rent_by_nta.json");
const crime = src("compstat_by_nta.json");

const residential = ntaGeo.features.filter((f) => f.properties.ntatype === "0");

const cells = new Map();
for (const f of residential) {
  const nta = f.properties.nta2020;
  const polys = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates];
  for (const rings of polys) {
    // GeoJSON is [lng, lat]; isGeoJson = true
    for (const c of polygonToCells(rings, RES, true)) if (!cells.has(c)) cells.set(c, nta);
  }
}

const cellList = [...cells.entries()].sort().map(([h3, nta]) => {
  const [lat, lng] = cellToLatLng(h3);
  return { h3, nta, lat: +lat.toFixed(5), lng: +lng.toFixed(5) };
});

const neighborhoods = {};
for (const f of residential) {
  const nta = f.properties.nta2020;
  const r = rent[nta];
  neighborhoods[nta] = {
    name: f.properties.ntaname,
    borough: f.properties.boroname,
    rent: r.rent,
    rentEstimated: r.estimated,
    violentPer1k: crime.ntas[nta].violent_per_1k_ytd,
  };
}

mkdirSync(outDir, { recursive: true });
writeFileSync(new URL("cells.json", outDir), JSON.stringify(cellList));
writeFileSync(new URL("neighborhoods.json", outDir), JSON.stringify(neighborhoods));
writeFileSync(
  new URL("meta.json", outDir),
  JSON.stringify({ safety: { source: crime.source, note: crime.note, weekEnd: crime.week_end } }),
);
console.log(`${cellList.length} cells across ${Object.keys(neighborhoods).length} neighborhoods`);
