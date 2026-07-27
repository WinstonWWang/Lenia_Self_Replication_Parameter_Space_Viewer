# Off-grid featured triples: website changes handoff

Date: 2026-07-27

Website commit: `1d3ea233fd752c55c080d923a051da90f1662430`

This is a delta handoff. It describes only the website and publication
contract added for the off-grid featured triples. Continue using
`072726_CLUSTER_DATA_HANDOFF_FOR_WEBSITE.md` for the original manifest, R2
layout, credentials, coarse-point media, and general upload procedure.

## What changed in the website

The website now has an optional featured-point data plane that is independent
of the canonical 20 x 20 x 20 manifest. The canonical manifest must remain at
exactly 8,000 points.

The new plane supports three exact off-grid centers:

| Internal ID | Display label | Applied `m_local` | Applied `m_cross` | Applied `alpha` |
| --- | --- | ---: | ---: | ---: |
| `preclassification_sobol_triple_00075` | `triple_00075` | 0.3152100145816803 | 0.17585211992263794 | 0.7561357617378235 |
| `preclassification_sobol_triple_00891` | `triple_00891` | 0.2847903370857239 | 0.1466793417930603 | 0.2798478901386261 |
| `reference_triple_original` | `triple_original` | 0.2196178287267685 | 0.06508693099021912 | 0.4492952340663093 |

The catalog also contains the two canonical-linked featured centers,
`triple_01210` and `triple_01608`. Because those records have
`coarse_point_id`, the website does not draw a second global marker for them.

The three off-grid centers are rendered at their exact physical coordinates,
not at a manufactured coarse `grid_index`. They support:

- hover and click selection;
- exact-coordinate and label search;
- collision-safe selection using the namespaced internal ID;
- deep links using `?featured=<internal-id>`;
- back, forward, and Escape navigation;
- center video, poster, initial field, CLIP score/loss, provenance, and
  coordinate details;
- local manually classified neighborhoods;
- green positive cells, light-blue negative cells, and white lines only
  across adjacent tested positive/negative outcomes.

The historical labels `triple_00075` and `triple_00891` also name unrelated
canonical grid records. Do not use those display labels as database keys.

Pinned alpha views now show a clean 2D point grid for the selected alpha
plane. They do not show the cube geometry or translucent points from the other
alpha planes.

## New public catalog

Publish the new document at this stable object key:

```text
featured/featured-replicators.json
```

For the current R2 public host, that resolves to:

```text
https://pub-f0e4d19efe3248388e36842e1c75963a.r2.dev/featured/featured-replicators.json
```

The browser loads this document only when `featured_catalog_url` is present in
`public/site-config.json`. The setting is intentionally absent until the
public catalog and every referenced object pass the checks below. A missing
or invalid featured catalog fails softly and does not prevent the canonical
8,000-point viewer from loading.

The catalog and asset keys remain storage-provider-neutral. A later move from
R2 to Hugging Face requires changing the public base/configuration, not the
React or Three.js implementation.

## New exact first-publication contract

The prepared first publication must contain:

- five featured centers;
- three centers without `coarse_point_id`;
- five local neighborhoods;
- 2,905 neighborhood samples in total;
- all 2,900 numbered variation scans;
- 145 `self_replicator` samples;
- 2,760 `nonreplicator` samples;
- exact applied and source-reported center coordinates;
- the documented scan-to-coordinate, `grid_index`, axis, and
  `variation_label` mappings;
- `best_clip_score_prompt = -best_loss_prompt` within `1e-9`;
- complete video, poster, parameter, and initial-field descriptors for every
  center;
- `media.video: null` on every varied sample;
- one consistent selected initial field throughout each neighborhood;
- an explicit absolute HTTPS `asset_base_url`;
- `based_on_manifest_sha256` equal to the SHA-256 of the exact decoded live
  manifest the browser will load.

Do not let a varied sample inherit the center video. The explicit null means
that no individual variation replay was generated.

The catalog schema is:

```text
schemas/featured-catalog.schema.json
```

The validator is:

```text
scripts/validate-featured-catalog.mjs
```

The browser and command-line preflight share the same schema and semantic
implementation.

## Required staged validation

Run this from the website repository on the cluster before uploading the
catalog:

```bash
npm ci
npm run validate:featured -- \
  /absolute/path/to/featured-replicators.json \
  /absolute/path/to/decoded-live-candidate/site-manifest.json \
  --media-root /absolute/path/to/staged-object-tree \
  --expect-prepared-first-publication
```

The media root must reproduce the final public object-key layout. For example,
an asset with key `media/v1/sha256/.../replay.mp4` must exist at that relative
path below the media root.

In prepared mode, FFmpeg must be on `PATH`. If it is elsewhere, add:

```bash
--ffmpeg-command /absolute/path/to/ffmpeg
```

This pass verifies schema and semantics, file containment, file sizes,
SHA-256 values, content-addressed names, dimensions, finite field values, and
full FFmpeg decoding.

## Required post-upload validation

After uploading immutable assets and the catalog, download the public catalog
and validate it against the exact decoded live manifest:

```bash
curl --fail --location \
  --output /tmp/featured-replicators.public.json \
  https://pub-f0e4d19efe3248388e36842e1c75963a.r2.dev/featured/featured-replicators.json

npm run validate:featured -- \
  /tmp/featured-replicators.public.json \
  /absolute/path/to/decoded-live-manifest/site-manifest.json \
  --asset-base-url https://pub-f0e4d19efe3248388e36842e1c75963a.r2.dev/ \
  --expect-prepared-first-publication
```

The public pass streams and verifies every referenced object. It rejects
redirects, the wrong public base, encoded object bodies, hash or size
mismatches, and undecodable media.

## Activation boundary

Uploading the new catalog does not activate it.

After both validation passes succeed:

1. Verify the catalog is readable in a browser from the GitHub Pages origin
   under the configured R2 CORS policy.
2. Report the staged and public validator output to the website maintainer.
3. Add this setting to `public/site-config.json`:

   ```json
   "featured_catalog_url": "https://pub-f0e4d19efe3248388e36842e1c75963a.r2.dev/featured/featured-replicators.json"
   ```

4. Rebuild and redeploy GitHub Pages.
5. Smoke-test all three `?featured=` deep links.

Do not activate the configuration before the public validation succeeds.

## Website verification completed

The new website code passed:

- 85 frontend tests;
- 14 Python tests;
- TypeScript checking;
- the GitHub Pages production build;
- exact comparison against all 2,900 supplied neighborhood records;
- desktop browser QA at 1440 x 900 and 1280 x 720;
- mobile browser QA at 390 x 844;
- two independent implementation audits with no P0, P1, or P2 defects.

The code is deployed, but the featured plane remains inactive until the
cluster completes the upload and the activation boundary above is crossed.
