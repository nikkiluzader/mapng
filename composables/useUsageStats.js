import { ref } from 'vue';
import { usageFromConfig } from '../services/usageStats.js';

// Settings stats (services/usageStats.js): the opt-in to share which settings
// one exports with (no location), separate from export hotspots, and the
// report after each finished level export. Web app and desktop app alike.
const SHARE_KEY = 'mapng_share_settings';    // 'on' | 'off' | unset (not asked yet)

const read = () => { try { return localStorage.getItem(SHARE_KEY); } catch { return null; } };
const share = ref(read());

export function setShareSettings(on) {
  share.value = on ? 'on' : 'off';
  try { localStorage.setItem(SHARE_KEY, share.value); } catch { /* private mode */ }
}

/** After a level export: count its settings, when this user shares. Never throws, never waits. */
export function reportUsage(config, platform) {
  if (share.value !== 'on' || !config) return;
  const settings = usageFromConfig(config, platform);
  if (!settings.platform) return;
  fetch('/api/usage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ settings }),
    keepalive: true,
  }).catch(() => { /* offline: not counted */ });
}

export const useUsageStats = () => ({ share, setShareSettings });
