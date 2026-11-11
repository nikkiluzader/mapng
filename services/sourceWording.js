// Progress wording while the desktop app replays a level's saved downloads
// (Update, Modify: desktop/runner/browserShims.mjs installSourceRecorder sets
// the flag): "Reading saved ..." instead of "Fetching" / "Downloading", so a
// rebuild never reads like a download. Elsewhere the usual words.
export const replayingSources = () => !!globalThis.__mapngReplayingSources;

/**
 * Whether a GPXZ terrain can be made: with a key, or without one when a
 * level's saved downloads are being replayed (the desktop app's Update and
 * Modify: the saved GPXZ answers need no key). Without this a GPXZ level
 * modified with no key in the window came back on the 30 m.
 */
export const gpxzUsable = (useGPXZ, apiKey) => !!useGPXZ && (!!apiKey || replayingSources());

/** 'Fetching' (or the given word) normally; 'Reading saved' while replaying. */
export const fetchWord = (fetching = 'Fetching') => (replayingSources() ? 'Reading saved' : fetching);

/** 'Downloaded' normally; 'Read saved' while replaying (for "x/y" counters). */
export const fetchedWord = (fetched = 'Downloaded') => (replayingSources() ? 'Read saved' : fetched);
