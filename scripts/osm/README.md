# OSM tag fixes (maintainer scripts)

Fixes for OSM data that MapNG reviews find wrong: a bridge tagged `arch` that is a truss, a missing
`bridge:structure`. Every edit is proposed with written sources and photos, approved by a person, and
uploaded under that person's account. Nothing here ships in the app; nothing runs on its own.

OSM's rules apply: the [Automated Edits code of conduct](https://wiki.openstreetmap.org/wiki/Automated_Edits_code_of_conduct)
(these are reviewed one by one, not mass edits), and sources must be free to use: Mapillary, Wikimedia
Commons, Wikipedia/Wikidata facts, survey. **Never Google Street View or Google Maps.**

## Setup (once)

Register an OAuth 2 app at openstreetmap.org > My Settings > OAuth 2 applications:
- Redirect URI `urn:ietf:wg:oauth:2.0:oob`, confidential.
- Permissions **only** `read_prefs` and `write_api`.

Put the id and secret in `~/.config/mapng/mapng.env` as `OSM_CLIENT_ID` and `OSM_CLIENT_SECRET`. For
the test server (master.apis.dev.openstreetmap.org, its own account), use `OSM_DEV_CLIENT_ID` and
`OSM_DEV_CLIENT_SECRET`.

```bash
node scripts/osm/login.mjs --dev                  # prints the sign-in link
node scripts/osm/login.mjs --dev --code <code>    # saves OSM_DEV_ACCESS_TOKEN
node scripts/osm/apply.mjs --dev --selftest --upload   # create / modify / delete a node on the test server
node scripts/osm/login.mjs                        # then the same for the live server
node scripts/osm/login.mjs --code <code>
```

## A batch of fixes

1. **Propose.** Add `refs/osm-fixes/<batch>.json`, one entry per element. Each entry has:
   - `type` and `id`;
   - `before`: the values seen for the keys it changes (`null` = absent);
   - `change`: `{ set, remove }`;
   - `reason`, `confidence`, `sources` (for the changeset's `source=`), and `evidence` (links).
2. **Review.** Run `node scripts/osm/review.mjs refs/osm-fixes/<batch>.json`. It re-reads each element
   live and flags any change since the proposal. It downloads Mapillary photos along the element and
   Commons photos (the Wikidata image, its category, geotagged nearby), then writes
   `<batch>.review.html`: the tag diff, the evidence and the photos.
3. **Decide.** Run `review.mjs <batch>.json --approve w123,w456` (or `--skip w789`).
4. **Upload.** Run `node scripts/osm/apply.mjs <batch>.json` for a dry run, then add `--upload`.
   - It is one changeset per batch, and all or nothing: any element changed since the proposal stops it.
   - Only the approved tags change.
   - The changeset comment says the fix came from a MapNG review, AI-assisted, each edit checked by a
     person.
   - It is logged in `refs/output/osm-edits.md`.
