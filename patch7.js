const fs = require('fs');
const path = require('path');

const replacement = `const expandFill = (map, width, height, noData, maxPasses = 64, radius = 3, baseMask = null) => {
    const filledMask = baseMask ? new Uint8Array(baseMask) : new Uint8Array(map.length);
    for (let pass = 0; pass < maxPasses; pass++) {
        let any = false;
        // Need a copy to avoid directional bias during simple fill
        const nextMap = new Float32Array(map);
        for (let y = 0; y < height; y++) {
            const rowOff = y * width;
            for (let x = 0; x < width; x++) {
                const idx = rowOff + x;
                if (map[idx] !== noData) continue;
                let sum = 0;
                let cnt = 0;
                // Circular radius to prevent square artifacts
                const r2 = radius * radius;
                for (let dy = -radius; dy <= radius; dy++) {
                    const ny = y + dy;
                    if (ny < 0 || ny >= height) continue;
                    const base = ny * width;
                    for (let dx = -radius; dx <= radius; dx++) {
                        if (dx*dx + dy*dy > r2) continue; // Circular!
                        const nx = x + dx;
                        if (nx < 0 || nx >= width) continue;
                        const v = map[base + nx];
                        if (v !== noData && Number.isFinite(v)) { sum += v; cnt++; }
                    }
                }
                if (cnt > 0) {
                    nextMap[idx] = sum / cnt;
                    filledMask[idx] = 1;
                    any = true;
                }
            }
        }
        map.set(nextMap);
        if (!any) break;
    }
    return filledMask;
};

const relaxFilled = (map, width, height, noData, filledMask, iterations = 200) => {
    if (!filledMask) return;
    
    // Multiple passes of Laplacian diffusion. 
    // Biharmonic splines tend to severely oscillate, overshooting boundaries on steep cliffs (Gibbs phenomenon).
    // Simple Laplacian smoothing converges to a minimal surface membrane, which prevents deep hole spikes.
    for (let iter = 0; iter < iterations; iter++) {
        let updated = false;
        const nextMap = new Float32Array(map);
        for (let y = 0; y < height; y++) {
            const rowOff = y * width;
            for (let x = 0; x < width; x++) {
                const idx = rowOff + x;
                if (!filledMask[idx]) continue;
                
                const curVal = map[idx];
                let sum = 0;
                let count = 0;
                
                // Classic 4-way Laplacian
                const neighbors = [
                    [0, -1], [0, 1], [-1, 0], [1, 0]
                ];
                
                for(let [dx, dy] of neighbors) {
                    const nx = Math.max(0, Math.min(width - 1, x + dx));
                    const ny = Math.max(0, Math.min(height - 1, y + dy));
                    const nVal = map[ny * width + nx];
                    // Clamp to safe values, ignore true background holes in the distance
                    if (nVal !== noData && Number.isFinite(nVal)) {
                        sum += nVal;
                        count++;
                    }
                }

                if (count > 0) {
                    const newVal = sum / count;
                    if (Math.abs(newVal - curVal) > 0.0001) {
                        nextMap[idx] = newVal;
                        updated = true;
                    }
                }
            }
        }
        map.set(nextMap);
        if (!updated) break;
    }
};`;

for (const file of ['services/resamplerWorker.js', 'services/terrainResampler.js']) {
    let content = fs.readFileSync(file, 'utf8');
    
    // We will do a generic replacement matching the const expandFill through relaxFilled.
    const startIdx = content.indexOf('const expandFill = (map, width, height, noData, maxPasses');
    const endString = '        if (!updated) break;\n    }\n};';
    const endIdx = content.indexOf(endString, startIdx);
    
    if (startIdx !== -1 && endIdx !== -1) {
        const fullEndIdx = endIdx + endString.length;
        const newContent = content.substring(0, startIdx) + replacement + content.substring(fullEndIdx);
        fs.writeFileSync(file, newContent);
        console.log("Patched " + file);
    } else {
        console.log("Could not find blocks in " + file);
    }
}
