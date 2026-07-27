import { useEffect, useMemo, useRef } from "react";

import {
  deriveDisplayStatus,
  type DisplayStatus,
  type PointReview,
  type ReviewOverlay,
  type SiteManifest,
} from "../data";

export interface SliceThumbnailProps {
  manifest: SiteManifest;
  reviewOverlay: ReviewOverlay;
  alphaIndex: number;
  visibleStatuses?: ReadonlySet<DisplayStatus>;
}

export const THUMBNAIL_STATUS_COLORS: Readonly<Record<DisplayStatus, string>> = {
  physically_uninteresting: "#1d1f20",
  experimentally_dead: "#000000",
  unresolved: "#62a7f5",
  self_replicator: "#46d369",
};

const CANVAS_SIZE = 80;

export function SliceThumbnail({
  manifest,
  reviewOverlay,
  alphaIndex,
  visibleStatuses,
}: SliceThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const alpha = manifest.axes.alpha.values[alphaIndex];
  const slicePoints = useMemo(
    () =>
      manifest.points.filter(
        (point) => point.grid_index[2] === alphaIndex,
      ),
    [alphaIndex, manifest.points],
  );
  const reviewsByPointId = useMemo(
    () =>
      new Map<string, PointReview>(
        reviewOverlay.reviews.map((review) => [review.point_id, review]),
      ),
    [reviewOverlay.reviews],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }

    const mLocalCount = manifest.axes.m_local.count;
    const mCrossCount = manifest.axes.m_cross.count;
    const cellWidth = canvas.width / mLocalCount;
    const cellHeight = canvas.height / mCrossCount;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#25272a";
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (const point of slicePoints) {
      const review = reviewsByPointId.get(point.id);
      const status = deriveDisplayStatus(point, review);
      if (visibleStatuses && !visibleStatuses.has(status)) continue;

      context.fillStyle = THUMBNAIL_STATUS_COLORS[status];
      context.fillRect(
        point.grid_index[0] * cellWidth,
        (mCrossCount - 1 - point.grid_index[1]) * cellHeight,
        Math.ceil(cellWidth),
        Math.ceil(cellHeight),
      );
    }
  }, [
    manifest.axes.m_cross.count,
    manifest.axes.m_local.count,
    reviewsByPointId,
    slicePoints,
    visibleStatuses,
  ]);

  return (
    <canvas
      ref={canvasRef}
      className="slice-thumbnail"
      width={CANVAS_SIZE}
      height={CANVAS_SIZE}
      role="img"
      aria-label={`Status map for alpha ${alpha?.toFixed(3) ?? alphaIndex}`}
    >
      Status map for alpha {alpha?.toFixed(3) ?? alphaIndex}
    </canvas>
  );
}
