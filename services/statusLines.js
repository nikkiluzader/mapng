// The lines under the progress bar, in the app's language.
//
// The terrain and export code report their steps as English text ("Downloaded 20/26 global tiles...",
// "Compressing the level ZIP (66.7 MB, 497 files): terrain.ter…"); services/generationProgress.js sorts
// them into stages by that text, the logs and the level report keep it, and the desktop exporter sends it
// from its own process. So the text is translated where it is shown: every line is one of the patterns
// under "statusLines" in locales/en.json, with named gaps ({n}, {size}) for what varies. A line that fits
// a pattern is shown in the language's wording with the same values; one that fits none is shown as it is.
// A gap named {sub} holds another line ("Backdrop: …", "Resampling heightmap to 1m/px: …") and is
// translated the same way.
import en from '../locales/en.json' with { type: 'json' };

const ELLIPSIS = /(?:\.{3}|…)/g;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** [key, regex, gap names] for every English pattern, the longest fixed text first. */
export function compilePatterns(patterns) {
  return Object.entries(patterns || {}).map(([key, text]) => {
    const names = [];
    const source = String(text).split(/(\{\w+\})/).map((part) => {
      const gap = /^\{(\w+)\}$/.exec(part);
      if (!gap) return escape(part);
      names.push(gap[1]);
      return '(.+?)';
    }).join('');
    return { key, re: new RegExp(`^${source}$`), names, fixed: String(text).replace(/\{\w+\}/g, '').length };
  }).sort((a, b) => b.fixed - a.fixed);
}

const COMPILED = compilePatterns(en.statusLines);

/**
 * A progress line in another language. `translate(key, values)` is the app's t() for
 * `statusLines.<key>`; `patterns` defaults to the English ones.
 */
export function localizeStatus(text, translate, compiled = COMPILED, depth = 0) {
  const raw = String(text ?? '');
  if (!raw || typeof translate !== 'function') return raw;
  const tidy = raw.replace(ELLIPSIS, '…').trim();
  const trailing = tidy.endsWith('…');
  const body = trailing ? tidy.slice(0, -1).trimEnd() : tidy;
  for (const { key, re, names } of compiled) {
    const m = re.exec(body);
    if (!m) continue;
    const values = {};
    names.forEach((name, i) => {
      values[name] = name === 'sub' && depth < 2 ? localizeStatus(m[i + 1], translate, compiled, depth + 1) : m[i + 1];
    });
    const out = translate(key, values);
    if (typeof out !== 'string' || !out) return raw;
    return trailing ? `${out}…` : out;
  }
  return raw;
}
