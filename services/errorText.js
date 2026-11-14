// Raw failures that have a plain reason the person can act on.

/** A write failed because the disk is full (Node: "ENOSPC: no space left on device, write"). */
export const isDiskFull = (message) => /\bENOSPC\b|no space left on device/i.test(String(message || ''));
