const https = require('https');

https.get('https://tnmaccess.nationalmap.gov/api/v1/products?datasets=Digital%20Elevation%20Model%20(DEM)%201%20meter&bbox=-119.056863,33.462311,-119.012748,33.499106&prodFormats=GeoTIFF&max=4', (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
        try {
            JSON.parse(data);
            console.log("Parsed perfectly.");
        } catch (e) {
            console.log("Failed to parse:", e.message);
            console.log("First 200 chars of string:");
            console.log(data.substring(0, 200));
        }
    });
});
