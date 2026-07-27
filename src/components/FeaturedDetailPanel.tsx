import type {
  FeaturedNeighborhood,
  FeaturedPoint,
  FeaturedSample,
  InitialFieldAsset,
  OverlayMedia,
  PosterAsset,
  VideoAsset,
} from "../data";
import { resolveAssetUrl } from "../data";
import { InitialFieldPanel } from "./InitialFieldPanel";
import { VideoPanel } from "./VideoPanel";

type AssetBaseUrl = string | URL;
type MediaField = "poster" | "video" | "initial_field";

interface MediaSource {
  media?: OverlayMedia | null;
  assetBaseUrl: AssetBaseUrl;
}

interface SourcedAsset<T> {
  asset: T;
  assetBaseUrl: AssetBaseUrl;
}

export interface FeaturedDetailPanelProps {
  point: FeaturedPoint;
  assetBaseUrl: AssetBaseUrl;
  neighborhood?: FeaturedNeighborhood | null;
  selectedSample?: FeaturedSample | null;
}

function pickAsset<T extends PosterAsset | VideoAsset | InitialFieldAsset>(
  field: MediaField,
  sources: MediaSource[],
): SourcedAsset<T> | null {
  for (const source of sources) {
    if (
      !source.media ||
      !Object.prototype.hasOwnProperty.call(source.media, field)
    ) {
      continue;
    }

    const asset = source.media[field];
    return asset
      ? { asset: asset as T, assetBaseUrl: source.assetBaseUrl }
      : null;
  }
  return null;
}

function safeAssetUrl(
  source: SourcedAsset<PosterAsset | VideoAsset | InitialFieldAsset> | null,
): string | null {
  if (!source) return null;
  try {
    return resolveAssetUrl(source.asset.key, source.assetBaseUrl);
  } catch {
    return null;
  }
}

function exactParameter(value: number): string {
  // Number#toString returns the shortest decimal that round-trips to the
  // exact IEEE-754 value loaded from the catalog. Fixed decimal formatting
  // would hide the applied/source-coordinate differences documented there.
  return value.toString();
}

function coordinatesDiffer(
  applied: FeaturedPoint["coordinates"],
  reported: FeaturedPoint["source_reported_coordinates"],
): boolean {
  return (
    applied.m_local !== reported.m_local ||
    applied.m_cross !== reported.m_cross ||
    applied.alpha !== reported.alpha
  );
}

function displayStatus(
  point: FeaturedPoint,
  sample?: FeaturedSample | null,
): { label: string; className: string } {
  const status = sample?.status ?? point.status;
  if (status === "self_replicator") {
    return {
      label: sample ? "Self-replicator" : "Confirmed self-replicator",
      className: "self-replicator",
    };
  }
  return {
    label: "Reviewed non-replicator",
    className: "nonreplicator",
  };
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "Not available";
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "Not available";
  }
}

function scoreValue(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(6)
    : "Not available";
}

function Coordinates({
  coordinates,
}: {
  coordinates: FeaturedPoint["coordinates"];
}) {
  return (
    <dl className="detail-panel__triple">
      <div>
        <dt>
          m<sub>ℓ</sub>
        </dt>
        <dd>{exactParameter(coordinates.m_local)}</dd>
      </div>
      <div>
        <dt>
          m<sub>c</sub>
        </dt>
        <dd>{exactParameter(coordinates.m_cross)}</dd>
      </div>
      <div>
        <dt>α</dt>
        <dd>{exactParameter(coordinates.alpha)}</dd>
      </div>
    </dl>
  );
}

export function FeaturedDetailPanel({
  point,
  assetBaseUrl,
  neighborhood,
  selectedSample,
}: FeaturedDetailPanelProps) {
  const sampleSource: MediaSource = {
    media: selectedSample?.media,
    assetBaseUrl,
  };
  const sharedSource: MediaSource = {
    media: neighborhood?.shared_media,
    assetBaseUrl,
  };
  const centerSource: MediaSource = {
    media: point.media,
    assetBaseUrl,
  };
  const mediaSources = [sampleSource, sharedSource, centerSource];

  const videoSource = pickAsset<VideoAsset>("video", mediaSources);
  const posterSource = pickAsset<PosterAsset>("poster", mediaSources);
  const fieldSource = pickAsset<InitialFieldAsset>(
    "initial_field",
    mediaSources,
  );
  const videoUrl = safeAssetUrl(videoSource);
  const posterUrl = safeAssetUrl(posterSource);
  const fieldUrl = safeAssetUrl(fieldSource);

  const sampleExplicitlySuppressesVideo =
    Boolean(selectedSample?.media) &&
    Object.prototype.hasOwnProperty.call(selectedSample?.media, "video") &&
    selectedSample?.media?.video === null;
  const coordinates = selectedSample?.coordinates ?? point.coordinates;
  const status = displayStatus(point, selectedSample);
  const showSourceCoordinates =
    !selectedSample &&
    coordinatesDiffer(point.coordinates, point.source_reported_coordinates);
  const selectionKey = selectedSample
    ? `${point.id}:sample:${selectedSample.grid_index.join("-")}`
    : `${point.id}:center`;
  const isOffGrid = point.coarse_point_id === undefined;

  return (
    <aside
      className="detail-panel featured-detail-panel"
      aria-label={`Details for featured point ${point.display_label}`}
      data-featured-point-id={point.id}
    >
      <VideoPanel
        asset={videoSource?.asset}
        src={videoUrl}
        posterSrc={sampleExplicitlySuppressesVideo ? null : posterUrl}
        posterAlt={`Static search report for ${point.display_label}`}
        selectionKey={selectionKey}
        placeholderTitle={
          sampleExplicitlySuppressesVideo
            ? "Variation replay unavailable"
            : "Replay unavailable"
        }
        placeholderMessage={
          sampleExplicitlySuppressesVideo
            ? "No individual variation replay was generated"
            : "A dynamics replay has not been published for this featured point."
        }
      />

      <section
        className="detail-panel__metadata"
        aria-labelledby="featured-point-details-heading"
      >
        <div className="detail-panel__title-row">
          <div>
            <p className="detail-panel__eyebrow">
              {isOffGrid ? "Featured off-grid" : "Featured catalog point"}
            </p>
            <h2 id="featured-point-details-heading">{point.display_label}</h2>
          </div>
          <span
            className={`detail-panel__status detail-panel__status--${status.className}`}
          >
            {status.label}
          </span>
        </div>

        <div className="detail-panel__search-context featured-detail-panel__identity">
          <h4>Featured record</h4>
          <dl>
            <div>
              <dt>Internal ID</dt>
              <dd>
                <code>{point.id}</code>
              </dd>
            </div>
            <div>
              <dt>Namespace</dt>
              <dd>
                <code>{point.namespace}</code>
              </dd>
            </div>
            <div>
              <dt>Reviewed at</dt>
              <dd>{point.reviewed_at}</dd>
            </div>
          </dl>
        </div>

        {selectedSample?.variation_label ? (
          <div className="detail-panel__review-note">
            <h4>Selected variation</h4>
            <p>{selectedSample.variation_label}</p>
          </div>
        ) : null}

        <div className="featured-detail-panel__coordinates">
          <h4>
            {selectedSample
              ? "Exact applied variation coordinates"
              : "Exact applied coordinates"}
          </h4>
          <Coordinates coordinates={coordinates} />
          {!selectedSample ? (
            <p className="detail-panel__score-warning">
              {textValue(point.coordinate_semantics)}
            </p>
          ) : null}
        </div>

        {showSourceCoordinates ? (
          <div className="featured-detail-panel__coordinates">
            <h4>Source-reported center coordinates</h4>
            <Coordinates coordinates={point.source_reported_coordinates} />
          </div>
        ) : null}

        <div className="detail-panel__search-context">
          <h4>Featured search result</h4>
          <dl>
            <div>
              <dt>CLIP score</dt>
              <dd>
                {scoreValue(point.search_result?.best_clip_score_prompt)}
              </dd>
            </div>
            <div>
              <dt>Combined loss</dt>
              <dd>{scoreValue(point.search_result?.best_loss)}</dd>
            </div>
            <div>
              <dt>Prompt loss</dt>
              <dd>{scoreValue(point.search_result?.best_loss_prompt)}</dd>
            </div>
            <div>
              <dt>Softmax loss</dt>
              <dd>{scoreValue(point.search_result?.best_loss_softmax)}</dd>
            </div>
          </dl>
          {selectedSample ? (
            <p>
              These values belong to the featured center, not this local
              variation.
            </p>
          ) : null}
        </div>

        <div className="detail-panel__review-note">
          <h4>Score warning</h4>
          <p>{textValue(point.score_warning)}</p>
        </div>

        <div className="detail-panel__review-note">
          <h4>Provenance</h4>
          <p>{textValue(point.search_result?.provenance)}</p>
        </div>

        {point.world_size_comparison_note ? (
          <div className="detail-panel__review-note">
            <h4>World-size comparison</h4>
            <p>{point.world_size_comparison_note}</p>
            <dl className="featured-detail-panel__world-sizes">
              <div>
                <dt>Center video world</dt>
                <dd>
                  {point.center_video_world_pixels == null
                    ? "Not available"
                    : `${point.center_video_world_pixels} pixels`}
                </dd>
              </div>
              <div>
                <dt>Variation simulation world</dt>
                <dd>
                  {point.refinement_simulation_world_pixels == null
                    ? "Not available"
                    : `${point.refinement_simulation_world_pixels} pixels`}
                </dd>
              </div>
            </dl>
          </div>
        ) : null}

        {posterSource && posterUrl ? (
          <details className="detail-panel__poster">
            <summary>Search report image</summary>
            <figure>
              <img
                src={posterUrl}
                width={posterSource.asset.width}
                height={posterSource.asset.height}
                loading="lazy"
                decoding="async"
                alt={`Static search report for ${point.display_label}`}
              />
              <figcaption>Static search report — not a video replay.</figcaption>
            </figure>
          </details>
        ) : null}
      </section>

      <InitialFieldPanel
        asset={fieldSource?.asset}
        src={fieldUrl}
        unavailableMessage={
          selectedSample
            ? "No initial field was published for this featured variation."
            : "The featured center's 256 × 256 initial field was not published."
        }
      />
    </aside>
  );
}
