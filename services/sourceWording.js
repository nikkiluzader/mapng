// Progress wording while the desktop app replays a level's saved downloads
// (Update, Modify: desktop/runner/browserShims.mjs installSourceRecorder sets
// the flag): "Reading saved ..." instead of "Fetching" / "Downloading", so a
// rebuild never reads like a download. Elsewhere the usual words.
export const replayingSources = () => !!globalThis.__mapngReplayingSources;

/** 'Fetching' (or the given word) normally; 'Reading saved' while replaying. */
export const fetchWord = (fetching = 'Fetching') => (replayingSources() ? 'Reading saved' : fetching);

/** 'Downloaded' normally; 'Read saved' while replaying (for "x/y" counters). */
export const fetchedWord = (fetched = 'Downloaded') => (replayingSources() ? 'Read saved' : fetched);
