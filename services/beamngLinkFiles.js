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
  // Meshes only. Textures must NOT be link-mirrored: TerrainCellMaterial does
  // not resolve .link redirects (verified in-game 2026-07-22), and shape
  // materials follow Car_Killer's pattern — link the .dae, reference textures
  // at their official location directly ("no textures" in the link folder).
  const lower = pathNoSlash.toLowerCase();
  return lower.endsWith('.dae') || lower.endsWith('.cdae');
}

/**
 * companions: lowercase official .dae path (no leading slash) -> suffixes of
 * files that ship beside it and must be linked beside its mirrored copy too
 * (".imposter.dds", ".imposter_normals.dds", ".asset.json"). Without them the
 * engine finds no imposter next to the mirrored shape and bakes one from
 * defaults; the baked far billboards of palms rendered as black squares.
 */
export function createBeamNGLinkFileRegistry(exportLevelName, { companions = {} } = {}) {
  const linksByPath = new Map();

  function rewriteAssetPath(path) {
    const parsed = parseLevelScopedAssetPath(path);
    if (!parsed) return path;
    if (!isLinkableLevelAssetPath(parsed.noSlash)) return path;

    if (parsed.levelName === exportLevelName) {
      return path;
    }

    const localPathNoSlash = `levels/${exportLevelName}/map_assets/official_assets/${parsed.levelName}_assets/${parsed.noSlash}`;
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
      for (const suffix of companions[parsed.noSlash.toLowerCase()] || []) {
        linksByPath.set(`${localPathNoSlash}${suffix}`, `${redirectPath}${suffix}`);
      }
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
      contents: `${JSON.stringify({ path: redirectPath, type: "normal" }, null, 2)}\n`,
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
