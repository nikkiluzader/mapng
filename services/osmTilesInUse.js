// Whether the map is showing OpenStreetMap's own tiles right now (the "OpenStreetMap" map layer, and its server
// answering). While it is, MapNG asks nobody for money: no heart in the header, no tip window after an export.
// Those tiles come from a volunteer-run, donation-funded server whose usage policy singles out donation-seeking
// sites (https://operations.osmfoundation.org/policies/tiles/). Any other map layer: the support options are back.
import { ref } from 'vue';

export const osmTilesInUse = ref(false);
/** layer: the chosen map layer's id; refused: OpenStreetMap's server is not answering and another map stands in. */
export const osmTilesShown = (layer, refused = false) => layer === 'osm' && !refused;
