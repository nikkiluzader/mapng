import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

import { parseGmlText } from '../services/tifLoader.js';
import { parseTifFile } from '../services/tifLoader.js';

test('parseGmlText parses a rectified grid coverage into raster metadata', async () => {
  const gml = `<?xml version="1.0" encoding="UTF-8"?>
  <gml:RectifiedGridCoverage xmlns:gml="http://www.opengis.net/gml/3.2" gml:id="dem">
    <gml:domainSet>
      <gml:RectifiedGrid dimension="2" srsName="EPSG:4326">
        <gml:limits>
          <gml:GridEnvelope>
            <gml:low>0 0</gml:low>
            <gml:high>1 1</gml:high>
          </gml:GridEnvelope>
        </gml:limits>
        <gml:origin>
          <gml:Point srsName="EPSG:4326">
            <gml:pos>-120 40</gml:pos>
          </gml:Point>
        </gml:origin>
        <gml:offsetVector>0.01 0</gml:offsetVector>
        <gml:offsetVector>0 -0.01</gml:offsetVector>
      </gml:RectifiedGrid>
    </gml:domainSet>
    <gml:rangeSet>
      <gml:DataBlock>
        <gml:rangeParameters />
        <gml:tupleList>10 20 30 40</gml:tupleList>
      </gml:DataBlock>
    </gml:rangeSet>
  </gml:RectifiedGridCoverage>`;

  const parsed = await parseGmlText(gml);

  assert.equal(parsed.sourceType, 'grid');
  assert.equal(parsed.sourceFormat, 'gml');
  assert.equal(parsed.formatLabel, 'GML');
  assert.equal(parsed.sourceWidth, 2);
  assert.equal(parsed.sourceHeight, 2);
  assert.deepEqual(Array.from(parsed.raster), [10, 20, 30, 40]);
  assert.equal(parsed.epsgCode, 4326);
  assert.ok(parsed.isGeoReferenced);
  assert.deepEqual(parsed.bounds, {
    north: 40,
    south: 39.99,
    east: -119.99,
    west: -120,
  });
  assert.ok(Math.abs(parsed.center.lat - 39.995) < 1e-9);
  assert.ok(Math.abs(parsed.center.lng - (-119.995)) < 1e-9);
  assert.equal(parsed.gridTiles.length, 1);
});

test('parseGmlText parses dataset-style GML coverage with envelope bounds and labeled tuples', async () => {
  const gml = `<?xml version="1.0" encoding="UTF-8"?>
  <Dataset xmlns:gml="http://www.opengis.net/gml/3.2">
    <DEM>
      <coverage>
        <gml:boundedBy>
          <gml:Envelope srsName="fguuid:jgd2011.bl">
            <gml:lowerCorner>36.0 137.4</gml:lowerCorner>
            <gml:upperCorner>36.1 137.5</gml:upperCorner>
          </gml:Envelope>
        </gml:boundedBy>
        <gml:gridDomain>
          <gml:Grid dimension="2">
            <gml:limits>
              <gml:GridEnvelope>
                <gml:low>0 0</gml:low>
                <gml:high>1 1</gml:high>
              </gml:GridEnvelope>
            </gml:limits>
          </gml:Grid>
        </gml:gridDomain>
        <gml:rangeSet>
          <gml:DataBlock>
            <gml:rangeParameters>
              <gml:QuantityList uom="DEM構成点"></gml:QuantityList>
            </gml:rangeParameters>
            <gml:tupleList>
              地表面,10
              地表面,20
              地表面,30
              地表面,40
            </gml:tupleList>
          </gml:DataBlock>
        </gml:rangeSet>
      </coverage>
    </DEM>
  </Dataset>`;

  const parsed = await parseGmlText(gml);

  assert.equal(parsed.sourceFormat, 'gml');
  assert.equal(parsed.sourceWidth, 2);
  assert.equal(parsed.sourceHeight, 2);
  assert.deepEqual(Array.from(parsed.raster), [10, 20, 30, 40]);
  assert.equal(parsed.epsgCode, null);
  assert.deepEqual(parsed.bounds, {
    north: 36.1,
    south: 36.0,
    east: 137.5,
    west: 137.4,
  });
  assert.equal(parsed.gridTiles.length, 1);
  assert.equal(parsed.gridTiles[0].originX, 137.4);
  assert.equal(parsed.gridTiles[0].originY, 36.1);
});

test('parseGmlText pads leading noData cells when a grid function startPoint skips the prefix of the grid', async () => {
  const gml = `<?xml version="1.0" encoding="UTF-8"?>
  <Dataset xmlns:gml="http://www.opengis.net/gml/3.2">
    <DEM>
      <coverage>
        <gml:boundedBy>
          <gml:Envelope srsName="fguuid:jgd2011.bl">
            <gml:lowerCorner>36.0 137.4</gml:lowerCorner>
            <gml:upperCorner>36.1 137.5</gml:upperCorner>
          </gml:Envelope>
        </gml:boundedBy>
        <gml:gridDomain>
          <gml:Grid dimension="2">
            <gml:limits>
              <gml:GridEnvelope>
                <gml:low>0 0</gml:low>
                <gml:high>1 1</gml:high>
              </gml:GridEnvelope>
            </gml:limits>
          </gml:Grid>
        </gml:gridDomain>
        <gml:rangeSet>
          <gml:DataBlock>
            <gml:rangeParameters>
              <gml:QuantityList uom="DEM構成点"></gml:QuantityList>
            </gml:rangeParameters>
            <gml:tupleList>
              地表面,10
              地表面,20
              地表面,30
            </gml:tupleList>
          </gml:DataBlock>
        </gml:rangeSet>
        <gml:coverageFunction>
          <gml:GridFunction>
            <gml:sequenceRule order="+x-y">Linear</gml:sequenceRule>
            <gml:startPoint>1 0</gml:startPoint>
          </gml:GridFunction>
        </gml:coverageFunction>
      </coverage>
    </DEM>
  </Dataset>`;

  const parsed = await parseGmlText(gml);

  assert.deepEqual(Array.from(parsed.raster), [parsed.noData, 10, 20, 30]);
});

test('parseTifFile parses ZIP archives containing multiple GML tiles', async () => {
  const makeTile = ({ west, east, south, north, values }) => `<?xml version="1.0" encoding="UTF-8"?>
  <Dataset xmlns:gml="http://www.opengis.net/gml/3.2">
    <DEM>
      <coverage>
        <gml:boundedBy>
          <gml:Envelope srsName="fguuid:jgd2011.bl">
            <gml:lowerCorner>${south} ${west}</gml:lowerCorner>
            <gml:upperCorner>${north} ${east}</gml:upperCorner>
          </gml:Envelope>
        </gml:boundedBy>
        <gml:gridDomain>
          <gml:Grid dimension="2">
            <gml:limits>
              <gml:GridEnvelope>
                <gml:low>0 0</gml:low>
                <gml:high>1 1</gml:high>
              </gml:GridEnvelope>
            </gml:limits>
          </gml:Grid>
        </gml:gridDomain>
        <gml:rangeSet>
          <gml:DataBlock>
            <gml:rangeParameters>
              <gml:QuantityList uom="DEM構成点"></gml:QuantityList>
            </gml:rangeParameters>
            <gml:tupleList>${values.map((value) => `地表面,${value}`).join('\n')}</gml:tupleList>
          </gml:DataBlock>
        </gml:rangeSet>
      </coverage>
    </DEM>
  </Dataset>`;

  const zip = new JSZip();
  zip.file('tile-a.xml', makeTile({
    west: 137.4,
    east: 137.5,
    south: 36.0,
    north: 36.1,
    values: [10, 20, 30, 40],
  }));
  zip.file('tile-b.xml', makeTile({
    west: 137.5,
    east: 137.6,
    south: 36.0,
    north: 36.1,
    values: [50, 60, 70, 80],
  }));

  const content = await zip.generateAsync({ type: 'uint8array' });
  const file = new File([content], 'tiles.zip', { type: 'application/zip' });
  const parsed = await parseTifFile(file);

  assert.equal(parsed.sourceFormat, 'gml-zip');
  assert.equal(parsed.formatLabel, 'GML ZIP');
  assert.equal(parsed.gridTiles.length, 2);
  assert.deepEqual(parsed.bounds, {
    north: 36.1,
    south: 36.0,
    east: 137.6,
    west: 137.4,
  });
  assert.ok(parsed.center);
  assert.equal(parsed.sourceFileCount, 2);
});