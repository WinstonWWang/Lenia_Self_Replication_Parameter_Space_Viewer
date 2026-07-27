import { describe, expect, it } from "vitest";
import {
  parseParameterTriple,
  snapToNearestTestedPoint,
} from "./search";
import type { SiteManifest, SitePoint } from "./types";

function searchFixture(): SiteManifest {
  const unitValues = Array.from({ length: 20 }, (_, index) => index / 19);
  const crossValues = Array.from(
    { length: 20 },
    (_, index) => (index * 7.31913948059082) / 19,
  );
  const indices: [number, number, number] = [2, 5, 7];
  const globalIndex = (indices[0] * 20 + indices[1]) * 20 + indices[2];
  const point = {
    id: `triple_${globalIndex.toString().padStart(5, "0")}`,
    global_index: globalIndex,
    grid_index: indices,
    coordinates: {
      m_local: unitValues[indices[0]],
      m_cross: crossValues[indices[1]],
      alpha: unitValues[indices[2]],
    },
  } as SitePoint;
  const points = new Array<SitePoint>(8000);
  points[globalIndex] = point;

  return {
    axes: {
      m_local: { count: 20, values: unitValues },
      m_cross: { count: 20, values: crossValues },
      alpha: { count: 20, values: unitValues },
    },
    points,
  } as SiteManifest;
}

describe("parseParameterTriple", () => {
  it.each([
    ["(0.1, 2.5, .4)", [0.1, 2.5, 0.4]],
    [" 0, 7.319139e0, 1 ", [0, 7.319139, 1]],
    ["(+1., -2E-1, .5e+1)", [1, -0.2, 5]],
  ])("parses %s", (input, expected) => {
    expect(parseParameterTriple(input)).toEqual(expected);
  });

  it.each([
    "",
    "(1,2,3",
    "1,2,3)",
    "((1,2,3))",
    "(1,2),3",
    "1,2",
    "1,2,3,4",
    "1,,3",
    "NaN,2,3",
    "Infinity,2,3",
    "1 2,3,4",
  ])("rejects malformed input %s", (input) => {
    expect(parseParameterTriple(input)).toBeNull();
  });
});

describe("snapToNearestTestedPoint", () => {
  it("snaps each physical axis and returns its exact manifest point", () => {
    const manifest = searchFixture();
    const expected = manifest.points[(2 * 20 + 5) * 20 + 7];
    const result = snapToNearestTestedPoint(manifest, [
      expected.coordinates.m_local + 0.001,
      expected.coordinates.m_cross - 0.002,
      expected.coordinates.alpha + 0.003,
    ]);

    expect(result.indices).toEqual([2, 5, 7]);
    expect(result.point).toBe(expected);
    expect(result.coordinates).toEqual(expected.coordinates);
    expect(result.wasSnapped).toBe(true);
  });

  it("reports an exact grid triple as unsnapped", () => {
    const manifest = searchFixture();
    const point = manifest.points[(2 * 20 + 5) * 20 + 7];
    const result = snapToNearestTestedPoint(manifest, [
      point.coordinates.m_local,
      point.coordinates.m_cross,
      point.coordinates.alpha,
    ]);
    expect(result.wasSnapped).toBe(false);
  });
});
