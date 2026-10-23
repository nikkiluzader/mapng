// OSM barrier=bollard nodes as stock BeamNG bollards (beamngPropLibrary.js
// BOLLARD_SHAPES): the steel bollard, or East Coast USA's concrete city
// bollard where OSM says concrete or stone. A bollard mapped on a road drawn
// for traffic is left out (it would stand in the AI's lane); on service roads,
// paths and squares it stands where mapped.
// Pure: callers pass world-space lookups.

import { BOLLARD_SHAPES } from './beamngPropLibrary.js';

const STONE = /concrete|stone|granite|brick/;

/**
 * @param {object} p
 * @param {Array} p.features              OSM features (barrier=bollard nodes are type 'street_furniture')
 * @param {Function} p.toWorld            (lat, lng) -> [x, y]
 * @param {Function} p.heightAt           (x, y) -> ground height
 * @param {Function} [p.onDrawnRoad]      (x, y) -> true on a carriageway drawn for traffic
 * @param {Function} [p.isBlocked]        (x, y) -> true where nothing may stand (under a bridge deck)
 * @returns {{ bollards: Array<{ shape, position, yaw, material }>, skipped: { onRoad: number, blocked: number } }}
 */
export function placeBollards({ features = [], toWorld, heightAt, onDrawnRoad = () => false, isBlocked = () => false }) {
  const bollards = [];
  const skipped = { onRoad: 0, blocked: 0 };
  for (const f of features) {
    if (f?.type !== 'street_furniture' || f.tags?.barrier !== 'bollard' || !f.geometry?.length) continue;
    const [x, y] = toWorld(f.geometry[0].lat, f.geometry[0].lng);
    if (onDrawnRoad(x, y)) { skipped.onRoad++; continue; }
    const z = heightAt(x, y);
    if (isBlocked(x, y, z)) { skipped.blocked++; continue; }
    const material = STONE.test(String(f.tags.material ?? '').toLowerCase()) ? 'concrete' : 'steel';
    bollards.push({ shape: BOLLARD_SHAPES[material].shapeFile, position: [x, y, z], yaw: 0, material });
  }
  return { bollards, skipped };
}
