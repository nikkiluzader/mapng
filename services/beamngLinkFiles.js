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

// Textures linked too where the material reading them follows links (shape, biome, sign and fuel-station materials,
// water): BeamNG's Link Files page ("Levels should ideally only contain link files for the assets"; links "should
// mainly point to assets that dont reference other assets, like textures, sounds, raw mesh data"). Not terrain
// materials: TerrainCellMaterial does not resolve .link (verified in game 2026-07-22).
const TEXTURE_EXT = /\.(dds|png|jpe?g)$/i;
function isLinkableLevelAssetPath(pathNoSlash, { textures = false } = {}) {
  if (textures && TEXTURE_EXT.test(pathNoSlash)) return true;
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
// textureTargets: official texture path (lowercase, no leading slash) -> the real file the game's own link chain ends
// at (services/textureLinkTargets.js). A texture is linked only when listed, and straight to that end: the game does
// not follow a link to a link (a MapNG link to the game's own .png.link left the texture missing).
export function createBeamNGLinkFileRegistry(exportLevelName, { companions = {}, textureTargets = {} } = {}) {
  const linksByPath = new Map();

  function rewriteAssetPath(path, opts = {}) {
    const parsed = parseLevelScopedAssetPath(path);
    if (!parsed) return path;
    if (!isLinkableLevelAssetPath(parsed.noSlash, opts)) return path;

    if (parsed.levelName === exportLevelName) {
      return path;
    }

    const localPathNoSlash = `levels/${exportLevelName}/map_assets/official_assets/${parsed.levelName}_assets/${parsed.noSlash}`;
    let redirectPath = `/${parsed.noSlash}`;
    if (opts.textures && TEXTURE_EXT.test(parsed.noSlash)) {
      const end = textureTargets[parsed.noSlash.toLowerCase()];
      if (!end) return path;   // (not resolved against the game's files: left a direct reference)
      redirectPath = `/${end}`;
    }

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

  // opts.textures: link textures as well (only for materials that follow links: not terrain materials)
  function rewriteObjectPathsDeep(value, opts = {}) {
    if (typeof value === 'string') {
      return rewriteAssetPath(value, opts);
    }
    if (Array.isArray(value)) {
      return value.map((item) => rewriteObjectPathsDeep(item, opts));
    }
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, item] of Object.entries(value)) {
        out[key] = rewriteObjectPathsDeep(item, opts);
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
