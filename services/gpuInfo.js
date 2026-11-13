// The graphics a page draws with, in one line for a problem report: the card and driver as WebGL names them,
// the largest picture the card takes, and whether it is a software renderer. Read once; nothing is sent here.
let cached;

/** { renderer, vendor, maxTextureSize, webgl2, software } or null where WebGL does not start. */
export function pageGpu(doc = globalThis.document) {
  if (cached !== undefined) return cached;
  try {
    const canvas = doc.createElement('canvas');
    const gl2 = canvas.getContext('webgl2');
    const gl = gl2 || canvas.getContext('webgl');
    if (!gl) return (cached = null);
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String((info && gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '');
    const vendor = String((info && gl.getParameter(info.UNMASKED_VENDOR_WEBGL)) || gl.getParameter(gl.VENDOR) || '');
    cached = {
      renderer, vendor,
      maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0,
      webgl2: !!gl2,
      software: /swiftshader|llvmpipe|software|basic render/i.test(renderer),
    };
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { cached = null; }
  return cached;
}

/** The same as one line: "ANGLE (Intel, Arc A770 ...), largest picture 16384 px, WebGL 2". */
export function gpuLine(gpu = pageGpu()) {
  if (!gpu) return 'WebGL did not start';
  return [gpu.renderer || gpu.vendor || 'unnamed', gpu.software ? 'software renderer' : '', gpu.maxTextureSize ? `largest picture ${gpu.maxTextureSize} px` : '', gpu.webgl2 ? 'WebGL 2' : 'WebGL 1 only']
    .filter(Boolean).join(', ').slice(0, 400);
}

export const _resetGpuInfo = () => { cached = undefined; };
