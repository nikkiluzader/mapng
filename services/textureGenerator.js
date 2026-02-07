import * as THREE from 'three';

const generateSubtleNoiseTexture = (baseColor, noiseOpacity = 0.2, width = 512, height = 512) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    const c = new THREE.Color(baseColor);
    ctx.fillStyle = `#${c.getHexString()}`;
    ctx.fillRect(0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    for (let i = 0; i < imageData.data.length; i += 4) {
        // Use a more pronounced noise range that averages to the base color
        const noise = (Math.random() - 0.5) * noiseOpacity * 512; 
        imageData.data[i] = Math.min(255, Math.max(0, imageData.data[i] + noise));
        imageData.data[i+1] = Math.min(255, Math.max(0, imageData.data[i+1] + noise));
        imageData.data[i+2] = Math.min(255, Math.max(0, imageData.data[i+2] + noise));
    }
    ctx.putImageData(imageData, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 16;
    texture.needsUpdate = true;
    return texture;
};

const generateRoadTexture = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');

    // Base asphaltish grey
    ctx.fillStyle = '#aaaaaa';
    ctx.fillRect(0, 0, 1024, 1024);

    // More pronounced grain
    for (let i = 0; i < 60000; i++) {
        const grey = 100 + Math.random() * 100;
        ctx.fillStyle = `rgb(${grey},${grey},${grey})`;
        ctx.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 2);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 16;
    texture.needsUpdate = true;
    return texture;
};

const generateWallTexture = () => {
    // Pure white base makes color tinting perfect
    return generateSubtleNoiseTexture(0xffffff, 0.15); 
};

const generateRoofTexture = () => {
    // Slightly more noise for roofs to simulate tiles
    return generateSubtleNoiseTexture(0xffffff, 0.25);
};

export const textures = {
    road: generateRoadTexture(),
    wall: generateWallTexture(),
    roof: generateRoofTexture(),
};
