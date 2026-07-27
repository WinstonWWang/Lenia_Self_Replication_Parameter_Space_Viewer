import type {
  FeaturedCatalog,
  FeaturedPoint,
  FeaturedSample,
  ParameterCoordinates,
  PointReview,
  RefinementAxes,
  RefinementNeighborhood,
  RefinementSample,
  ReviewOverlay,
  SelectedParameterPoint,
  SiteManifest,
  SitePoint,
} from "../data";
import { deriveDisplayStatus } from "../data/status";

export type WorldPosition = [number, number, number];

export type DisplayStatus =
  | "physically_uninteresting"
  | "experimentally_dead"
  | "unresolved"
  | "self_replicator";

export const STATUS_COLORS: Record<DisplayStatus, string> = {
  physically_uninteresting: "#17191c",
  experimentally_dead: "#030405",
  unresolved: "#69adff",
  self_replicator: "#43d879",
};

export const REFINEMENT_NEGATIVE_COLOR = "#9acfff";
export const SELF_REPLICATOR_POINT_SCALE = 2.2;

export function pointScaleForStatus(status: DisplayStatus): number {
  return status === "self_replicator"
    ? SELF_REPLICATOR_POINT_SCALE
    : 1;
}

interface BasePointRenderDatum {
  id: string;
  coordinates: ParameterCoordinates;
  position: WorldPosition;
  alphaIndex: number;
  status: DisplayStatus;
  color: string;
}

export interface CoarsePointRenderDatum extends BasePointRenderDatum {
  kind: "coarse";
  point: SitePoint;
}

export interface FeaturedPointRenderDatum extends BasePointRenderDatum {
  kind: "featured";
  point: FeaturedPoint;
}

export type PointRenderDatum =
  | CoarsePointRenderDatum
  | FeaturedPointRenderDatum;

export type LocalSample = RefinementSample | FeaturedSample;

export interface LocalNeighborhood {
  id: string;
  axes: RefinementAxes;
  samples: LocalSample[];
}

export interface AxisCell {
  center: number;
  min: number;
  max: number;
  size: number;
}

export interface RefinementCell {
  sample: LocalSample;
  position: WorldPosition;
  scale: WorldPosition;
}

export interface RefinementWorldTransform {
  position: WorldPosition;
  scale: WorldPosition;
}

export function normalizeAxisValue(
  value: number,
  values: readonly number[],
): number {
  if (values.length < 2) return 0;
  const first = values[0];
  const last = values[values.length - 1];
  if (first === undefined || last === undefined || first === last) return 0;
  return -1 + (2 * (value - first)) / (last - first);
}

export function coordinatesToWorld(
  coordinates: ParameterCoordinates,
  axes: SiteManifest["axes"],
): WorldPosition {
  return [
    normalizeAxisValue(coordinates.m_local, axes.m_local.values),
    normalizeAxisValue(coordinates.m_cross, axes.m_cross.values),
    normalizeAxisValue(coordinates.alpha, axes.alpha.values),
  ];
}

export function makeReviewMap(
  reviewOverlay?: ReviewOverlay | null,
): ReadonlyMap<string, PointReview> {
  return new Map(
    (reviewOverlay?.reviews ?? []).map((review) => [review.point_id, review]),
  );
}

export function makePointRenderData(
  manifest: SiteManifest,
  reviewOverlay?: ReviewOverlay | null,
  featuredCatalog?: FeaturedCatalog | null,
): PointRenderDatum[] {
  const reviews = makeReviewMap(reviewOverlay);
  return manifest.points.map((point) => {
    const status = deriveDisplayStatus(
      point,
      reviews.get(point.id),
      featuredCatalog,
    ) as DisplayStatus;
    return {
      kind: "coarse",
      id: point.id,
      point,
      coordinates: point.coordinates,
      position: coordinatesToWorld(point.coordinates, manifest.axes),
      alphaIndex: point.grid_index[2],
      status,
      color: STATUS_COLORS[status],
    };
  });
}

export function makeFeaturedPointRenderData(
  manifest: SiteManifest,
  featuredCatalog?: FeaturedCatalog | null,
): FeaturedPointRenderDatum[] {
  return (featuredCatalog?.featured_points ?? [])
    .filter((point) => point.coarse_point_id === undefined)
    .map((point) => ({
      kind: "featured",
      id: point.id,
      point,
      coordinates: point.coordinates,
      position: coordinatesToWorld(point.coordinates, manifest.axes),
      alphaIndex: nearestAxisIndex(
        manifest.axes.alpha.values,
        point.coordinates.alpha,
      ),
      status: "self_replicator",
      color: STATUS_COLORS.self_replicator,
    }));
}

export function renderDatumSelection(
  datum: PointRenderDatum,
): SelectedParameterPoint {
  return { kind: datum.kind, id: datum.id };
}

export function splitPointDataByAlpha(
  data: readonly PointRenderDatum[],
  alphaIndex: number | null,
  includeOffSliceContext = true,
): {
  active: PointRenderDatum[];
  faded: PointRenderDatum[];
} {
  if (alphaIndex === null) {
    return { active: [...data], faded: [] };
  }

  const active: PointRenderDatum[] = [];
  const faded: PointRenderDatum[] = [];
  for (const datum of data) {
    if (datum.alphaIndex === alphaIndex) active.push(datum);
    else if (includeOffSliceContext) faded.push(datum);
  }
  return { active, faded };
}

export function nearestAxisIndex(
  values: readonly number[],
  target: number,
): number {
  if (values.length === 0) return -1;
  let bestIndex = 0;
  let bestDistance = Math.abs((values[0] ?? 0) - target);
  for (let index = 1; index < values.length; index += 1) {
    const distance = Math.abs((values[index] ?? 0) - target);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }
  return bestIndex;
}

function axisPhysicalExtent(
  values: readonly number[],
  fallbackValues: readonly number[],
): readonly [number, number] | null {
  if (values.length === 0) return null;
  if (values.length === 1) {
    const value = values[0] ?? 0;
    let fallbackStep = Number.POSITIVE_INFINITY;
    for (let index = 1; index < fallbackValues.length; index += 1) {
      const step = Math.abs(
        (fallbackValues[index] ?? 0) - (fallbackValues[index - 1] ?? 0),
      );
      if (step > 0) fallbackStep = Math.min(fallbackStep, step);
    }
    const halfWidth = Number.isFinite(fallbackStep)
      ? fallbackStep / 4
      : Math.max(Math.abs(value) * 0.01, 0.005);
    return [value - halfWidth, value + halfWidth];
  }
  const first = values[0] ?? 0;
  const second = values[1] ?? first;
  const lastIndex = values.length - 1;
  const last = values[lastIndex] ?? first;
  const penultimate = values[lastIndex - 1] ?? last;
  return [first - (second - first) / 2, last + (last - penultimate) / 2];
}

export function refinementContainsAlpha(
  neighborhood: LocalNeighborhood,
  alpha: number,
  fallbackAlphaValues: readonly number[],
): boolean {
  const extent = axisPhysicalExtent(
    neighborhood.axes.alpha,
    fallbackAlphaValues,
  );
  if (!extent) return false;
  const minimum = Math.min(extent[0], extent[1]);
  const maximum = Math.max(extent[0], extent[1]);
  const epsilon = Math.max(1, Math.abs(alpha)) * Number.EPSILON * 32;
  return alpha >= minimum - epsilon && alpha <= maximum + epsilon;
}

export function refinementAlphaIndexForSlab(
  neighborhood: LocalNeighborhood,
  globalAlphaValues: readonly number[],
  globalAlphaIndex: number,
  preferredAlpha?: number,
): number | null {
  if (
    globalAlphaIndex < 0 ||
    globalAlphaIndex >= globalAlphaValues.length
  ) {
    return null;
  }
  const candidates = neighborhood.axes.alpha
    .map((alpha, index) => ({ alpha, index }))
    .filter(
      ({ alpha }) =>
        nearestAxisIndex(globalAlphaValues, alpha) === globalAlphaIndex,
    );
  if (candidates.length === 0) return null;

  const target =
    preferredAlpha ?? globalAlphaValues[globalAlphaIndex] ?? 0;
  const first = candidates[0];
  if (!first) return null;
  let best = first;
  for (const candidate of candidates.slice(1)) {
    if (
      Math.abs(candidate.alpha - target) <
      Math.abs(best.alpha - target)
    ) {
      best = candidate;
    }
  }
  return best.index;
}

export function refinementToGlobalTransform(
  neighborhood: LocalNeighborhood,
  axes: SiteManifest["axes"],
  centerCoordinates?: ParameterCoordinates,
): RefinementWorldTransform {
  const refinements = [
    neighborhood.axes.m_local,
    neighborhood.axes.m_cross,
    neighborhood.axes.alpha,
  ] as const;
  const globals = [
    axes.m_local.values,
    axes.m_cross.values,
    axes.alpha.values,
  ] as const;
  const position: WorldPosition = [0, 0, 0];
  const scale: WorldPosition = [1, 1, 1];

  for (let axis = 0; axis < 3; axis += 1) {
    const extent = axisPhysicalExtent(refinements[axis], globals[axis]);
    if (!extent) continue;
    const start = normalizeAxisValue(extent[0], globals[axis]);
    const end = normalizeAxisValue(extent[1], globals[axis]);
    const centerValue = centerCoordinates
      ? [
          centerCoordinates.m_local,
          centerCoordinates.m_cross,
          centerCoordinates.alpha,
        ][axis]
      : undefined;
    scale[axis] = Math.max(Math.abs(end - start) / 2, 0.0001);
    if (centerValue === undefined) {
      position[axis] = (start + end) / 2;
    } else {
      const extentSpan = extent[1] - extent[0];
      const centerIndex = refinements[axis].findIndex(
        (value) => value === centerValue,
      );
      const localCenter =
        centerIndex >= 0
          ? (buildAxisCells(refinements[axis])[centerIndex]?.center ?? 0)
          : extentSpan === 0
            ? 0
            : -1 + (2 * (centerValue - extent[0])) / extentSpan;
      position[axis] =
        normalizeAxisValue(centerValue, globals[axis]) -
        localCenter * scale[axis];
    }
  }

  return { position, scale };
}

export function buildAxisCells(values: readonly number[]): AxisCell[] {
  if (values.length === 0) return [];
  if (values.length === 1) {
    return [{ center: 0, min: -1, max: 1, size: 2 }];
  }

  const physicalEdges = new Array<number>(values.length + 1);
  physicalEdges[0] = (values[0] ?? 0) - ((values[1] ?? 0) - (values[0] ?? 0)) / 2;
  for (let index = 1; index < values.length; index += 1) {
    physicalEdges[index] =
      ((values[index - 1] ?? 0) + (values[index] ?? 0)) / 2;
  }
  const last = values.length - 1;
  physicalEdges[values.length] =
    (values[last] ?? 0) +
    ((values[last] ?? 0) - (values[last - 1] ?? 0)) / 2;

  const start = physicalEdges[0] ?? 0;
  const end = physicalEdges[physicalEdges.length - 1] ?? 1;
  const toWorld = (value: number) =>
    start === end ? 0 : -1 + (2 * (value - start)) / (end - start);

  return values.map((_, index) => {
    const a = toWorld(physicalEdges[index] ?? start);
    const b = toWorld(physicalEdges[index + 1] ?? end);
    const min = Math.min(a, b);
    const max = Math.max(a, b);
    return {
      center: (min + max) / 2,
      min,
      max,
      size: max - min,
    };
  });
}

export function buildRefinementCells(
  neighborhood: LocalNeighborhood,
  alphaIndex: number | null = null,
): {
  positive: RefinementCell[];
  negative: RefinementCell[];
  fadedPositive: RefinementCell[];
  fadedNegative: RefinementCell[];
} {
  const xCells = buildAxisCells(neighborhood.axes.m_local);
  const yCells = buildAxisCells(neighborhood.axes.m_cross);
  const zCells = buildAxisCells(neighborhood.axes.alpha);
  const positive: RefinementCell[] = [];
  const negative: RefinementCell[] = [];
  const fadedPositive: RefinementCell[] = [];
  const fadedNegative: RefinementCell[] = [];

  for (const sample of neighborhood.samples) {
    const [xIndex, yIndex, zIndex] = sample.grid_index;
    const x = xCells[xIndex];
    const y = yCells[yIndex];
    const z = zCells[zIndex];
    if (!x || !y || !z) continue;

    const cell: RefinementCell = {
      sample,
      position: [x.center, y.center, z.center],
      scale: [
        Math.max(x.size * 0.92, 0.002),
        Math.max(y.size * 0.92, 0.002),
        Math.max(z.size * 0.92, 0.002),
      ],
    };
    const isActive = alphaIndex === null || zIndex === alphaIndex;
    if (sample.status === "self_replicator") {
      (isActive ? positive : fadedPositive).push(cell);
    } else {
      (isActive ? negative : fadedNegative).push(cell);
    }
  }

  return { positive, negative, fadedPositive, fadedNegative };
}

function sampleKey(index: readonly number[]): string {
  return `${index[0]},${index[1]},${index[2]}`;
}

function appendFaceOutline(
  output: number[],
  axis: 0 | 1 | 2,
  plane: number,
  cell: RefinementCell,
): void {
  const half: WorldPosition = [
    cell.scale[0] / 0.92 / 2,
    cell.scale[1] / 0.92 / 2,
    cell.scale[2] / 0.92 / 2,
  ];
  const min: WorldPosition = [
    cell.position[0] - half[0],
    cell.position[1] - half[1],
    cell.position[2] - half[2],
  ];
  const max: WorldPosition = [
    cell.position[0] + half[0],
    cell.position[1] + half[1],
    cell.position[2] + half[2],
  ];

  let corners: WorldPosition[];
  if (axis === 0) {
    corners = [
      [plane, min[1], min[2]],
      [plane, max[1], min[2]],
      [plane, max[1], max[2]],
      [plane, min[1], max[2]],
    ];
  } else if (axis === 1) {
    corners = [
      [min[0], plane, min[2]],
      [max[0], plane, min[2]],
      [max[0], plane, max[2]],
      [min[0], plane, max[2]],
    ];
  } else {
    corners = [
      [min[0], min[1], plane],
      [max[0], min[1], plane],
      [max[0], max[1], plane],
      [min[0], max[1], plane],
    ];
  }

  for (let index = 0; index < 4; index += 1) {
    const from = corners[index];
    const to = corners[(index + 1) % 4];
    if (from && to) output.push(...from, ...to);
  }
}

export function buildRefinementBoundarySegments(
  neighborhood: LocalNeighborhood,
  activeAlphaIndex: number | null = null,
): Float32Array {
  const cells = buildRefinementCells(neighborhood);
  const allCells = [
    ...cells.positive,
    ...cells.negative,
    ...cells.fadedPositive,
    ...cells.fadedNegative,
  ];
  const cellByKey = new Map(
    allCells.map((cell) => [sampleKey(cell.sample.grid_index), cell]),
  );
  const positiveCells = allCells.filter(
    (cell) =>
      cell.sample.status === "self_replicator" &&
      (activeAlphaIndex === null ||
        cell.sample.grid_index[2] === activeAlphaIndex),
  );
  const directions: ReadonlyArray<
    readonly [number, number, number, 0 | 1 | 2]
  > =
    activeAlphaIndex === null
      ? [
          [1, 0, 0, 0],
          [-1, 0, 0, 0],
          [0, 1, 0, 1],
          [0, -1, 0, 1],
          [0, 0, 1, 2],
          [0, 0, -1, 2],
        ]
      : [
          [1, 0, 0, 0],
          [-1, 0, 0, 0],
          [0, 1, 0, 1],
          [0, -1, 0, 1],
        ];
  const positions: number[] = [];

  for (const cell of positiveCells) {
    const [x, y, z] = cell.sample.grid_index;
    for (const [dx, dy, dz, axis] of directions) {
      const neighbor = cellByKey.get(sampleKey([x + dx, y + dy, z + dz]));
      if (!neighbor || neighbor.sample.status !== "nonreplicator") continue;
      const plane =
        (cell.position[axis] + neighbor.position[axis]) / 2;
      appendFaceOutline(positions, axis, plane, cell);
    }
  }

  return new Float32Array(positions);
}
