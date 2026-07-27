import type {
  FeaturedPoint,
  ParameterTriple,
  SiteManifest,
  SnapResult,
} from "./types";

const FINITE_NUMBER =
  /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/;

export function parseParameterTriple(
  input: string,
): ParameterTriple | null {
  let value = input.trim();
  if (value.length === 0) return null;

  const startsWithParenthesis = value.startsWith("(");
  const endsWithParenthesis = value.endsWith(")");
  if (startsWithParenthesis !== endsWithParenthesis) return null;

  if (startsWithParenthesis) {
    value = value.slice(1, -1).trim();
  }
  if (value.includes("(") || value.includes(")")) return null;

  const parts = value.split(",");
  if (parts.length !== 3) return null;

  const parsed = parts.map((part) => {
    const token = part.trim();
    if (!FINITE_NUMBER.test(token)) return Number.NaN;
    return Number(token);
  });
  if (!parsed.every(Number.isFinite)) return null;
  return [parsed[0], parsed[1], parsed[2]];
}

export function findFeaturedPointByName(
  points: readonly FeaturedPoint[],
  input: string,
): FeaturedPoint | null {
  const normalized = input.trim().toLocaleLowerCase();
  if (!normalized) return null;
  return (
    points.find(
      (point) =>
        point.id.toLocaleLowerCase() === normalized ||
        point.display_label.toLocaleLowerCase() === normalized,
    ) ?? null
  );
}

export function findExactFeaturedPoint(
  points: readonly FeaturedPoint[],
  input: ParameterTriple,
): FeaturedPoint | null {
  return (
    points.find(
      (point) =>
        point.coordinates.m_local === input[0] &&
        point.coordinates.m_cross === input[1] &&
        point.coordinates.alpha === input[2],
    ) ?? null
  );
}

function nearestAxisIndex(values: number[], target: number): number {
  let bestIndex = 0;
  let bestDistance = Math.abs(values[0] - target);
  for (let index = 1; index < values.length; index += 1) {
    const distance = Math.abs(values[index] - target);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }
  return bestIndex;
}

export function snapToNearestTestedPoint(
  manifest: SiteManifest,
  input: ParameterTriple,
): SnapResult {
  if (!input.every(Number.isFinite)) {
    throw new TypeError("Search coordinates must be finite numbers");
  }

  const i = nearestAxisIndex(manifest.axes.m_local.values, input[0]);
  const j = nearestAxisIndex(manifest.axes.m_cross.values, input[1]);
  const k = nearestAxisIndex(manifest.axes.alpha.values, input[2]);
  const globalIndex = (i * 20 + j) * 20 + k;
  const point =
    manifest.points[globalIndex] ??
    manifest.points.find(
      (candidate) =>
        candidate.grid_index[0] === i &&
        candidate.grid_index[1] === j &&
        candidate.grid_index[2] === k,
    );

  if (!point) {
    throw new Error("The snapped grid point is missing from the manifest");
  }

  const coordinates = {
    m_local: manifest.axes.m_local.values[i],
    m_cross: manifest.axes.m_cross.values[j],
    alpha: manifest.axes.alpha.values[k],
  };
  const deltas = {
    m_local: coordinates.m_local - input[0],
    m_cross: coordinates.m_cross - input[1],
    alpha: coordinates.alpha - input[2],
  };

  return {
    input: [...input],
    coordinates,
    indices: [i, j, k],
    deltas,
    point,
    wasSnapped:
      deltas.m_local !== 0 ||
      deltas.m_cross !== 0 ||
      deltas.alpha !== 0,
  };
}

export const snapToNearestPoint = snapToNearestTestedPoint;
