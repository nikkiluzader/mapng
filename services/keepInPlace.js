// Filter a list in place.
//
// `list.length = 0; list.push(...kept)` passes every kept item as a function
// argument: past about 125,000 of them the engine's stack overflows
// ("Maximum call stack size exceeded"). A 20 km city with background areas
// had more parking spots than that left after the background was taken out,
// and its export stopped there (problem report MR-TWEP2B, 0.2.17).

/** Keep only the items keep(item) is true for, in the same array, in order. Returns the array. */
export function keepInPlace(list, keep) {
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (keep(item)) list[w++] = item;
  }
  list.length = w;
  return list;
}

/** Append every item of `more` to `list`, however many there are. Returns the array. */
export function appendAll(list, more) {
  for (let i = 0; i < more.length; i++) list.push(more[i]);
  return list;
}
