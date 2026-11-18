# MapNG

## Optimization rules (strict)

Every feature, change and fix follows **docs/optimization-rules.md** from the start: go through its checklist for
the code being touched before the change is done. Real-world alignment (terrain and OSM in the map's bounds at
the processing resolution) is never traded for speed; a pure speed change leaves the level byte-identical.
