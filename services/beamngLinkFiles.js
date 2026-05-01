function parseLevelScopedAssetPath(path) {
  if (typeof path !== 'string') return null;
  const trimmed = path.trim();
  if (!trimmed) return null;

  const hasLeadingSlash = trimmed.startsWith('/');
  const noSlash = hasLeadingSlash ? trimmed.slice(1) : trimmed;
  if (!noSlash.startsWith('levels/')) return null;

  const parts = noSlash.split('/');
  if (parts.length < 3) return null;
  return {
    hasLeadingSlash,
    noSlash,
    levelName: parts[1],
  };
}

function isLinkableLevelAssetPath(pathNoSlash) {
  const lower = pathNoSlash.toLowerCase();
  return lower.endsWith('.dae') || lower.endsWith('.cdae');
}

export function createBeamNGLinkFileRegistry(exportLevelName) {
  const linksByPath = new Map();

  function rewriteAssetPath(path) {
    const parsed = parseLevelScopedAssetPath(path);
    if (!parsed) return path;
    if (!isLinkableLevelAssetPath(parsed.noSlash)) return path;

    if (parsed.levelName === exportLevelName) {
      return path;
    }

    const localPathNoSlash = `levels/${exportLevelName}/linked/${parsed.noSlash}`;
    const redirectPath = `/${parsed.noSlash}`;

    const existingTarget = linksByPath.get(localPathNoSlash);
    if (existingTarget && existingTarget !== redirectPath) {
      console.warn('[BeamNG Link Files] Link collision detected. Keeping first target.', {
        localPathNoSlash,
        existingTarget,
        attemptedTarget: redirectPath,
      });
    } else {
      linksByPath.set(localPathNoSlash, redirectPath);
    }

    return parsed.hasLeadingSlash ? `/${localPathNoSlash}` : localPathNoSlash;
  }

  function rewriteObjectPathsDeep(value) {
    if (typeof value === 'string') {
      return rewriteAssetPath(value);
    }
    if (Array.isArray(value)) {
      return value.map((item) => rewriteObjectPathsDeep(item));
    }
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, item] of Object.entries(value)) {
        out[key] = rewriteObjectPathsDeep(item);
      }
      return out;
    }
    return value;
  }

  function getLinkFiles() {
    return Array.from(linksByPath.entries()).map(([linkPathNoSlash, redirectPath]) => ({
      path: `${linkPathNoSlash}.link`,
      contents: `${JSON.stringify({ path: redirectPath }, null, 2)}\n`,
    }));
  }

  function getLinkCount() {
    return linksByPath.size;
  }

  return {
    rewriteAssetPath,
    rewriteObjectPathsDeep,
    getLinkFiles,
    getLinkCount,
  };
}
