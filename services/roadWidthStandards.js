// The road width library: for each country, the lane width usual for each OpenStreetMap road class and the
// paved strip outside the edge line, for roads OpenStreetMap gives no width.
//
// What a road's width is taken from, in this order:
//   1. a width mapped in OpenStreetMap (width=*, or lanes with their own widths);
//   2. with Map data > Measure road widths on: the satellite picture, where the road's edges are clear;
//   3. this library, by the country the map is in and the road's class;
//   4. where the country is not in the library: its region's figures (REGION_WIDTHS);
//   5. where neither is known: MapNG's usual figures (services/roadWidth.js).
//
// The figures are per OpenStreetMap class, not per design class: a country's design classes do not map one
// to one onto the map's road types (a tester on Poland: "class name =/= road type in maps"). Each entry says
// which design classes its figures were read from. Where a rule gives a range, the figure for existing
// two-lane roads is taken, not the one for new construction.
//
// lanes: metres per lane by highway class (a *_link takes its class's). edge: metres of asphalt outside the
// edge line each side ({ default, <class>: ... }).

// confidence: how directly the figures were read (2026-11-14): 'high' from the rule itself, 'medium' from an
// official document quoting it, 'low' where the rule is behind a paywall and only its ranges were seen.
// singleLane: the least width of a road with one lane for both directions, where the rule gives one.
export const ROAD_WIDTH_STANDARDS = {
  US: {
    name: 'United States', confidence: 'low',
    lanes: { motorway: 3.7, trunk: 3.7, primary: 3.5, secondary: 3.5, tertiary: 3.25, unclassified: 3.0, residential: 3.0 },
    edge: { default: 1.0 },
    classes: 'MapNG\'s usual figures, measured on BeamNG\'s own levels. They lie inside the AASHTO ranges: freeway 12 ft (3.66 m), arterial 11 to 12 ft, collector 10 to 12 ft, local 9 to 12 ft. Shoulders are given as ranges only.',
    sources: ['FHWA, Mitigation Strategies for Design Exceptions (FHWA-SA-07-011), 2007, tables 3 and 7, quoting the AASHTO Green Book'],
  },
  CA: {
    name: 'Canada', confidence: 'low',
    lanes: { motorway: 3.7, trunk: 3.7, primary: 3.6, secondary: 3.6, tertiary: 3.25, unclassified: 3.0, residential: 3.0 },
    edge: { default: 1.0 },
    classes: 'motorway and trunk: freeway and National Highway System routes (3.7 m); primary and secondary: rural arterial and collector, undivided (British Columbia: 3.6 m); local streets 3.0 to 3.5 m (Toronto).',
    sources: ['Council of Ministers, National Highway System Engineering Guidelines, 2006', 'British Columbia Active Transportation Design Guide, section F, 2019, table F-25 (after the BC Supplement to the TAC guide)', 'City of Toronto, Lane Widths Guideline v3.0, 2025'],
  },
  BR: {
    name: 'Brazil', confidence: 'medium',
    lanes: { motorway: 3.6, trunk: 3.6, primary: 3.5, secondary: 3.5, tertiary: 3.3, unclassified: 3.0, residential: 3.0 },
    edge: { default: 1.0 },
    classes: 'DNER classes 0 and I: 3.6 m; I/II: 3.5 m; III: 3.3 m; IV-A: 3.0 m. OpenStreetMap in Brazil classes roads by the towns they serve, not by design class. The rule gives the whole shoulder (1.0 to 3.5 m), not its paved part.',
    sources: ['DER/PR, PSR-E 02/24, 2024, tables 1 and 4, after the DNER Manual de Projeto Geométrico de Rodovias Rurais, 1999'],
  },
  RU: {
    name: 'Russia', confidence: 'high', singleLane: 4.5,
    lanes: { motorway: 3.75, trunk: 3.75, primary: 3.5, secondary: 3.5, tertiary: 3.0, unclassified: 3.0, residential: 3.0 },
    edge: { default: 0.5 },
    classes: 'Categories I and II (two lanes): 3.75 m; III: 3.5 m; IV: 3.0 m; edge strip 0.5 m on II to IV. Primary is taken as category III (most regional roads), not II. A one-lane road (category V) is 4.5 m. Town streets are not from a rule read here.',
    sources: ['SP 34.13330.2021 "Avtomobilnye dorogi", table 5.9', 'GOST R 52398-2005, road classification'],
  },
  PL: {
    name: 'Poland', confidence: 'high', singleLane: 3.5,
    lanes: { motorway: 3.75, trunk: 3.5, primary: 3.25, secondary: 3.0, tertiary: 2.75, unclassified: 2.75, residential: 2.75 },
    edge: { default: 0, trunk: 0.75, primary: 0.5, secondary: 0.25 },
    classes: 'A 3.75 m; S and GP 3.5 m; G 3.5 m, or 3.25 or 3.0 m where room is short; Z 3.0 m (2.75); L 2.75 m; D 2.5 m. Primary (national roads), secondary (voivodeship) and tertiary (county) take the short-of-room figures, as existing roads are built. The outer strip is 0.75 m on GP and optional on G and Z; a tester measured 6.45 m of asphalt on a main road, which the secondary figures give.',
    sources: ['Rozporządzenie Ministra Infrastruktury z 24 czerwca 2022 r. (Dz.U. 2022 poz. 1518), paragraphs 17 and 23'],
  },
  DE: {
    name: 'Germany', confidence: 'medium',
    lanes: { motorway: 3.75, trunk: 3.5, primary: 3.5, secondary: 3.25, tertiary: 3.0, unclassified: 2.75, residential: 2.75 },
    edge: { default: 0, motorway: 1.0, trunk: 0.5, primary: 0.5, secondary: 0.25 },
    classes: 'Primary (Bundesstraße): RQ 11, 0.5 + 3.5 + 3.5 + 0.5 = 8.0 m. Secondary (Landesstraße): 7.0 m of carriageway on existing roads. Tertiary (Kreisstraße): RQ 9, 6.0 m paved with no centre line. Local roads and streets were not read from a rule.',
    sources: ['Regierungspräsidium Freiburg, B 31 West, Regelquerschnitt RQ 11, 2016', 'Regierung von Unterfranken, A 7, RQ 36 (RAA) and RQ 9', 'Bavarian StMB, Leitfaden für bestandsnahen Straßenausbau außerorts, 2021'],
  },
  GB: {
    name: 'United Kingdom', confidence: 'medium',
    lanes: { motorway: 3.65, trunk: 3.65, primary: 3.0, secondary: 3.0, tertiary: 2.75, unclassified: 2.75, residential: 2.75 },
    edge: { default: 0, motorway: 1.0, trunk: 1.0 },
    classes: 'Motorways and trunk roads (primary A roads): 7.3 m for two lanes, with a 1.0 m hard strip on rural ones. There is no national figure for other A, B and minor roads: 3.0 and 2.75 m are from roads testers measured (an A road 5.5 to 6.5 m across). Streets: 5.5 m of carriageway.',
    sources: ['DMRB CD 127 "Cross-sections and headrooms" v1.0.1, 2021', 'Department for Transport, Manual for Streets, 2007'],
  },
  FR: {
    name: 'France', confidence: 'high',
    lanes: { motorway: 3.5, trunk: 3.5, primary: 3.25, secondary: 3.0, tertiary: 2.75, unclassified: 2.75, residential: 2.75 },
    edge: { default: 0.25 },
    classes: 'Two-lane main roads by their function: 3.5, 3.25 or 3.0 m new; 3.25, 3.0 or 2.75 m where room is short, taken here for primary (nationale), secondary and tertiary (départementales). The carriageway is 0.25 m wider each side for the edge line.',
    sources: ['Cerema, Aménagement des routes principales, 2022, chapters 3 and 6'],
  },
  NL: {
    name: 'Netherlands', confidence: 'medium',
    lanes: { motorway: 3.5, trunk: 3.25, primary: 3.1, secondary: 3.1, tertiary: 2.75, unclassified: 2.75, residential: 2.75 },
    edge: { default: 0, motorway: 0.8, trunk: 0.8, primary: 0.45, secondary: 0.45 },
    classes: 'Through roads 3.5 and 3.25 m; distributor roads (N roads) 3.1 m with 0.45 m outside the edge line; access roads 4.5 to 6.0 m of asphalt in all, no centre line.',
    sources: ['TU Delft, Tabellenblad Wegontwerp (after the CROW Handboek Wegontwerp), 2017'],
  },
  IT: {
    name: 'Italy', confidence: 'medium',
    lanes: { motorway: 3.75, trunk: 3.75, primary: 3.5, secondary: 3.25, tertiary: 3.0, unclassified: 2.75, residential: 2.75 },
    edge: { default: 0.25, motorway: 1.0, trunk: 1.0, primary: 1.0, secondary: 0.5 },
    classes: 'The decree is for new roads: A, B and C1 3.75 m; C2 3.5 m; F2 3.25 m; town streets 2.75 m; paved shoulders of 1.0 to 1.75 m. Existing state and provincial roads are narrower, and no rule gives their widths: each class here is taken one step down from the decree (primary as C2, secondary as F2), and the shoulders likewise. This step down is a judgement, not a figure read from a source.',
    sources: ['D.M. 5 novembre 2001 n. 6792, table 3.4.a'],
  },
};

// A region's figures, for a country with no entry of its own. The Americas have none: MapNG's usual figures
// were measured on BeamNG's own levels, which are North American roads.
export const REGION_WIDTHS = {
  elsewhere: {
    lanes: { primary: 3.0, secondary: 3.0, tertiary: 2.75, unclassified: 2.75, residential: 2.75, living_street: 2.75 },
    edge: { default: 0.25 },
  },
};

/** The figures for a place: its country's, else its region's, else null (MapNG's usual ones). */
export function widthStandardFor(roadRules) {
  const code = roadRules?.countryCode;
  if (!code) return null;
  const own = ROAD_WIDTH_STANDARDS[code];
  if (own && own.lanes) return { ...own, from: code };
  if (roadRules.region === 'Americas') return null;
  return { ...REGION_WIDTHS.elsewhere, from: 'region' };
}

/** A class's lane width (a link road as its class) and edge strip in a set of figures; undefined where it says nothing. */
export function widthsForClass(standard, highway) {
  const base = String(highway || '').replace(/_link$/, '');
  const lane = standard?.lanes?.[base === 'living_street' ? 'residential' : base];
  const edge = standard?.edge ? (standard.edge[base] ?? standard.edge.default) : undefined;
  return { lane, edge, singleLane: standard?.singleLane };
}
