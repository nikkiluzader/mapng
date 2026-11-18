# Optimization rules

These rules are strict. Every new feature, every change and every fix follows them from the start, so the code
never needs a separate speed pass later. Before a change is done, go through the checklist below for the code it
touches. The speed pass that produced them (2026-11-18) is in docs/open-items.md section 4.

## Accuracy comes first

- **Real-world alignment is never traded for speed.** The terrain grid and every OSM feature sit exactly in the
  map's bounds at the processing resolution (metres per pixel). No approximation there, ever.
- **Generated models come second** (structure solver heights, bridge decks, sidewalks, props). A change to them
  can be judged against a reference (a fully converged result) with measured differences shown in graphs. A pure
  speed change must leave the level byte-identical.
- **No approximate geometry for speed**, and no probabilistic data structures (Bloom filters and the like) in
  anything that decides geometry.

## The checklist

Check every item that applies to the code being written or changed.

1. **Algorithm first.** No scan of all features, roads, pixels or buildings per item. Use an index:
   - a grid of boxes (`segmentsNear`, the cut finder, the river grid, `boxGrid`);
   - a WeakMap cache keyed on the input (`crossingSidesOf`, `bandsOf`);
   - a sorted list with binary search.
   Anything that grows with the square of the map is a bug.
2. **Exit early.** Test a cheap exact bound before the costly test: bounding box first, then distance squared,
   then the exact geometry. Branch-and-bound searches stop as soon as the answer is known. A precheck must never
   change an answer: it only skips work whose result is already certain.
3. **Do work once per row, tile or object, not once per pixel.** Hoist anything that depends only on the row or
   tile. For example, a polygon's crossings with a pixel row are found once per row (`makePolygon().row`).
4. **Flat typed arrays for bulk data.** Use Float64Array, Float32Array, Int32Array and Uint8Array, as struct of
   arrays. No object per point, pixel or station. A per-pixel map uses a grid-tiled store (`PixelEdits`), never
   a Map, which stops at 2^24 entries.
5. **Write JIT-friendly code in hot loops** (V8):
   - plain `for` loops, not `forEach` / `map` callbacks that write to a captured running total (V8 boxes the
     number at every store);
   - no arrays returned per call (`[x, y]` helpers inlined, or results written into a caller's object);
   - no spread calls with big arrays (`Math.max(...a)`, `push(...a)`: they also overflow the stack; use
     `appendAll`);
   - objects of one shape.
6. **Reuse instead of allocating.** Use scratch buffers and result objects filled in place (`nearestOnTunnel`'s
   `out`), and pools for repeated work. The young generation is not made bigger to hide garbage: measured, it
   costs gigabytes for a few per cent.
7. **Cache and precompute.** Memoise pure lookups, use lookup tables for repeated maths, keep each step's cache,
   and keep the area's data cache (one download per Generate). The export never downloads.
8. **Run in parallel where items are independent.** Workers go through `services/parallel.js` (at most 8 threads,
   `MAPNG_THREADS` overrides):
   - bands of rows or tiles over a SharedArrayBuffer;
   - results read back in the original order, so the output is identical;
   - functions sent as data masks or bytes, not closures;
   - a single-thread path that gives the same result (the website, small maps);
   - every new worker module added to `WORKER_MODULES` in `desktop/scripts/stage.mjs` (a test checks this).
9. **Overlap I/O.** Downloads from different servers run at the same time. Request rates and concurrency against
   any one third-party server are never raised for speed (Esri, iNaturalist, OSM, Overpass and the rest).
10. **Zero-copy.** Share or transfer buffers between threads instead of copying them. Stream large outputs (zip
    tiles as they are made) instead of holding them whole.
11. **Free memory as soon as a step is done with it.** No new full-grid buffer without need: each one is about
    1 GiB at 16k. Call `toRaw` on reactive store data before heavy loops.
12. **Floating point:** use `fastHypot` (services/fastMath.js) instead of `Math.hypot` in new code, except for
    spread calls. Use `Math.sqrt(x * x + y * y)` style arithmetic in hot paths.

## Proving each change

- **Measure before and after.** Use a CPU profile (`node --cpu-prof`; for the desktop runner,
  `MAPNG_RUNNER_NODE_ARGS`) and look at self time and the hot lines. Never guess.
- **Check exactness:**
  - the six bt_* areas compared file by file against the previous build (about 1 minute);
  - a 4 km benchmark for speed (nyc_s4096, pgh4k; chi_lake4k for big lakes).
  - A new test area's first export writes its caches, so make the baseline from a second run under the same
    level name.
- **Watch the log for "skipped:" lines.** A step that throws is caught and skipped. A level that matches a
  baseline where the step failed the same way proves nothing.
- **Run Chicago 8192 in the desktop app only at milestones.**
- **Add or update the step's row** (time and status) in docs/open-items.md section 4.

## Keeping fast code correct later

Optimized code has two parts that must stay in step: the fast path and what it replaces. When either changes:

- **Fast path and plain test** (`row()` and `contains()`, `PixelEdits` and Map semantics): a test checks that
  they answer the same. Extend it when either side changes.
- **Worker and single-thread paths:** both run the same function. Change the function, not one caller.
- **Prechecks:** a precheck's bound must cover everything the exact test can return. Widening the exact test
  (a bigger reach, a new tolerance) means widening its precheck too.
- **New fields read by a worker** must be added to what is sent to it (for example the `sub` graph in
  services/composeWorker.js). A missing field shows up as a wrong level, not an error.
