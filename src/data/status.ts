import type {
  DisplayStatus,
  FeaturedCatalog,
  PointReview,
  RefinementCatalog,
  RefinementNeighborhood,
  ReviewOverlay,
  SitePoint,
} from "./types";
import { findFeaturedPointForCoarsePoint } from "./featured";

function isReviewOverlay(
  value: PointReview | ReviewOverlay,
): value is ReviewOverlay {
  return "reviews" in value;
}

export function findPointReview(
  overlay: ReviewOverlay | null | undefined,
  pointId: string,
): PointReview | undefined {
  return overlay?.reviews.find((review) => review.point_id === pointId);
}

export function deriveDisplayStatus(
  point: SitePoint,
  reviewOrOverlay?: PointReview | ReviewOverlay | null,
  featuredCatalog?: FeaturedCatalog | null,
): DisplayStatus {
  if (point.classification === "excluded_by_m_local_cutoff") {
    return "physically_uninteresting";
  }
  if (point.classification === "experimentally_dead") {
    return "experimentally_dead";
  }

  if (findFeaturedPointForCoarsePoint(featuredCatalog, point.id)) {
    return "self_replicator";
  }

  const review =
    reviewOrOverlay === null || reviewOrOverlay === undefined
      ? undefined
      : isReviewOverlay(reviewOrOverlay)
        ? findPointReview(reviewOrOverlay, point.id)
        : reviewOrOverlay.point_id === point.id
          ? reviewOrOverlay
          : undefined;

  return review?.status === "self_replicator"
    ? "self_replicator"
    : "unresolved";
}

export function findRefinementNeighborhood(
  catalog: RefinementCatalog | null | undefined,
  centerPointId: string,
): RefinementNeighborhood | undefined {
  return catalog?.neighborhoods.find(
    (neighborhood) => neighborhood.center_point_id === centerPointId,
  );
}
