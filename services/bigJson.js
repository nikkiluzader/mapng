// A very long array as JSON without ever holding it as one string: one element a line, written and read a piece
// at a time. JavaScript strings end near 512 MB; a desktop Generate of a 65 km map of Tokyo failed saving its
// map data with "Invalid string length" (JSON.stringify of the whole feature list; report MR-XFHFCX).
// The text is ordinary JSON ("[\n{..},\n{..}\n]"): anything that reads JSON reads it.

/** The array's JSON as a sequence of strings of about `size` characters each. */
export function* jsonArrayChunks(array, size = 8 << 20) {
  let buf = '[';
  for (let i = 0; i < array.length; i++) {
    buf += (i ? ',\n' : '\n') + JSON.stringify(array[i] === undefined ? null : array[i]);
    if (buf.length >= size) { yield buf; buf = ''; }
  }
  yield `${buf}\n]`;
}

/**
 * Reads such a file back from pieces of bytes: push(Uint8Array) for each piece in order, then end() gives the
 * array. A file written another way (JSON on one line) is read whole, as before, as long as it fits a string.
 */
export function jsonArrayReader() {
  const decoder = new TextDecoder();
  const out = [];
  let rest = ''; let lines = null; let whole = [];
  const take = (line) => {
    const t = line.endsWith(',') ? line.slice(0, -1) : line;
    if (t === '' || t === '[' || t === ']') return;
    out.push(JSON.parse(t));
  };
  const feed = (text) => {
    if (lines === null) {
      rest += text;
      if (rest.length < 2) return;
      lines = rest.startsWith('[\n');
      if (!lines) { whole.push(rest); rest = ''; return; }
      text = rest; rest = '';
    } else if (!lines) { whole.push(text); return; }
    const parts = (rest + text).split('\n');
    rest = parts.pop();
    for (const p of parts) take(p);
  };
  return {
    push(bytes) { feed(decoder.decode(bytes, { stream: true })); },
    end() {
      feed(decoder.decode());
      if (lines === null) return JSON.parse(rest || 'null');
      if (!lines) return JSON.parse(whole.join(''));
      take(rest);
      return out;
    },
  };
}
