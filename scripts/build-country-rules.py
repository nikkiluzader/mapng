#!/usr/bin/env python3
"""Build public/country_rules.json: simplified country outlines plus the road
rules MapNG derives from the export's location (driving side, region).

Source: Natural Earth 1:10m admin-0 countries (public domain),
https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_admin_0_countries.geojson

    python3 scripts/build-country-rules.py path/to/ne_10m_admin_0_countries.geojson

Outlines are simplified to ~0.01 deg (about 1 km) and stored as delta-encoded
integers in 1e-3 deg, so the file stays small enough to fetch at export time.
"""
import json
import sys
from pathlib import Path

from shapely.geometry import shape, Polygon, MultiPolygon

OUT = Path(__file__).resolve().parent.parent / 'public' / 'country_rules.json'
SIMPLIFY_DEG = 0.01
SCALE = 1000

# Countries and territories that drive on the left (ISO 3166-1 alpha-2).
LEFT_HAND_TRAFFIC = set('''
GB IE IM JE GG MT CY
JP IN PK BD LK NP BT MV TH MY SG BN ID TL HK MO
AU NZ PG SB FJ TO WS KI TV NR CK NU NF CX CC
ZA LS SZ BW NA ZW ZM MZ MW TZ KE UG MU SC SH
GY SR JM BS BB TT AG DM GD KN LC VC AI BM VG KY MS TC VI FK
'''.split())


def iso2(props):
    for key in ('ISO_A2_EH', 'ISO_A2'):
        value = str(props.get(key) or '')
        if len(value) == 2 and value.isalpha():
            return value.upper()
    return None


def encode_ring(coords):
    out, px, py = [], 0, 0
    for x, y in coords:
        qx, qy = round(x * SCALE), round(y * SCALE)
        if out and qx == px and qy == py:
            continue
        out.extend((qx - px, qy - py))
        px, py = qx, qy
    return out


def main(src):
    data = json.loads(Path(src).read_text(encoding='utf-8'))
    countries = []
    for feature in data['features']:
        props = feature['properties']
        code = iso2(props)
        if not code:
            continue
        geom = shape(feature['geometry']).simplify(SIMPLIFY_DEG, preserve_topology=True)
        polys = list(geom.geoms) if isinstance(geom, MultiPolygon) else [geom] if isinstance(geom, Polygon) else []
        rings = []
        for poly in polys:
            if poly.is_empty:
                continue
            for ring in [poly.exterior, *poly.interiors]:
                encoded = encode_ring(ring.coords)
                if len(encoded) >= 6:
                    rings.append(encoded)
        if not rings:
            continue
        w, s, e, n = geom.bounds
        countries.append({
            'c': code,
            'n': props.get('NAME_EN') or props.get('NAME'),
            'r': props.get('REGION_UN') or props.get('CONTINENT'),
            's': props.get('SUBREGION'),
            'l': 1 if code in LEFT_HAND_TRAFFIC else 0,
            'b': [round(w, 3), round(s, 3), round(e, 3), round(n, 3)],
            'p': rings,
        })
    countries.sort(key=lambda c: c['c'])
    OUT.write_text(json.dumps({
        'source': 'Natural Earth 1:10m admin-0 countries (public domain), simplified',
        'scale': SCALE,
        'countries': countries,
    }, separators=(',', ':')), encoding='utf-8')
    missing = sorted(LEFT_HAND_TRAFFIC - {c['c'] for c in countries})
    print(f'{len(countries)} countries -> {OUT} ({OUT.stat().st_size // 1024} KiB)')
    if missing:
        print('left-hand-traffic codes without an outline at this scale:', ' '.join(missing))


if __name__ == '__main__':
    main(sys.argv[1])
