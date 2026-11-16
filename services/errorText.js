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

/**
 * The page ran out of memory ("RangeError: Array buffer allocation failed", "Out of memory"): a browser tab gets far
 * less than the machine has. A 16 km map at 1 m in Chrome stopped here at the start of its export (report MR-B2ZDBN).
 */
export const isOutOfMemory = (error) => /array buffer allocation failed|out of memory|allocation size overflow/i.test(String(error?.message || error || ''));
