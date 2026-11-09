// The spawn and quicktravel points editor's actions, shared by the sidebar
// list (components/controls/SpawnPoints.vue), the 2D map's pins
// (components/map/spawnPointLayer.js) and its right-click menu. The list
// itself is in the store (store.points, services/spawnPoints.js).
import { useMainStore } from '../stores/mainStore';
import { MAX_POINTS, newPointId } from '../services/spawnPoints.js';

export function usePointsEditor() {
  const store = useMainStore();
  const list = () => store.points.map((p) => ({ ...p }));

  /** Add a point; returns its id, or null at the cap. The default one takes the spawn from the others. */
  function addPoint({ lat, lng, heading = 0, isDefault = false, name = '' }) {
    const points = list();
    if (points.length >= MAX_POINTS) return null;
    let id = newPointId();
    while (points.some((p) => p.id === id)) id = newPointId();
    if (isDefault) points.forEach((p) => { p.isDefault = false; });
    points.push({ id, kind: isDefault ? 'spawn' : 'quicktravel', name, lat, lng, heading, isDefault });
    store.setPoints(points);
    store.selectedPointId = id;
    return id;
  }

  function updatePoint(id, patch) {
    store.setPoints(list().map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function removePoint(id) {
    store.setPoints(list().filter((p) => p.id !== id));
  }

  /** Make this point the level's spawn, or (the same one again, or null) back to the automatic spawn. */
  function toggleDefault(id) {
    const was = store.points.find((p) => p.isDefault)?.id;
    store.setPoints(list().map((p) => ({ ...p, isDefault: id != null && p.id === id && was !== id })));
  }

  function clearPoints() {
    store.setPoints([]);
    store.pointTool = false;
  }

  /** The place-point tool on or off; it and the background-area tools take turns with the mouse. */
  function setTool(on) {
    store.pointTool = !!on;
    if (on && store.backgroundTool !== 'pan') store.backgroundTool = 'pan';
  }

  return { addPoint, updatePoint, removePoint, toggleDefault, clearPoints, setTool, full: () => store.points.length >= MAX_POINTS };
}
