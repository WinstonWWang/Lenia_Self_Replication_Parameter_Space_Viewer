# Cluster-to-Website Data Publication Handoff (2026-07-27)

Updated: 2026-07-27

This document is the operational contract for the cluster agent that prepares
and publishes data for the Lenia Self-Replication Parameter Space Viewer.
Follow it literally for the first Cloudflare R2 publication. Do not infer
self-replication from a search score, add untested cells to a refinement
region, or publish a pointer before every referenced object is present.

The machine-enforced sources of truth in the website repository are:

```text
schemas/site-manifest.schema.json
schemas/latest-pointer.schema.json
src/data/types.ts
src/data/validators.ts
src/data/semantics.ts
src/data/manifest-integrity.ts
src/data/urls.ts
scripts/validate_auxiliary_data.py
scripts/validate-featured-catalog.mjs
```

If a future code change disagrees with this prose, stop publication and
reconcile the contract rather than weakening validation.

## Deployment targets

- Website:
  <https://winstonwwang.github.io/Lenia_Self_Replication_Parameter_Space_Viewer/>
- Current public object base:
  <https://pub-f0e4d19efe3248388e36842e1c75963a.r2.dev>
- R2 bucket name: `lenia-self-replication-data`
- Dataset ID: `product-lenia-mlocal-mcross-alpha-v1`
- Manifest pointer:
  `https://pub-f0e4d19efe3248388e36842e1c75963a.r2.dev/manifests/latest.json`

The R2 endpoint is runtime configuration, not part of the application logic or
object-key scheme. The same contract can later be served by Hugging Face or
another HTTPS object host.

At the time of this handoff, the R2 pointer is not yet published, so the site
intentionally displays its bundled checkpoint. The bundled manifest is a
fallback artifact and has an empty `asset_base_url`. **Do not upload that
frozen manifest as the live R2 manifest.** Rebuild it with the public R2 base
URL as described below.

The bucket CORS policy shown in the Cloudflare dashboard is suitable for this
site if it was saved. The allowed production origin must be exactly
`https://winstonwwang.github.io`, with no repository path and no trailing
slash.

## Immediate first-publication path

For the upload being prepared now:

1. Stage coarse posters, MP4s, and parameter objects under
   `data/public/<object-key>` and record their exact bytes/SHA-256 in
   `data/media-index.local.json`.
2. Apply the base-validator parity corrections below. If any descriptor uses
   `repro/v1/`, also apply the publisher correction before continuing.
3. Load the bucket-scoped R2 environment, including the exact public base URL.
4. Run `publish_snapshot_to_r2.sh ... --dry-run` and require a clean validator
   result.
5. Set `R2_VERIFY_ALL_MEDIA=1` for the first upload, remove `--dry-run`, and let
   the script publish immutable assets/snapshot before the pointer.
6. Run the public CORS, compressed-object, metadata, and representative-media
   checks in this document.
7. Return the publication report at the end of this handoff.

Manual review labels and fine neighborhoods may remain empty during this first
coarse-data publication. Do not delay the base pointer merely to invent those
later data planes, and do not invent a manual label to attach an initial
field.

## What the data drives

The viewer renders the canonical 20 by 20 by 20 grid over
\(m_\ell, m_c, \alpha\), where
\(\alpha = w_c/(w_c+w_\ell)\).

The coarse cube has four display states:

| Website state | Data source | Color | Scientific meaning |
| --- | --- | --- | --- |
| Physically uninteresting | Base classification `excluded_by_m_local_cutoff` | `#17191c` | Excluded by the configured \(m_\ell\) cutoff; not tested with the 60-field ensemble |
| Experimentally dead | Base classification `experimentally_dead` | `#030405` | All 60 fields reached the exact-vacuum criterion |
| Unresolved | Base classification `dynamics_unresolved`, without a positive manual review | `#69adff` | At least one field did not confirm exact vacuum; this does not establish replication |
| Self-replicator | Manual review status `self_replicator` | `#43d879` | Winston manually assigned this label to the whole coarse parameter triple |

The 60-field screen means exactly:

- 20 random Voronoi polygons;
- 20 random 2D Gaussians;
- 20 random Fourier curves.

The ASAL value displayed as “CLIP score” is
`best_clip_score_prompt = -best_loss_prompt`; higher is better for that search
quantity. It is always presented with the warning “Search score, not
replication verification.” A completed search, a high score, a poster, a
segmentation event, or a cluster “candidate of interest” flag must **never**
automatically create a green point.

Clicking a coarse point opens its replay, parameter/score context, and initial
field when those assets exist. Selecting a manually reviewed green point can
also open a fine, data-driven neighborhood:

- tested self-replicating fine cells are translucent green;
- tested nonreplicating fine cells are light blue;
- omitted cells are unknown and are not rendered;
- a white boundary is drawn only where an explicit green cell shares a face
  with an explicit light-blue cell.

## The four data planes

Keep these concerns separate.

| Plane | Purpose | Publication model |
| --- | --- | --- |
| Base manifest | Fixed 8,000-point grid, extinction evidence, ASAL progress, CLIP search context, coarse posters/videos/parameters | Immutable hashed snapshot selected by `manifests/latest.json` |
| Review overlay | Winston’s manual labels for unresolved coarse triples, plus reviewed-point media such as the 256 by 256 selected field | Small mutable JSON document |
| Refinement catalog | Explicit fine axes and manually labelled samples around selected green triples | Small mutable JSON document plus immutable media |
| Featured catalog | Exact off-grid confirmed centers and their local manually labelled neighborhoods, kept separate from the canonical 8,000-point grid | Small mutable JSON document plus immutable media |

This separation is deliberate. The cluster may update ASAL progress and media
without overwriting manual labels, and Winston may review points without
regenerating the 5 MB base manifest.

The currently deployed `site-config.json` already points the base manifest at
R2, but its review and refinement URLs still point to bundled empty files:

```json
{
  "review_overlay_url": "./data/review-overlay.json",
  "refinement_catalog_url": "./data/refinement-catalog.json"
}
```

Therefore:

1. Publishing `manifests/latest.json` activates live coarse data immediately.
2. Uploading R2 review/refinement JSON alone will not activate those documents
   yet.
3. Once the stable auxiliary URLs exist, the website repository needs one
   small configuration update and GitHub Pages deployment:

```json
{
  "review_overlay_url": "https://pub-f0e4d19efe3248388e36842e1c75963a.r2.dev/overlays/review-overlay.json",
  "refinement_catalog_url": "https://pub-f0e4d19efe3248388e36842e1c75963a.r2.dev/refinements/refinement-catalog.json"
}
```

After that one deployment, the site refetches the configured data planes every five
minutes, and normal data updates do not require a code deployment.

## Required R2 object layout

Use this storage-neutral key layout:

```text
manifests/
  latest.json
  snapshots/
    <manifest-sha256>.json

media/
  v1/
    triple_XXXXX/
      top_1/
        <asset-sha256>.webp
        <asset-sha256>.png
        <asset-sha256>.mp4
      refinement/
        <neighborhood-id>/
          <sample-id>/
            <asset-sha256>.mp4

repro/
  v1/
    triple_XXXXX/
      top_1/
        <asset-sha256>.npy
        <asset-sha256>.json
      refinement/
        <neighborhood-id>/
          <asset-sha256>.npy

overlays/
  review-overlay.json

refinements/
  refinement-catalog.json

featured/
  featured-replicators.json
```

R2 presents a flat object namespace; the slashes are stable key prefixes, not
filesystem directories on the service.

The supplied publisher also copies any local `data/public/smoke/` directory.
That prefix is not part of the production dataset layout. Remove or move the
transport-only smoke fixture before the real publication; use it only in a
separate test bucket.

Every asset referenced by the manifest, review overlay, refinement catalog, or
featured catalog must use a relative key beginning with `media/v1/` or
`repro/v1/`. Keys must not contain a leading slash, backslash, percent sign,
query, fragment, empty segment, `.` segment, or `..` segment. Do not place a
host name or signed URL in an asset `key`.

Use content-addressed names. The 64-character lowercase SHA-256 in the
filename must be the SHA-256 of the exact uploaded bytes.

`<sample-id>` in the illustrative storage tree is only a sanitized path
segment chosen by the publisher, such as `i01_j03_k02`. Fine-sample JSON has no
`id` or `sample_id` property in schema version 1.

## Off-grid featured catalog publication

Publish the off-grid featured catalog at the stable R2 object key:

```text
featured/featured-replicators.json
```

Its normative structural contract is
[`schemas/featured-catalog.schema.json`](schemas/featured-catalog.schema.json).
The website additionally performs semantic validation against the active base
manifest, including identity/reference integrity, exact sample coordinates,
axis ordering, parameter bounds, media-key safety, and manifest compatibility.
Standalone schema tooling must register the schema's
`published-asset-base-url` custom format with the website rule: an empty
inherited base or a clean absolute HTTPS directory URL with no credentials,
query, fragment, backslash, surrounding whitespace, or control character.

Every center or variation asset must be referenced through an asset descriptor
under the catalog's `media`, `shared_media`, or sample `media` properties.
Upload each immutable object at the descriptor's exact `key`; do not infer an
asset from a display label, scan index, local path, or naming convention.

Preflight the complete catalog and all referenced staged assets against both
the strict schema and the website's semantic contract before publication.
Then fetch the public object bytes and repeat validation before enabling it.
The existing review/refinement auxiliary preflight does not by itself validate
this featured document.

Run the website's exact schema and semantic validator from the website
repository, first on the staged file and then on the publicly downloaded
bytes:

```powershell
npm ci
npm run validate:featured -- C:\path\to\featured-replicators.json C:\path\to\decoded-live-candidate\site-manifest.json `
  --media-root C:\path\to\staged-object-tree `
  --expect-prepared-first-publication
```

On the Linux cluster, use the equivalent absolute paths:

```bash
npm ci
npm run validate:featured -- /path/to/featured-replicators.json \
  /path/to/decoded-live-candidate/site-manifest.json \
  --media-root /path/to/staged-object-tree \
  --expect-prepared-first-publication
```

For readability, the same required production-manifest argument is shown
separately here:

```powershell
npm run validate:featured -- C:\path\to\featured-replicators.json C:\path\to\site-manifest.json `
  --media-root C:\path\to\staged-object-tree `
  --expect-prepared-first-publication
```

For the post-upload pass, validate the downloaded catalog while streaming
every referenced public asset from its deployed base:

```bash
npm run validate:featured -- /path/to/downloaded-featured-replicators.json \
  /path/to/decoded-live-manifest/site-manifest.json \
  --asset-base-url https://your-public-object-host.example/ \
  --expect-prepared-first-publication
```

When `--expect-prepared-first-publication` is present, the validator rejects a
missing second positional argument. The bundled fallback manifest is only a
development-fixture default; it must never stand in for the rebuilt live R2
manifest because the live manifest has its own SHA-256 and nonempty public
asset base. In prepared mode, the verifier also recomputes the canonical
manifest digest from the exact file bytes before accepting the catalog pin.

The command verifies every referenced object's existence, byte count,
SHA-256, content-addressed filename, and declared payload dimensions and
finite initial-field values. In prepared mode it also runs a full FFmpeg decode
of every poster, video, and image-encoded initial field; `ffmpeg` must be on
`PATH`, or pass `--ffmpeg-command /absolute/path/to/ffmpeg`. Public
`--asset-base-url` verification rejects redirects and is rejected unless the
supplied base exactly matches the effective catalog/manifest asset base that
the browser will use. Public reads have a two-minute per-object transfer
timeout and a streaming 512 MiB per-object ceiling. The prepared-publication
gate requires an explicit
catalog `asset_base_url`; complete poster, video, parameters, and initial-field
descriptors for all five centers; explicit `media.video: null` on every varied
sample; one consistent selected initial field throughout each neighborhood;
no center/shared/sample override that shadows the center poster or replay;
complete CLIP/loss fields with
`best_clip_score_prompt = -best_loss_prompt`, provenance, and a score warning
for each off-grid center; the authoritative applied and higher-precision
source-reported coordinates; all numbered scans from Winston's manual ranges;
the authoritative scan-to-coordinate/grid-index/variation-label mapping
generated by the documented `[-5..-1,+1..+5]` one-percent offsets (local
outer, cross middle, alpha inner), including axes equal to exactly the sorted
unique sampled values plus the center; and exactly 145 `self_replicator` plus
2,760 `nonreplicator` samples. It must report five centers, three off-grid
centers, five neighborhoods, and 2,905 samples. It shares the AJV schema and
semantic implementation used by the browser; do not replace it with
schema-only validation.

For each varied sample, make `variation_label` a string ending in the numeric
source-catalog label, such as `triple_01608_v0051`; the prepared gate compares
that trailing number as well as the exact scan index, coordinates, and grid
index.

Keep `featured_catalog_url` absent from production `site-config.json` until
`featured/featured-replicators.json` is public, CORS-readable, and passes that
full validation. Uploading media or the catalog does not activate the data
plane; the website configuration change is a separate final release step.

## Point identity and grid placement

The cube point identity is determined by the canonical grid, not by the raw
Sobol coordinate:

```text
grid_index = [m_local_index, m_cross_index, alpha_index]
global_index = (m_local_index * 20 + m_cross_index) * 20 + alpha_index
point_id = "triple_" + global_index padded to five digits
```

Examples:

```text
grid_index [1, 5, 3] -> global_index 503 -> triple_00503
grid_index[2] is the alpha-slice index
```

All three indices are in `0..19`. The point’s displayed coordinates must equal
the exact floating-point values at those three axis indices. Do not recompute
or round them for the manifest.

The supplied Sobol plan already associates every unresolved search with one
canonical `global_index`. Preserve that mapping exactly. Preserve
`sobol_unit_point`, `sobol_draw_index`, and `sequence_index` as provenance
under `asal`, but never re-bin or recompute a grid association from the raw
Sobol triple. The website trusts the supplied grid identity and does not
perform a containment calculation.

## Base checkpoint invariants

The current public schema is intentionally strict:

- exactly 8,000 points in ascending `global_index` order;
- exactly 400 `excluded_by_m_local_cutoff`;
- exactly 6,412 `experimentally_dead`;
- exactly 1,188 `dynamics_unresolved`;
- every unresolved point has one unique Sobol `sequence_index`;
- excluded/dead points have `asal.status = "not_applicable"`;
- excluded/dead points have coarse `poster`, `video`, and `parameters` set to
  `null`; they must retain the agreed black/unavailable detail placeholders;
- unresolved points have `asal.status = "not_started"` or `"completed"`;
- completed budgets are 300 or 900 seconds;
- `best_clip_score_prompt + best_loss_prompt` is zero within numerical
  tolerance;
- an available report supplies exactly the top three candidates;
- the summary counts and media counts exactly match the point records.

The bundled 2026-07-27 checkpoint contains:

- 337 completed ASAL points;
- 851 not started;
- 103 completed with a 300-second budget;
- 234 completed with a 900-second budget;
- 233 reports available;
- one real point poster, no point videos, and no parameter objects.

Those progress values may change in a newly built checkpoint, but the three
coarse classification counts and 8,000-point identity must not.

The transfer package’s older `validate_public_manifest.py` is not yet at
semantic parity with the website. Before the first live build, add all of the
following checks: finite/increasing axes, unique Sobol sequence indices,
dead/cutoff media exclusion, browser-safe content-addressed keys, the exact
live asset base, and the website’s complete forbidden-text patterns.

Add `math` and extend its existing pathlib import:

```python
import math
from pathlib import Path, PurePosixPath
```

Replace its `FORBIDDEN_TEXT` tuple and add these helpers near the other
module-level helpers:

```python
FORBIDDEN_TEXT = (
    re.compile(r"/n/(?:home|holylabs|netscratch)", re.IGNORECASE),
    re.compile(r"[a-z]:\\", re.IGNORECASE),
    re.compile(r"secret[_-]?access[_-]?key", re.IGNORECASE),
    re.compile(r"access[_-]?key[_-]?id", re.IGNORECASE),
    re.compile(r"api[_-]?token", re.IGNORECASE),
    re.compile(r"hf_[a-z0-9]+", re.IGNORECASE),
)
ASSET_KEY_PREFIX = re.compile(r"^(?:media|repro)/v1/")
ASSET_KEY_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def is_finite_number(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError, OverflowError):
        return False


def assert_safe_asset_descriptor(asset: dict[str, Any]) -> None:
    key = asset["key"]
    assert ASSET_KEY_PREFIX.match(key)
    assert not any(character in key for character in "\\%?#")
    assert ASSET_KEY_CONTROL.search(key) is None
    segments = key.split("/")
    assert all(segment not in ("", ".", "..") for segment in segments)
    assert PurePosixPath(key).stem == asset["sha256"]
```

After the existing dataset assertion, require the actual live object root:

```python
assert payload["asset_base_url"] == (
    "https://pub-f0e4d19efe3248388e36842e1c75963a.r2.dev"
)
```

Replace the existing three-axis length loop with:

```python
for name in ("m_local", "m_cross", "alpha"):
    axis = payload["axes"][name]
    values = axis["values"]
    assert axis["count"] == len(values) == 20
    assert all(
        is_finite_number(value)
        and (index == 0 or value > values[index - 1])
        for index, value in enumerate(values)
    )
```

Initialize `sequence_indices: set[int] = set()` beside the validator’s other
counters. Inside the `dynamics_unresolved` branch of the point loop, add:

```python
sequence_index = point["asal"]["sequence_index"]
assert isinstance(sequence_index, int) and not isinstance(sequence_index, bool)
assert sequence_index not in sequence_indices
sequence_indices.add(sequence_index)
```

After the point loop, require full unique coverage:

```python
assert len(sequence_indices) == 1188
```

Also add the classification assertion inside the point loop, before iterating
over `point["media"]`:

```python
if point["classification"] != "dynamics_unresolved":
    assert all(asset is None for asset in point["media"].values())
```

Call the helper for every non-null descriptor at the top of the existing
media loop:

```python
for kind, asset in point["media"].items():
    if asset is None:
        continue
    assert_safe_asset_descriptor(asset)
    # retain the original count and local file/hash checks below
```

Do not remove the original root-containment, file-existence, byte-count, or
SHA-256 checks, and retain `--require-json-schema`. These additions make the
old publication validator cover the browser-semantic gaps known at this
handoff. A future change to `src/data/semantics.ts` must be mirrored here
before publication. The media ledger should already obey these rules; the
assertions prevent future ledger mistakes from reaching R2.

## Preparing coarse assets

The supplied publisher reads a local media ledger. Stage every referenced
object beneath the handoff package’s `data/public/` directory at the same
relative key it will have in R2.

Only `dynamics_unresolved` points may receive coarse ledger assets in the
current UI contract. Leave poster, video, and parameters absent/null for all
experimentally dead and cutoff-excluded points so those selections retain
their black unavailable placeholders.

Example staging paths:

```text
data/public/media/v1/triple_00503/top_1/<sha256>.webp
data/public/media/v1/triple_00503/top_1/<sha256>.mp4
data/public/repro/v1/triple_00503/top_1/<sha256>.npy
```

The media ledger has this shape. The angle-bracket values below are
placeholders and must be replaced before validation:

```json
{
  "schema_version": 1,
  "objects": {
    "triple_00503": {
      "poster": {
        "key": "media/v1/triple_00503/top_1/<poster-sha256>.webp",
        "sha256": "<poster-sha256>",
        "bytes": 123456,
        "width": 1600,
        "height": 900,
        "source": "ASAL top-rank poster"
      },
      "video": {
        "key": "media/v1/triple_00503/top_1/<video-sha256>.mp4",
        "sha256": "<video-sha256>",
        "bytes": 1234567,
        "width": 800,
        "height": 800,
        "frames": 1001,
        "fps": 30,
        "scored_updates": 800,
        "replay_updates": 1000,
        "source": "ASAL top-rank 1000-update replay"
      },
      "parameters": {
        "key": "repro/v1/triple_00503/top_1/<parameters-sha256>.npy",
        "sha256": "<parameters-sha256>",
        "bytes": 123456,
        "format": "npy",
        "source": "ASAL top-rank parameters"
      }
    }
  }
}
```

Omit a ledger property when that asset does not exist. The manifest builder
will emit `null` for missing coarse poster, video, or parameter assets. Never
guess a URL or descriptor.

### Coarse asset requirements

| Asset | Descriptor fields | Recommended file |
| --- | --- | --- |
| Poster | `key`, `sha256`, `bytes`, `width`, `height`; optional sanitized `source` | WebP or PNG |
| Video | Poster fields plus `frames`, `fps`, `scored_updates: 800`, `replay_updates: 1000` | H.264 MP4, `yuv420p`, browser fast-start, normally 800 by 800 and 1001 frames at 30 fps |
| Parameters | `key`, `sha256`, `bytes`; optional `format` and sanitized `source` | NPY or JSON |
| Initial field | `key`, `sha256`, `bytes`, `format`, `width: 256`, `height: 256`; optional `value_min`, `value_max`, sanitized `source` | Prefer little-endian C-order float32 NPY; JSON, PNG, and WebP are also supported |

`bytes` and `sha256` always describe the exact object bytes, not a decoded
array, a source file from which the object was derived, or an R2 ETag.

Do not put cluster paths, usernames, Slurm IDs, exception traces, credentials,
API tokens, or secrets in `source` or any other public string. A harmless
provenance phrase such as `ASAL top-rank replay` is enough.

### Initial-field limitation in the base manifest

The base point manifest currently accepts only:

- `poster`;
- `video`;
- `parameters`.

It does **not** accept `initial_field` under a coarse point’s `media` object,
and the original manifest builder silently ignores unknown media-index
properties. Initial fields belong in the review overlay or refinement catalog.

It is safe to upload hash-addressed 256 by 256 field objects now, but retain
their descriptors in a private review-candidate ledger until Winston supplies
the manual `self_replicator` or `nonreplicator` label. Do not invent a label
merely to make a field appear.

The viewer accepts these field encodings:

- NPY: shape `(256, 256)`, `fortran_order=False`; recommended dtype `<f4`.
  Supported dtypes are float32, float64, uint8, uint16, int16, and int32.
- JSON: exactly 65,536 finite values as a flat array, a 256-row nested array,
  or an object whose `values`, `data`, or `field` property contains one of
  those arrays. An optional `shape` must be `[256, 256]`.
- PNG or WebP: exactly 256 by 256 pixels.

For numeric NPY/JSON, the browser maps `value_min..value_max` to its heatmap
palette; the defaults are 0 and 1.

The auxiliary preflight checks the staged payload itself, not only descriptor
metadata: JSON values, NPY header/data, PNG chunks/decompressed scanlines, and
WebP RIFF/frame structure must all agree with the declared format and 256 by
256 dimensions. Because the Python standard library has no WebP entropy
decoder, use NPY, JSON, or PNG for the first publication. Publish a WebP field
only after a trusted image decoder has also opened the exact hash-addressed
file successfully.

## Using the supplied publisher

The original transfer package is:

```text
LeniaPhaseSpaceSiteHandoff/
  lenia_phase_space_site_handoff_2026-07-26/
```

Its relevant files are:

```text
scripts/build_public_manifest.py
scripts/validate_public_manifest.py
scripts/publish_snapshot_to_r2.sh
schemas/site-manifest.schema.json
schemas/latest-pointer.schema.json
requirements-publisher.txt
```

Use the transfer package’s designated cluster Python 3.12 publisher
environment with its recorded requirements, plus `rclone` and `flock`. If the
package has moved, set `PYTHON_BIN=/path/to/designated/python3.12`. Keep that
interpreter and minor version fixed across publications: Python gzip header
details can differ across versions even with `mtime=0`, while the immutable
object digest covers the exact compressed bytes.

Create a private cluster file such as
`~/.config/lenia-r2/credentials.env`, mode `600`:

```bash
R2_ACCOUNT_ID=<Cloudflare account ID>
R2_BUCKET_NAME=lenia-self-replication-data
R2_ACCESS_KEY_ID=<bucket-scoped object read/write access key ID>
R2_SECRET_ACCESS_KEY=<secret shown once by Cloudflare>
R2_PUBLIC_BASE_URL=https://pub-f0e4d19efe3248388e36842e1c75963a.r2.dev
```

The Cloudflare account ID is not the bucket name or the opaque identifier in
the public `r2.dev` host. Never commit or paste this populated file into a
ticket, chat, log, manifest, browser bundle, or GitHub repository.

Load it before **both** the dry run and real publication:

```bash
chmod 600 ~/.config/lenia-r2/credentials.env
set -a
source ~/.config/lenia-r2/credentials.env
set +a
```

Setting `R2_PUBLIC_BASE_URL` during the dry run is important. Without it, the
dry run builds a fallback-style manifest with an empty asset base and does not
exercise the live-media configuration.

From the transfer-package root:

```bash
export R2_VERIFY_ALL_MEDIA=1

scripts/publish_snapshot_to_r2.sh \
  --run-root /path/to/authoritative/run-root \
  --media-index data/media-index.local.json \
  --dry-run
```

Use the actual authoritative run root if it differs. The builder reads
`done.json`, optional `top3/top3.json`, and optional
`report/summary.json` beneath each `triple_XXXXX` directory.

The dry run must finish with the manifest validator succeeding. Then perform
the real write by removing only `--dry-run`:

```bash
scripts/publish_snapshot_to_r2.sh \
  --run-root /path/to/authoritative/run-root \
  --media-index data/media-index.local.json
```

For the first bulk upload, keep `R2_VERIFY_ALL_MEDIA=1`; otherwise the
publisher only performs a full remote download comparison automatically while
the media set is at most 100 MB.

### Required publisher correction for `repro/`

The supplied `publish_snapshot_to_r2.sh` validates descriptors beneath
`data/public/repro/`, but its upload, size-ceiling, and remote-check loops
currently include only `media/` and `smoke/`. A manifest can therefore
validate locally yet publish a broken `repro/v1/...` URL.

Before publishing any parameter or initial-field object under `repro/v1/`,
make these three scoped edits while preserving the existing verification
policy:

1. Add `"$ROOT/data/public/repro"` as a third path argument in the existing
   `LOCAL_MEDIA_BYTES` Python invocation.
2. Add this copy block beside the existing `media` and `smoke` copy blocks,
   before the manifest upload:

```bash
if [[ -d "$ROOT/data/public/repro" ]]; then
  rclone copy "$ROOT/data/public/repro" "$REMOTE/repro" \
    --s3-no-check-bucket \
    --size-only \
    --immutable \
    --metadata-set "$IMMUTABLE_CACHE"
fi
```

3. Add this check block **inside** the existing
   `R2_VERIFY_ALL_MEDIA`/size-threshold full-verification branch:

```bash
if [[ -d "$ROOT/data/public/repro" ]]; then
  rclone check "$ROOT/data/public/repro" "$REMOTE/repro" \
    --s3-no-check-bucket \
    --download \
    --one-way
fi
```

Do not run a second independent publisher concurrently. The supplied script
uses a shared-home lock and refuses stale/concurrently changed pointers, but
one designated publisher remains the operating rule.

### Auxiliary documents are not uploaded by the supplied publisher

The original script publishes coarse media, the immutable manifest, and its
pointer. It does not upload `overlays/review-overlay.json` or
`refinements/refinement-catalog.json`.

Treat those as a later, separate transaction:

1. validate the complete auxiliary document against the exact newly published
   base manifest;
2. upload all new hash-addressed assets first;
3. remotely verify those assets;
4. replace the stable JSON object with
   `Content-Type: application/json; charset=utf-8` and
   `Cache-Control: no-cache, max-age=0, must-revalidate`;
5. fetch and compare the stable JSON object;
6. report its URL to the website agent for the one-time runtime-config change.

There is no `latest.json` pointer schema for these two small documents. Their
stable object itself is the mutable publication target.

The website repository now supplies a standard-library-only cluster preflight:

```text
scripts/validate_auxiliary_data.py
```

Run it against the exact decoded live manifest and the complete candidate
documents before any auxiliary upload:

```bash
WEBSITE_REPO=/path/to/Lenia_Self_Replication_Parameter_Space_Viewer

"$PYTHON_BIN" "$WEBSITE_REPO/scripts/validate_auxiliary_data.py" \
  --manifest /path/to/decoded/live/site-manifest.json \
  --review-overlay /path/to/candidate/review-overlay.json \
  --refinement-catalog /path/to/candidate/refinement-catalog.json \
  --media-root /path/to/staged/public-object-root \
  --require-media-files
```

The media root is the directory directly containing `media/` and `repro/`.
The command exits nonzero for strict-field, semantic, safety, visibility,
local byte-count, SHA-256, initial-field extension/format, or actual
initial-field payload failures. It also requires every refinement center to
have a matching coarse `self_replicator` review and rejects duplicate centers,
because otherwise the valid JSON would be unreachable or ambiguous in the
current UI.

For the later trusted auxiliary upload, reuse the same credential environment
and Cloudflare rclone configuration as the supplied publisher. After all
referenced immutable media has been uploaded and verified:

```bash
set -euo pipefail

for name in R2_ACCOUNT_ID R2_BUCKET_NAME R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY
do
  if [[ -z "${!name:-}" ]]; then
    printf 'Required environment variable is unset: %s\n' "$name" >&2
    exit 2
  fi
done

export RCLONE_CONFIG_LENIAR2_TYPE=s3
export RCLONE_CONFIG_LENIAR2_PROVIDER=Cloudflare
export RCLONE_CONFIG_LENIAR2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_LENIAR2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_LENIAR2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
export RCLONE_CONFIG_LENIAR2_REGION=auto
export RCLONE_CONFIG_LENIAR2_NO_CHECK_BUCKET=true

AUX_REVIEW=/path/to/validated/review-overlay.json
AUX_REFINEMENT=/path/to/validated/refinement-catalog.json
AUX_MEDIA_ROOT=/path/to/staged/public-object-root
AUX_REMOTE="leniar2:${R2_BUCKET_NAME}"
AUX_VERIFY_DIR="$(mktemp -d /tmp/lenia-r2-aux-verify.XXXXXX)"
trap 'rm -rf -- "$AUX_VERIFY_DIR"' EXIT
IMMUTABLE_CACHE="cache-control=public, max-age=31536000, immutable"
NO_CACHE="cache-control=no-cache, max-age=0, must-revalidate"

for prefix in media repro
do
  if [[ -d "$AUX_MEDIA_ROOT/$prefix" ]]; then
    rclone copy "$AUX_MEDIA_ROOT/$prefix" "$AUX_REMOTE/$prefix" \
      --s3-no-check-bucket \
      --size-only \
      --immutable \
      --metadata-set "$IMMUTABLE_CACHE"
    rclone check "$AUX_MEDIA_ROOT/$prefix" "$AUX_REMOTE/$prefix" \
      --s3-no-check-bucket \
      --download \
      --one-way
  fi
done

rclone copyto "$AUX_REVIEW" \
  "$AUX_REMOTE/overlays/review-overlay.json" \
  --s3-no-check-bucket \
  --metadata-set "$NO_CACHE" \
  --metadata-set "content-type=application/json; charset=utf-8"

rclone copyto "$AUX_REMOTE/overlays/review-overlay.json" \
  "$AUX_VERIFY_DIR/review-overlay.json" \
  --s3-no-check-bucket \
  --quiet
cmp -s "$AUX_REVIEW" "$AUX_VERIFY_DIR/review-overlay.json"

rclone copyto "$AUX_REFINEMENT" \
  "$AUX_REMOTE/refinements/refinement-catalog.json" \
  --s3-no-check-bucket \
  --metadata-set "$NO_CACHE" \
  --metadata-set "content-type=application/json; charset=utf-8"

rclone copyto "$AUX_REMOTE/refinements/refinement-catalog.json" \
  "$AUX_VERIFY_DIR/refinement-catalog.json" \
  --s3-no-check-bucket \
  --quiet
cmp -s "$AUX_REFINEMENT" "$AUX_VERIFY_DIR/refinement-catalog.json"

rclone lsjson --metadata \
  "$AUX_REMOTE/overlays/review-overlay.json" \
  --s3-no-check-bucket
rclone lsjson --metadata \
  "$AUX_REMOTE/refinements/refinement-catalog.json" \
  --s3-no-check-bucket
```

Require both `cmp` commands to succeed. Inspect the two metadata records for
the exact no-cache policy and JSON content type. Do not use `--immutable` for
these two stable mutable keys. Publish the review first and catalog second so
new refinement centers never precede the green coarse labels that expose them.

## Manifest encoding and pointer contract

Do not hand-edit, pretty-print, or recompress the staged live manifest. The
builder creates four related artifacts:

```text
site-manifest.json
site-manifest.json.gz
latest.json
site-manifest-summary.json
```

The live manifest’s `asset_base_url` must be the clean, absolute, nonempty
HTTPS object root, without a query, fragment, or trailing slash. The loader
can normalize a trailing slash, but this publication contract deliberately
uses one canonical spelling. Empty is reserved for the bundled GitHub
fallback.

The encoding rules are exact:

1. Serialize the payload with sorted keys, compact separators, ASCII escaping,
   and no NaN/Infinity.
2. Compute `manifest_sha256` over those canonical bytes **before** adding the
   `manifest_sha256` field.
3. Add the digest field, serialize canonically again, and append exactly one
   LF byte.
4. `manifest_bytes` is the length of that final decoded JSON file.
5. Compress that complete file using gzip level 9 with `mtime=0`.
6. `manifest_object_sha256` and `manifest_object_bytes` describe those exact
   compressed bytes.
7. Name the immutable object
   `manifests/snapshots/<manifest_sha256>.json`.

The snapshot object has a `.json` key but contains the deterministic gzip
bytes. It must have `Content-Encoding: gzip`; browsers then deliver decoded
JSON to the application.

The pointer must have exactly:

```json
{
  "schema_version": 1,
  "published_at": "ISO-8601 date-time",
  "manifest_key": "manifests/snapshots/<manifest-sha256>.json",
  "manifest_sha256": "<semantic manifest digest>",
  "manifest_bytes": 1,
  "manifest_content_encoding": "gzip",
  "manifest_object_sha256": "<digest of compressed object bytes>",
  "manifest_object_bytes": 1
}
```

The placeholder byte counts above are illustrative only. Use the builder’s
output. The ordinary SHA-256 of the final decoded `site-manifest.json` is
intentionally different from `manifest_sha256`.

## Publication transaction and HTTP metadata

Publish in this order:

1. Build all candidate documents locally.
2. Validate schemas, semantic invariants, media existence/size/SHA-256, and
   public-string safety.
3. Upload every new hash-addressed `media/v1/` and `repro/v1/` object.
4. Download-verify the uploaded objects for the first publication.
5. Upload the immutable compressed manifest snapshot.
6. Download it and verify `manifest_object_sha256`.
7. Verify its HTTP metadata.
8. Recheck that the existing pointer did not change during the transaction.
9. Upload `manifests/latest.json` **last**.
10. Download-compare the pointer and test the public URLs with the website
    origin.

Use these headers:

| Object | `Content-Type` | `Content-Encoding` | `Cache-Control` |
| --- | --- | --- | --- |
| Hashed manifest snapshot | `application/json; charset=utf-8` | `gzip` | `public, max-age=31536000, immutable` |
| Hashed WebP/PNG | `image/webp` / `image/png` | none | `public, max-age=31536000, immutable` |
| Hashed MP4 | `video/mp4` | none | `public, max-age=31536000, immutable` |
| Hashed NPY | `application/octet-stream` | none | `public, max-age=31536000, immutable` |
| Hashed JSON data | `application/json; charset=utf-8` | none | `public, max-age=31536000, immutable` |
| `manifests/latest.json` | `application/json; charset=utf-8` | none | `no-cache, max-age=0, must-revalidate` |
| Review/refinement mutable JSON | `application/json; charset=utf-8` | none | `no-cache, max-age=0, must-revalidate` |

Cloudflare’s S3-compatible upload API supports HTTP metadata including
`Content-Type`, `Content-Encoding`, and `Cache-Control`. The supplied publisher
sets and verifies critical manifest/pointer metadata, but currently relies on
file-extension inference for ordinary media. HEAD-check one object of every
published type after the first upload.

Official references:

- [Cloudflare R2 object uploads](https://developers.cloudflare.com/r2/objects/upload-objects/)
- [Cloudflare R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [Cloudflare R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/)
- [Cloudflare R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)

The current `r2.dev` endpoint is appropriate for this private proof of concept
but is rate-limited and described by Cloudflare as a development endpoint. A
future custom domain or Hugging Face host can preserve the same key layout.

## Review overlay

Recommended R2 key:

```text
overlays/review-overlay.json
```

An empty, valid document is:

```json
{
  "schema_version": 1,
  "dataset_id": "product-lenia-mlocal-mcross-alpha-v1",
  "asset_base_url": "https://pub-f0e4d19efe3248388e36842e1c75963a.r2.dev",
  "reviews": []
}
```

A complete populated document has this shape. Placeholder hashes and the
status must be replaced with real data and Winston’s actual review; this is
not a scientific label for `triple_00503`:

```json
{
  "schema_version": 1,
  "dataset_id": "product-lenia-mlocal-mcross-alpha-v1",
  "asset_base_url": "https://pub-f0e4d19efe3248388e36842e1c75963a.r2.dev",
  "reviews": [
    {
      "point_id": "triple_00503",
      "status": "self_replicator",
      "reviewed_at": "2026-07-27T00:00:00Z",
      "notes": "Optional short public-safe note",
      "media": {
        "video": {
          "key": "media/v1/triple_00503/top_1/<video-sha256>.mp4",
          "sha256": "<video-sha256>",
          "bytes": 1234567,
          "width": 800,
          "height": 800,
          "frames": 1001,
          "fps": 30,
          "scored_updates": 800,
          "replay_updates": 1000
        },
        "initial_field": {
          "key": "repro/v1/triple_00503/top_1/<field-sha256>.npy",
          "sha256": "<field-sha256>",
          "bytes": 123456,
          "format": "npy",
          "width": 256,
          "height": 256,
          "value_min": 0,
          "value_max": 1
        }
      }
    }
  ]
}
```

Every placeholder hash and numeric byte count in the example is illustrative.
Measure the actual object.

Review rules:

- `status` is exactly `self_replicator` or `nonreplicator`.
- Only base points classified `dynamics_unresolved` may be reviewed.
- Each `point_id` may appear at most once.
- A review record permits exactly `point_id`, `status`, and optional
  `reviewed_at`, `notes`, and `media`. Do not add a CLIP score, loss,
  candidate-of-interest flag, evidence object, or any other property; the
  schema rejects extras.
- A `self_replicator` review makes the whole coarse triple green.
- A coarse `nonreplicator` review remains blue in the full cube. Light blue is
  reserved for explicitly tested negative cells in a fine neighborhood.
- A review may carry poster, video, parameters, and initial-field
  descriptors. Poster, video, and initial field participate in the current
  detail-panel resolution; parameters are retained for future reproducibility
  UI.
- Setting a media property explicitly to `null` suppresses lower-priority
  inherited media; omitting it allows inheritance.
- `dataset_id` must match the base manifest.
- Optional `based_on_manifest_sha256` pins the overlay to one exact snapshot.
  During active checkpoint publication, omit it unless the overlay is rebuilt
  every time the manifest digest changes; a stale pin makes the entire overlay
  fail closed.
- For live R2 auxiliary documents, explicitly set `asset_base_url` to the
  public R2 base. Although omission inherits the active manifest base, an
  unpinned overlay can also be loaded while the site is using its bundled
  fallback manifest; an explicit base keeps R2 media resolvable in that case.
- An explicit asset base must be an absolute HTTPS directory URL without a
  query or fragment.
- One invalid review, unsafe string, stale manifest pin, or bad media
  descriptor invalidates the whole overlay. The website then uses an empty
  review set and displays a warning; it does not retain the other records.

Upload every referenced asset before replacing the mutable overlay document.

## Refinement catalog

Recommended R2 key:

```text
refinements/refinement-catalog.json
```

An empty, valid document is:

```json
{
  "schema_version": 1,
  "dataset_id": "product-lenia-mlocal-mcross-alpha-v1",
  "asset_base_url": "https://pub-f0e4d19efe3248388e36842e1c75963a.r2.dev",
  "neighborhoods": []
}
```

A complete one-neighborhood document has this shape:

```json
{
  "schema_version": 1,
  "dataset_id": "product-lenia-mlocal-mcross-alpha-v1",
  "asset_base_url": "https://pub-f0e4d19efe3248388e36842e1c75963a.r2.dev",
  "neighborhoods": [
    {
      "id": "triple_00503_local_v1",
      "center_point_id": "triple_00503",
      "replay_source_point_id": "triple_00503",
      "shared_media": {
        "initial_field": {
          "key": "repro/v1/triple_00503/top_1/<field-sha256>.npy",
          "sha256": "<field-sha256>",
          "bytes": 123456,
          "format": "npy",
          "width": 256,
          "height": 256,
          "value_min": 0,
          "value_max": 1
        }
      },
      "axes": {
        "m_local": [
          0.04263157933950424,
          0.05263157933950424,
          0.06263157933950424
        ],
        "m_cross": [
          1.8960892868041992,
          1.9260892868041992,
          1.9560892868041992
        ],
        "alpha": [
          0.14789473056793213,
          0.15789473056793213,
          0.16789473056793213
        ]
      },
      "samples": [
        {
          "grid_index": [1, 1, 1],
          "coordinates": {
            "m_local": 0.05263157933950424,
            "m_cross": 1.9260892868041992,
            "alpha": 0.15789473056793213
          },
          "status": "self_replicator"
        },
        {
          "grid_index": [2, 1, 1],
          "coordinates": {
            "m_local": 0.06263157933950424,
            "m_cross": 1.9260892868041992,
            "alpha": 0.15789473056793213
          },
          "status": "nonreplicator"
        }
      ]
    }
  ]
}
```

This example is structural only; do not publish its sample labels or numbers
as results.

Refinement rules:

- For live R2 data, explicitly set the catalog’s clean absolute HTTPS
  `asset_base_url` just as for the review overlay.
- The center coarse point must exist and, for the intended UI to activate,
  must have a manual `self_replicator` review.
- The optional replay source must be a known coarse point.
- Neighborhood IDs must be unique.
- A neighborhood permits exactly `id`, `center_point_id`, `axes`, `samples`,
  and optional `replay_source_point_id` and `shared_media`.
- Each of the three local axis arrays must contain finite, unique, strictly
  increasing values.
- Axis lengths and spacing are arbitrary. They may be finer or coarser than
  0.01 and may differ by axis.
- Fine `grid_index` refers to the neighborhood’s local arrays, in
  `[m_local, m_cross, alpha]` order.
- Sample coordinates must equal the values at those local indices exactly.
- A local grid index may appear at most once per neighborhood.
- A fine sample permits exactly `grid_index`, `coordinates`, `status`, and
  optional `media`. Fine samples cannot carry their own score, loss, notes,
  timestamp, ID, evidence, or candidate flag in schema version 1.
- Include only cells that were actually tested and manually labelled.
- Omit untested cells. Do not write them as `nonreplicator`.
- The white boundary is derived from direct face adjacency between an
  explicit positive and explicit negative. Do not publish an interpolated
  surface.
- Publish at most one neighborhood for each `center_point_id`. Duplicate
  centers are rejected by both the cluster preflight and the website.
- Prefer including the exact center coordinate as a positive sample, and make
  sure the center lies within all three local axis extents.
- If a closed white outline is desired, actually test and publish an explicit
  one-cell negative halo around the positive region. Missing cells cannot form
  a boundary.
- One invalid neighborhood/sample, unsafe string, stale manifest pin, or bad
  media descriptor invalidates the whole catalog. The website then uses an
  empty refinement set and displays a warning.
- Singleton local axes are valid, but a singleton fills that local dimension.
  Use multiple values when the data is intended to describe a bounded region.

The requirement that every nearby parameter replays the same selected field
is implemented by placing that 256 by 256 field in
`neighborhood.shared_media.initial_field`, or by setting
`replay_source_point_id` to a coarse point whose review carries the field. Do
not attach different per-sample initial fields unless that behavior is
deliberately changed later.

Current detail-media precedence is:

- video/poster: fine sample, neighborhood shared media, replay-source review,
  replay-source coarse media, selected-center review, selected-center coarse
  media;
- effective initial-field sources: neighborhood shared media, replay-source
  review, fine sample, selected-center review.

This makes the shared anchor field win for all cells while still allowing
sample-specific videos.

The implementation contains coarse-media lookup slots in that initial-field
chain, but they are inert in schema version 1 because base `PointMedia` cannot
carry `initial_field`.

The winning descriptor keeps the base URL of the document that supplied it:

- sample/shared media use the refinement catalog’s asset base;
- replay/center review media use the review overlay’s asset base;
- coarse point media use the manifest’s asset base.

An omitted or empty auxiliary base inherits the manifest base.

For a selected global alpha slice, the viewer first checks whether that coarse
alpha lies inside the refinement’s alpha-cell extent, then displays the
nearest local alpha plane. In that 2D view, white boundaries are drawn only
for in-plane \(m_\ell\)/\(m_c\) positive-negative neighbors.

Across both auxiliary documents, omitted media fields inherit from the next
source. An explicit `null` stops lookup and suppresses lower-priority media.
Normally omit an unavailable field rather than writing `null`.

Parameter-file descriptors are retained for reproducibility but are not
currently rendered as a download link in the detail panel.

Fine voxels are not overlaid throughout the ordinary full coarse cube. They
appear in a selected green point’s local zoom and, after selecting an
intersecting global alpha slice, as that slice’s nearest local-alpha
intersection.

Review and refinement loading fail independently. A non-2xx response,
CORS/network error, malformed JSON, invalid top-level asset base, or invalid
record replaces only that auxiliary document with an empty one and adds a
warning. It does not remove the valid base manifest or the other auxiliary
document. A later media-fetch failure does not invalidate a loaded JSON
document; the affected panel instead displays its unavailable fallback.

## CORS and public verification

The saved policy already contains the important pieces:

- production origin `https://winstonwwang.github.io`;
- development origins `http://localhost:5173` and
  `http://127.0.0.1:5173`;
- methods `GET` and `HEAD`;
- request headers including `Range` and `If-None-Match`;
- exposed response headers including range, length, type, encoding, cache, and
  ETag metadata.

CORS is a browser read policy, not authentication. The `r2.dev` bucket is
publicly readable. Upload credentials remain cluster-only.

Cloudflare returns CORS headers only when the request includes a valid
`Origin` header. After publication:

```bash
BASE=https://pub-f0e4d19efe3248388e36842e1c75963a.r2.dev
ORIGIN=https://winstonwwang.github.io
PUBLISHER_PYTHON="${PYTHON_BIN:-python3}"
VERIFY_DIR="$(mktemp -d /tmp/lenia-r2-public-verify.XXXXXX)"
trap 'rm -rf -- "$VERIFY_DIR"' EXIT
LATEST="$VERIFY_DIR/latest.json"
SNAPSHOT="$VERIFY_DIR/site-manifest.json.gz"
HEADERS="$VERIFY_DIR/manifest.headers"

curl -fsS -D - -o "$LATEST" \
  -H "Origin: $ORIGIN" \
  "$BASE/manifests/latest.json"
```

Confirm:

```text
HTTP 200
Access-Control-Allow-Origin: https://winstonwwang.github.io
Content-Type: application/json
Cache-Control: no-cache, max-age=0, must-revalidate
```

Extract and verify the immutable manifest:

```bash
MANIFEST_KEY="$(
  "$PUBLISHER_PYTHON" -c \
    'import json,sys; print(json.load(open(sys.argv[1]))["manifest_key"])' \
    "$LATEST"
)"

curl -fsS -D "$HEADERS" \
  -o "$SNAPSHOT" \
  -H "Origin: $ORIGIN" \
  "$BASE/$MANIFEST_KEY"

"$PUBLISHER_PYTHON" - "$LATEST" "$SNAPSHOT" <<'PY'
import gzip
import hashlib
import json
import sys

pointer_path, snapshot_path = sys.argv[1:]
pointer = json.load(open(pointer_path, encoding="utf-8"))
raw = open(snapshot_path, "rb").read()
assert len(raw) == pointer["manifest_object_bytes"]
assert hashlib.sha256(raw).hexdigest() == pointer["manifest_object_sha256"]
decoded = gzip.decompress(raw)
assert len(decoded) == pointer["manifest_bytes"]
manifest = json.loads(decoded)
claimed = manifest["manifest_sha256"]
assert claimed == pointer["manifest_sha256"]
digest_payload = dict(manifest)
del digest_payload["manifest_sha256"]
canonical_payload = json.dumps(
    digest_payload,
    sort_keys=True,
    separators=(",", ":"),
    ensure_ascii=True,
    allow_nan=False,
).encode("utf-8")
assert hashlib.sha256(canonical_payload).hexdigest() == claimed
canonical_final = json.dumps(
    manifest,
    sort_keys=True,
    separators=(",", ":"),
    ensure_ascii=True,
    allow_nan=False,
).encode("utf-8") + b"\n"
assert decoded == canonical_final
assert pointer["manifest_key"] == f"manifests/snapshots/{claimed}.json"
assert manifest["asset_base_url"] == (
    "https://pub-f0e4d19efe3248388e36842e1c75963a.r2.dev"
)
print(pointer["manifest_key"], "verified")
PY
```

Also verify representative assets:

```bash
curl -fsSI -H "Origin: $ORIGIN" "$BASE/<poster-key>"
curl -fsSI -H "Origin: $ORIGIN" "$BASE/<field-key>"
curl -fsS -D - -o /dev/null \
  -H "Origin: $ORIGIN" \
  -H "Range: bytes=0-1023" \
  "$BASE/<video-key>"
```

For the MP4, verify the correct `video/mp4` type, byte-range behavior, seeking,
and that no browser request contains credentials.

Finally open the website and confirm:

1. the data badge reads `Live snapshot`, not `Bundled snapshot`;
2. no data warning reports a pointer, schema, byte-count, digest, or CORS
   failure;
3. the cube still has exactly 8,000 points and the fixed class counts;
4. a completed unresolved point displays the CLIP score and its 300/900-second
   search context without becoming green;
5. a published poster/video opens and an MP4 can pause and seek;
6. once R2 auxiliary URLs are configured, only Winston-reviewed points turn
   green;
7. a numeric initial field displays as a 256 by 256 heatmap;
8. a refinement neighborhood renders only explicit positive/negative samples.

## Never publish

Do not put any of the following in R2 public objects or GitHub:

- R2 access key IDs or secret access keys;
- populated credential files;
- raw cluster paths such as `/n/home`, `/n/holylabs`, or `/n/netscratch`;
- local Windows paths;
- private usernames or home-directory structure;
- optimizer state or checkpoints;
- arbitrary logs, tracebacks, or environment dumps;
- unredacted job metadata;
- raw candidate labels that Winston has not manually approved;
- the 20360640 smoke MP4 as evidence for any cube point.

The 20360640 fixture is a transport/browser test only and is not associated
with any of the 8,000 parameter triples.

## Publication report to return

After the upload, send the website agent this compact report:

```text
Publication time:
Pointer URL:
Manifest key:
Semantic manifest SHA-256:
Compressed-object SHA-256 and bytes:
Decoded manifest bytes:
asset_base_url:

Point counts:
ASAL completed / not started:
300 s / 900 s completed:
Posters / videos / parameter objects:

Review overlay URL (or "not published"):
Review count:
Refinement catalog URL (or "not published"):
Neighborhood/sample counts:
Featured catalog URL (or "not published"):
Featured centers / off-grid centers / neighborhoods / samples:
Featured self-replicator / nonreplicator sample counts:
Staged featured preflight result:
Public featured preflight result:
Trusted featured FFmpeg decode result:

Representative poster URL + HTTP Content-Type:
Representative video URL + HTTP Content-Type/range result:
Representative field URL + HTTP Content-Type:
Representative featured-center video URL + HTTP Content-Type/range result:
Representative featured-center field URL + HTTP Content-Type:
CORS Access-Control-Allow-Origin result:
Full remote verification result:
featured_catalog_url activation/deployment result:
```

Do not include credentials in that report.

## Go/no-go checklist

- [ ] Public base is exactly the current R2 HTTPS URL.
- [ ] Bucket name is `lenia-self-replication-data`.
- [ ] Credentials are bucket-scoped, cluster-only, and loaded from a mode-600
      file.
- [ ] `R2_PUBLIC_BASE_URL` is set during dry-run and real publication.
- [ ] Every referenced asset is staged at `data/public/<key>`.
- [ ] The transport-only `data/public/smoke/` fixture is absent from the
      production publication.
- [ ] Dead and cutoff-excluded points have no coarse poster, video, or
      parameter asset.
- [ ] Every asset byte count and SHA-256 matches the staged bytes.
- [ ] Hash-addressed filenames are used.
- [ ] MP4s are browser-compatible and seekable.
- [ ] Initial fields are exactly 256 by 256 and use a supported encoding.
- [ ] Any WebP initial field was independently opened by a trusted image
      decoder; otherwise NPY, JSON, or PNG is used.
- [ ] The transfer package’s base-validator parity corrections in this
      handoff are applied.
- [ ] The publisher includes and verifies `repro/`, or no descriptor uses that
      prefix yet.
- [ ] The strict manifest/pointer validator passes.
- [ ] The auxiliary preflight passes before any review/refinement publication.
- [ ] The staged featured preflight passes with
      `--expect-prepared-first-publication`.
- [ ] Featured counts are exactly 5 centers, 3 off-grid centers, 5
      neighborhoods, 2,905 samples, 145 self-replicators, and 2,760
      nonreplicators.
- [ ] Every featured center has verified video, poster, parameter, and
      256-by-256 initial-field assets; every varied sample explicitly sets
      `media.video: null`.
- [ ] The public featured preflight passes against the same asset base the
      browser will use.
- [ ] FFmpeg fully decodes every featured poster, video, and image-encoded
      initial field without decoder errors.
- [ ] `featured_catalog_url` remains absent from production until the featured
      catalog and every asset are public, CORS-readable, and pass the complete
      gate; only then is the URL activated and the viewer redeployed.
- [ ] The live manifest has a nonempty R2 `asset_base_url`.
- [ ] All immutable media is uploaded before the manifest.
- [ ] The immutable manifest is uploaded and remotely hash-verified.
- [ ] `manifests/latest.json` is uploaded last.
- [ ] Pointer/snapshot/media HTTP metadata is correct.
- [ ] A request with the GitHub Pages `Origin` receives the expected CORS
      header.
- [ ] The deployed viewer reports `Live snapshot`.
- [ ] No search result was automatically labelled as a self-replicator.
- [ ] No private path, secret, raw log, or unapproved manual label is public.
