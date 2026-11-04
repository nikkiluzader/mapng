// The 3D preview's buildings, trees, fences and street furniture built in a
// Web Worker (components/three/OSMFeatures3D.vue): createOSMGroup ran on the
// page's one thread and froze the window for seconds in dense areas. The
// finished meshes come back as plain data (daeWorker.js describeScene), their
// buffers transferred, not copied.
import { createOSMGroup } from './export3d.js';
import { describeScene, sceneBuffers } from './daeWorker.js';

self.onmessage = ({ data }) => {
  const { id, terrain, options } = data;
  try {
    const group = createOSMGroup(terrain, options);
    group.updateMatrixWorld(true);
    const desc = describeScene(group);
    self.postMessage({ id, desc }, [...sceneBuffers(desc)]);
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) });
  }
};
