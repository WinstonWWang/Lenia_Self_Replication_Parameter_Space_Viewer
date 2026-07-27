# Lenia Self-Replication Parameter Space Viewer

An interactive static viewer for the cross-scale Lenia search over
\(m_\ell\), \(m_c\), and
\(\alpha = w_c / (w_c + w_\ell)\).

The production site is deployed with GitHub Pages. Scientific data and media
are loaded through a provider-neutral runtime configuration, so the object
store can move from Cloudflare R2 to another HTTP host without changing the
application code. Updating the bundled runtime config still requires a normal
static-site build and deployment.

Production URL:
<https://winstonwwang.github.io/Lenia_Self_Replication_Parameter_Space_Viewer/>

## Local development

Requirements: Node.js 24 or a compatible active LTS release. Python 3.12 is
used for the dependency-free cluster-publication preflight and its tests.

```bash
npm install
npm run dev
```

Before a change is pushed:

```bash
npm test
npm run check:public
npm run check:featured-fixture
npm run build
python -B -m unittest discover -s tests -p "test_*.py"
# With `npm run dev` running in another terminal:
npm run qa:browser
```

The browser suite uses a locally installed Edge/Chromium browser and checks
desktop, compact-laptop, and phone layouts as well as repeated cube gestures.

## Project map

- `src/data/` — strict runtime loading, validation, status derivation, URL
  safety, and search snapping.
- `src/visualization/` — reusable Three.js geometry and interaction helpers.
- `src/components/CubeViewer.tsx` — cube, slice, rail, point, and future local
  refinement rendering.
- `src/components/AlphaSidebar.tsx` — the full-cube option and 20 alpha-slice
  thumbnails.
- `src/components/DetailPanel.tsx` — media, CLIP score, experimental evidence,
  and initial-field display.
- `src/components/DynamicsDrawer.tsx` — the implemented dynamics equations.
- `public/site-config.json` — storage-provider URLs; the application contains
  no Cloudflare- or Hugging-Face-specific fetching logic.
- `public/data/review-overlay.json` — manually reviewed coarse-grid labels.
- `public/data/refinement-catalog.json` — optional fine neighborhoods around
  selected coarse points.
- `scripts/validate_auxiliary_data.py` — cluster-side strict preflight for
  manual-review/refinement JSON, local media hashes, and 256 × 256 field
  payloads.
- `schemas/featured-catalog.schema.json` and
  `scripts/validate-featured-catalog.mjs` — exact off-grid featured-point
  contract and the website-equivalent schema/semantic preflight.

Most visual changes are controlled by CSS custom properties near the top of
`src/styles.css`. Status colors are centralized in the data/visualization
helpers so the cube, legend, and thumbnails stay consistent.

## Runtime data flow

On startup the viewer:

1. Loads `site-config.json` relative to the deployed Vite base path.
2. Tries the configured immutable-manifest pointer.
3. Strictly validates both the pointer and snapshot.
4. Falls back to the bundled manifest if the remote source is unavailable or
   invalid.
5. Loads manual-review, refinement, and optional off-grid featured catalogs
   independently and fail-soft.

All relative URLs in the config are resolved against the config file itself.
Media keys are resolved only after path and base-containment checks.

Changing storage providers is therefore a config/data publication task:
publish the same object layout on the new HTTPS host and update
`manifest_pointer_url`, then deploy the updated static config. The React and
Three.js code does not change.

The cluster-facing packaging, media, manual-review, refinement, R2
transaction, and verification contract is in
[`072726_CLUSTER_DATA_HANDOFF_FOR_WEBSITE.md`](./072726_CLUSTER_DATA_HANDOFF_FOR_WEBSITE.md).

## Manual review overlay

`public/data/review-overlay.json` contains records keyed by the stable coarse
point ID:

```json
{
  "schema_version": 1,
  "dataset_id": "product-lenia-mlocal-mcross-alpha-v1",
  "reviews": [
    {
      "point_id": "triple_00503",
      "status": "self_replicator"
    }
  ]
}
```

Only `self_replicator` reviews turn coarse points green. A reviewed
`nonreplicator` remains the normal coarse-grid color. Explicit light-blue
negative cells are represented separately in the refinement catalog.

## Fine-neighborhood catalog

Fine neighborhoods are explicitly sampled and data-driven. Each neighborhood
supplies its own axis values, so spacing can be nonuniform and need not be
`0.01`. Every sample is either `self_replicator` or `nonreplicator`; omitted
coordinates are unknown, not negative.

The viewer draws translucent green positive cells, lighter-blue explicit
negative cells, and a white boundary only where a positive cell touches an
explicit negative neighbor. It does not interpolate across unknown cells.
Shared-field media may be attached to the neighborhood so nearby parameters
can replay the anchor point’s selected initial field. Alternatively,
`replay_source_point_id` can reference the coarse point whose published
review/manifest media should be reused.

## Off-grid featured catalog

Confirmed centers that are not canonical 20 × 20 × 20 grid points remain in a
separate optional catalog. Validate a staged or publicly downloaded catalog
against the exact browser contract before adding its URL to
`public/site-config.json`:

```bash
npm run validate:featured -- /path/to/featured-replicators.json \
  /path/to/decoded-live-candidate/site-manifest.json \
  --media-root /path/to/staged-object-tree \
  --expect-prepared-first-publication
```

The prepared-publication command requires its second argument to be the exact
decoded live-candidate manifest the catalog pins and the browser will load.
Omitting it is supported only for the tracked development fixture. Use
`--asset-base-url https://your-public-host.example/` instead of
`--media-root` to verify every object after publication; that public base must
match the effective base declared by the catalog (or manifest), exactly as the
browser will resolve it. Featured assets still use provider-neutral
`media/v1/` or `repro/v1/` keys. The prepared-publication gate also enforces
the five reviewed centers, all 2,900 numbered variation scans, the 145/2,760
replicator/nonreplicator result, authoritative source/applied coordinates and
scan-to-grid mapping, CLIP-score identity, complete center media, and explicit
null variation videos. In prepared mode, FFmpeg must be available on `PATH`
(or named with `--ffmpeg-command`) and must fully decode every poster, video,
and image-encoded initial field.

## GitHub Pages

The Vite base path is derived from the `GITHUB_REPOSITORY` environment variable
during CI, so repository renames do not require a source-code edit. The
workflow in `.github/workflows/deploy-pages.yml` tests, builds, and deploys
`dist`.

## Public-data boundary

Only the sanitized 8,000-point manifest, its referenced fallback poster, the
two public overlays, and JSON schemas are committed. Raw records, sample
records, cluster paths, publisher credentials, checkpoints, PDFs, smoke MP4s,
and optimizer state must remain outside this repository.
