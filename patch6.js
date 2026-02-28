const fs = require('fs');
for (const file of ['services/resamplerWorker.js', 'services/terrainResampler.js']) {
    let code = fs.readFileSync(file, 'utf8');

    // Remove the previous expandFill and relaxFilled logic entirely. We will rewrite it to be purely Laplacian diffusion with clamped edges.
    
    fs.writeFileSync(file, code);
}
