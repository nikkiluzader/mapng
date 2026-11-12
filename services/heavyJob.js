// Whether a Generate or an export is running in this page. The 3D preview stops drawing meanwhile
// (components/three/RenderPause.vue): the job runs on the page's one thread and gives it up between steps,
// and every pause would otherwise be spent drawing a frame nobody sees behind the progress card. On a slow
// graphics card that turned a ten-second export into minutes.
import { ref } from 'vue';

export const heavyJobRunning = ref(false);
