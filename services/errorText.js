// Raw failures that have a plain reason the person can act on.

/** A write failed because the disk is full (Node: "ENOSPC: no space left on device, write"). */
export const isDiskFull = (message) => /\bENOSPC\b|no space left on device/i.test(String(message || ''));

/**
 * The browser could not read back a file it was holding for the page ("NotReadableError: The requested file could
 * not be read…"): its temporary storage for big files gave out. A 16384 level on the website stopped here twice,
 * as its files were gathered for the zip.
 */
export const isBrowserStorageGone = (error) => error?.name === 'NotReadableError' || /requested file could not be read/i.test(String(error?.message || error || ''));

/** The hand-over to the desktop exporter found a picture or file the page no longer holds (services/platform/desktop.js). */
export const MAP_PART_GONE = 'MAPNG_MAP_PART_GONE';
export const isMapPartGone = (error) => String(error?.message || error || '').includes(MAP_PART_GONE);
