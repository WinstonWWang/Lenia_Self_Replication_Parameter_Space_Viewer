import { useEffect, useMemo, useRef } from "react";

import {
  deriveDisplayStatus,
  type DisplayStatus,
  type FeaturedCatalog,
  type PointReview,
  type ReviewOverlay,
  type SiteManifest,
} from "../data";
import { makeFeaturedPointRenderData } from "../visualization/geometry";

export interface SliceThumbnailProps {
  manifest: SiteManifest;
  reviewOverlay: ReviewOverlay;
  alphaIndex: number;
  visibleStatuses?: ReadonlySet<DisplayStatus>;
  featuredCatalog?: FeaturedCatalog | null;
}

export const THUMBNAIL_STATUS_COLORS: Readonly<Record<DisplayStatus, string>> = {
  physically_uninteresting: "#1d1f20",
  experimentally_dead: "#000000",
  unresolved: "#62a7f5",
  self_replicator: "#46d369",
};

const CANVAS_SIZE = 80;
const POINT_RADIUS_RATIO = 0.32;

function drawPoint(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
): void {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
}

function exactAxisPosition(
  value: number,
  values: readonly number[],
  canvasLength: number,
): number {
  if (values.length < 2) return canvasLength / 2;
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? first;
  const cellSize = canvasLength / values.length;
  if (first === last) return canvasLength / 2;
  const normalized = Math.max(0, Math.min(1, (value - first) / (last - first)));
  return cellSize / 2 + normalized * (canvasLength - cellSize);
}

export function SliceThumbnail({
  manifest,
  reviewOverlay,
  alphaIndex,
  visibleStatuses,
  featuredCatalog,
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
  const featuredSlicePoints = useMemo(
    () =>
      makeFeaturedPointRenderData(manifest, featuredCatalog).filter(
        (datum) => datum.alphaIndex === alphaIndex,
      ),
    [alphaIndex, featuredCatalog, manifest],
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
    const pointRadius =
      Math.min(cellWidth, cellHeight) * POINT_RADIUS_RATIO;

    context.clearRect(0, 0, canvas.width, canvas.height);

    for (const point of slicePoints) {
      const review = reviewsByPointId.get(point.id);
      const status = deriveDisplayStatus(
        point,
        review,
        featuredCatalog,
      );
      if (visibleStatuses && !visibleStatuses.has(status)) continue;

      drawPoint(
        context,
        (point.grid_index[0] + 0.5) * cellWidth,
        (mCrossCount - point.grid_index[1] - 0.5) * cellHeight,
        status === "self_replicator"
          ? pointRadius * 1.8
          : pointRadius,
        THUMBNAIL_STATUS_COLORS[status],
      );
    }

    if (!visibleStatuses || visibleStatuses.has("self_replicator")) {
      for (const datum of featuredSlicePoints) {
        drawPoint(
          context,
          exactAxisPosition(
            datum.coordinates.m_local,
            manifest.axes.m_local.values,
            canvas.width,
          ),
          canvas.height -
            exactAxisPosition(
              datum.coordinates.m_cross,
              manifest.axes.m_cross.values,
              canvas.height,
            ),
          pointRadius * 1.8,
          THUMBNAIL_STATUS_COLORS.self_replicator,
        );
      }
    }
  }, [
    featuredSlicePoints,
    featuredCatalog,
    manifest.axes.m_cross.count,
    manifest.axes.m_cross.values,
    manifest.axes.m_local.count,
    manifest.axes.m_local.values,
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
