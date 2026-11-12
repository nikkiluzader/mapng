// The newest update page (public/updates/<version>/): /updates/latest and /updates point at it (index.js).
// Bump with each update page. (Its own module: index.js may export only handlers; the Workers runtime refuses
// a main module with any other named export.)
export const LATEST_UPDATE = '0.3.0';
