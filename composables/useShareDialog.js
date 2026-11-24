// The "Share & load settings" window (components/modals/ShareDialog.vue):
// opened from the share icon in the sidebar's top bar (AppSidebar.vue), shown
// by the control panel, which owns the settings and the share controls.
import { ref } from 'vue';

export const shareDialogOpen = ref(false);
export const openShareDialog = () => { shareDialogOpen.value = true; };
export const closeShareDialog = () => { shareDialogOpen.value = false; };
