import type {
  FeaturedSample,
  InitialFieldAsset,
  OverlayMedia,
  PointReview,
  PosterAsset,
  RefinementSample,
  ScoreSemantics,
  SitePoint,
  VideoAsset,
} from "../data";
import { resolveAssetUrl } from "../data";
import { InitialFieldPanel } from "./InitialFieldPanel";
import { VideoPanel } from "./VideoPanel";

type AssetBaseUrl = string | URL;

interface MediaLike {
  poster?: PosterAsset | null;
  video?: VideoAsset | null;
  initial_field?: InitialFieldAsset | null;
}

interface MediaSource {
  media?: MediaLike | null;
  assetBaseUrl: AssetBaseUrl;
}

interface SourcedAsset<T> {
  asset: T;
  assetBaseUrl: AssetBaseUrl;
}

export interface DetailPanelProps {
  point: SitePoint;
  assetBaseUrl: AssetBaseUrl;
  review?: PointReview | null;
  reviewAssetBaseUrl?: AssetBaseUrl;
  refinementSample?: RefinementSample | FeaturedSample | null;
  refinementSharedMedia?: OverlayMedia | null;
  refinementReplayPoint?: SitePoint | null;
  refinementReplayReview?: PointReview | null;
  refinementAssetBaseUrl?: AssetBaseUrl;
  confirmedSelfReplicator?: boolean;
  confirmedMedia?: OverlayMedia | null;
  confirmedMediaAssetBaseUrl?: AssetBaseUrl;
  scoreSemantics: ScoreSemantics;
}

function pickAsset<T extends PosterAsset | VideoAsset | InitialFieldAsset>(
  field: "poster" | "video" | "initial_field",
  sources: MediaSource[],
): SourcedAsset<T> | null {
  for (const source of sources) {
    if (
      source.media &&
      Object.prototype.hasOwnProperty.call(source.media, field)
    ) {
      const asset = source.media[field];
      return asset
        ? { asset: asset as T, assetBaseUrl: source.assetBaseUrl }
        : null;
    }
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

function formatParameter(value: number): string {
  return value
    .toFixed(6)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

function displayStatus(
  point: SitePoint,
  review?: PointReview | null,
  refinementSample?: RefinementSample | FeaturedSample | null,
  confirmedSelfReplicator = false,
): string {
  const manualStatus =
    refinementSample?.status ??
    review?.status ??
    (confirmedSelfReplicator ? "self_replicator" : undefined);
  if (manualStatus === "self_replicator") return "Self-replicator";
  if (manualStatus === "nonreplicator") return "Reviewed non-replicator";

  switch (point.classification) {
    case "experimentally_dead":
      return "Experimentally dead";
    case "excluded_by_m_local_cutoff":
      return "Physically uninteresting";
    default:
      return "Unresolved";
  }
}

function displayStatusClass(
  point: SitePoint,
  review?: PointReview | null,
  refinementSample?: RefinementSample | FeaturedSample | null,
  confirmedSelfReplicator = false,
): string {
  const manualStatus =
    refinementSample?.status ??
    review?.status ??
    (confirmedSelfReplicator ? "self_replicator" : undefined);
  if (manualStatus) return manualStatus.replace("_", "-");
  return point.classification.replaceAll("_", "-");
}

function VideoEvidence({
  point,
  hasVideo,
}: {
  point: SitePoint;
  hasVideo: boolean;
}) {
  if (point.classification === "experimentally_dead") {
    const evidence =
      "voronoi" in point.evidence ? point.evidence : undefined;
    return (
      <div className="detail-panel__evidence">
        <h4>Experimental screen</h4>
        <p>All sampled fields reached exact vacuum:</p>
        <ul>
          <li>
            {evidence?.voronoi.confirmed_vacuum_count ?? 20} random Voronoi
            polygons
          </li>
          <li>
            {evidence?.gaussian_mixture.confirmed_vacuum_count ?? 20} random 2D
            Gaussians
          </li>
          <li>
            {evidence?.fourier_curve.confirmed_vacuum_count ?? 20} random
            Fourier curves
          </li>
        </ul>
      </div>
    );
  }

  if (point.classification === "excluded_by_m_local_cutoff") {
    return (
      <div className="detail-panel__evidence">
        <h4>Experimental screen</h4>
        <p>
          Excluded by the m<sub>ℓ</sub> cutoff and not tested with the 60-field
          ensemble.
        </p>
      </div>
    );
  }

  if (!hasVideo && point.asal.status === "not_started") {
    return (
      <div className="detail-panel__evidence">
        <h4>Availability</h4>
        <p>ASAL search and video replay are unavailable at this checkpoint.</p>
      </div>
    );
  }

  if (!hasVideo && point.asal.status === "completed") {
    return (
      <div className="detail-panel__evidence">
        <h4>Availability</h4>
        <p>The search completed, but a video replay was not published.</p>
      </div>
    );
  }

  return null;
}

function videoPlaceholder(
  point: SitePoint,
  review?: PointReview | null,
  refinementSample?: RefinementSample | FeaturedSample | null,
  confirmedSelfReplicator = false,
): { title: string; message: string } {
  const manualStatus =
    refinementSample?.status ??
    review?.status ??
    (confirmedSelfReplicator ? "self_replicator" : undefined);
  if (point.classification === "experimentally_dead") {
    return {
      title: "Experimentally dead",
      message: "No dynamics video is published for experimentally dead points.",
    };
  }
  if (point.classification === "excluded_by_m_local_cutoff") {
    return {
      title: "Physically uninteresting",
      message: "This cutoff point was excluded and not tested.",
    };
  }
  if (point.asal.status === "not_started") {
    return {
      title: "Replay/search unavailable",
      message: "The ASAL search has not been run for this point.",
    };
  }
  if (manualStatus === "self_replicator") {
    return {
      title: "Replay unavailable",
      message: "A video replay has not been published for this self-replicator.",
    };
  }
  return {
    title: "Replay unavailable",
    message: "A video replay was not published with this checkpoint.",
  };
}

function initialFieldPlaceholder(
  point: SitePoint,
  review?: PointReview | null,
  refinementSample?: RefinementSample | FeaturedSample | null,
  confirmedSelfReplicator = false,
): string {
  if (point.classification === "excluded_by_m_local_cutoff") {
    return "This point was not tested, so no initial field is available.";
  }
  if (point.classification === "experimentally_dead") {
    return "Tested over 20 random Voronoi polygons, 20 random 2D Gaussians, and 20 random Fourier curves. No single 256 × 256 initial field is retained.";
  }
  if (point.asal.status === "not_started") {
    return "The search has not been run, so no selected initial field is available.";
  }
  if (
    (refinementSample?.status ??
      review?.status ??
      (confirmedSelfReplicator
        ? "self_replicator"
        : undefined)) === "self_replicator"
  ) {
    return "The self-replicator's 256 × 256 initial field has not been published.";
  }
  return "The selected 256 × 256 initial field was not published with this checkpoint.";
}

export function DetailPanel({
  point,
  assetBaseUrl,
  review,
  reviewAssetBaseUrl = assetBaseUrl,
  refinementSample,
  refinementSharedMedia,
  refinementReplayPoint,
  refinementReplayReview,
  refinementAssetBaseUrl = reviewAssetBaseUrl,
  confirmedSelfReplicator = false,
  confirmedMedia,
  confirmedMediaAssetBaseUrl = assetBaseUrl,
  scoreSemantics,
}: DetailPanelProps) {
  const sampleSource: MediaSource = {
    media: refinementSample?.media,
    assetBaseUrl: refinementAssetBaseUrl,
  };
  const sharedSource: MediaSource = {
    media: refinementSharedMedia,
    assetBaseUrl: refinementAssetBaseUrl,
  };
  const confirmedSource: MediaSource = {
    media: confirmedMedia,
    assetBaseUrl: confirmedMediaAssetBaseUrl,
  };
  const replayReviewSource: MediaSource = {
    media: refinementReplayReview?.media,
    assetBaseUrl: reviewAssetBaseUrl,
  };
  const replayPointSource: MediaSource = {
    media: refinementReplayPoint?.media,
    assetBaseUrl,
  };
  const reviewSource: MediaSource = {
    media: review?.media,
    assetBaseUrl: reviewAssetBaseUrl,
  };
  const pointSource: MediaSource = { media: point.media, assetBaseUrl };

  const replayMediaSources: MediaSource[] = [
    sampleSource,
    sharedSource,
    confirmedSource,
    replayReviewSource,
    replayPointSource,
    reviewSource,
    pointSource,
  ];
  const initialFieldSources: MediaSource[] = [
    sharedSource,
    confirmedSource,
    replayReviewSource,
    replayPointSource,
    {
      media: refinementSample?.media,
      assetBaseUrl: refinementAssetBaseUrl,
    },
    reviewSource,
    pointSource,
  ];

  const videoSource = pickAsset<VideoAsset>("video", replayMediaSources);
  const posterSource = pickAsset<PosterAsset>("poster", replayMediaSources);
  const fieldSource = pickAsset<InitialFieldAsset>(
    "initial_field",
    initialFieldSources,
  );
  const videoUrl = safeAssetUrl(videoSource);
  const posterUrl = safeAssetUrl(posterSource);
  const fieldUrl = safeAssetUrl(fieldSource);

  const coordinates = refinementSample?.coordinates ?? point.coordinates;
  const status = displayStatus(
    point,
    review,
    refinementSample,
    confirmedSelfReplicator,
  );
  const statusClass = displayStatusClass(
    point,
    review,
    refinementSample,
    confirmedSelfReplicator,
  );
  const clipScore =
    point.asal.status === "completed"
      ? point.asal.best_clip_score_prompt
      : null;
  const placeholder = videoPlaceholder(
    point,
    review,
    refinementSample,
    confirmedSelfReplicator,
  );

  return (
    <aside
      className="detail-panel"
      aria-label={`Details for ${point.id}`}
      data-point-id={point.id}
    >
      <VideoPanel
        asset={videoSource?.asset}
        src={videoUrl}
        posterSrc={
          point.classification === "dynamics_unresolved" ? posterUrl : null
        }
        posterAlt={`Static search report for ${point.id}`}
        selectionKey={`${point.id}:${refinementSample?.grid_index.join("-") ?? "coarse"}`}
        placeholderTitle={placeholder.title}
        placeholderMessage={placeholder.message}
      />

      <section
        className="detail-panel__metadata"
        aria-labelledby="point-details-heading"
      >
        <div className="detail-panel__title-row">
          <div>
            <p className="detail-panel__eyebrow">Selected parameter triple</p>
            <h2 id="point-details-heading">{point.id}</h2>
          </div>
          <span
            className={`detail-panel__status detail-panel__status--${statusClass}`}
          >
            {status}
          </span>
        </div>

        <dl className="detail-panel__triple">
          <div>
            <dt>
              m<sub>ℓ</sub>
            </dt>
            <dd>{formatParameter(coordinates.m_local)}</dd>
          </div>
          <div>
            <dt>
              m<sub>c</sub>
            </dt>
            <dd>{formatParameter(coordinates.m_cross)}</dd>
          </div>
          <div>
            <dt>α</dt>
            <dd>{formatParameter(coordinates.alpha)}</dd>
          </div>
        </dl>

        <dl className="detail-panel__score">
          <div>
            <dt>CLIP score</dt>
            <dd>
              {clipScore === null ? "Not available" : clipScore.toFixed(6)}
            </dd>
          </div>
        </dl>
        <p className="detail-panel__score-warning">
          {scoreSemantics.warning}. CLIP score is{" "}
          <code>{scoreSemantics.clip_score_prompt}</code>.
          {refinementSample && clipScore !== null
            ? " This score belongs to the coarse-grid center point."
            : ""}
        </p>

        {point.asal.status === "completed" ? (
          <div className="detail-panel__search-context">
            <h4>ASAL search context</h4>
            <dl>
              <div>
                <dt>Budget</dt>
                <dd>{point.asal.budget_seconds} s</dd>
              </div>
              <div>
                <dt>Elapsed</dt>
                <dd>{point.asal.elapsed_seconds.toFixed(1)} s</dd>
              </div>
              <div>
                <dt>Iterations</dt>
                <dd>{point.asal.iterations.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Simulations</dt>
                <dd>{point.asal.simulations.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Sequence index</dt>
                <dd>{point.asal.sequence_index}</dd>
              </div>
              <div>
                <dt>Sobol draw</dt>
                <dd>{point.asal.sobol_draw_index}</dd>
              </div>
              <div>
                <dt>Combined loss</dt>
                <dd>
                  {point.asal.best_loss.toFixed(6)} (
                  {scoreSemantics.combined_loss})
                </dd>
              </div>
              <div>
                <dt>Softmax loss</dt>
                <dd>{point.asal.best_loss_softmax.toFixed(6)}</dd>
              </div>
              <div>
                <dt>Report</dt>
                <dd>
                  {point.asal.report_available ? "Available" : "Unavailable"}
                </dd>
              </div>
            </dl>
            <p>{scoreSemantics.mixed_budget_warning}.</p>
          </div>
        ) : null}

        <VideoEvidence point={point} hasVideo={Boolean(videoUrl)} />

        {review?.notes ? (
          <div className="detail-panel__review-note">
            <h4>Review note</h4>
            <p>{review.notes}</p>
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
                alt={`Static search report for ${point.id}`}
              />
              <figcaption>Static search report — not a video replay.</figcaption>
            </figure>
          </details>
        ) : null}
      </section>

      <InitialFieldPanel
        asset={fieldSource?.asset}
        src={fieldUrl}
        unavailableMessage={initialFieldPlaceholder(
          point,
          review,
          refinementSample,
          confirmedSelfReplicator,
        )}
      />
    </aside>
  );
}
