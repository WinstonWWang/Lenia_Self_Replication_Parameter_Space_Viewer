import { describe, expect, it } from "vitest";

import type {
  RefinementNeighborhood,
  SitePoint,
} from "../data";
import {
  buildAxisCells,
  buildRefinementBoundarySegments,
  buildRefinementCells,
  normalizeAxisValue,
  refinementContainsAlpha,
  refinementToGlobalTransform,
  splitPointDataByAlpha,
  type PointRenderDatum,
} from "./geometry";

function refinement(
  overrides: Partial<RefinementNeighborhood> = {},
): RefinementNeighborhood {
  return {
    id: "refinement-a",
    center_point_id: "triple_00001",
    axes: {
      m_local: [0, 1],
      m_cross: [0],
      alpha: [0],
    },
    samples: [],
    ...overrides,
  };
}

function datum(id: string, alphaIndex: number): PointRenderDatum {
  const point = {
    id,
    global_index: 0,
    grid_index: [0, 0, alphaIndex],
    coordinates: { m_local: 0, m_cross: 0, alpha: alphaIndex },
    classification: "dynamics_unresolved",
  } as SitePoint;
  return {
    id,
    point,
    position: [0, 0, alphaIndex],
    status: "unresolved",
    color: "#69adff",
  };
}

describe("visualization coordinates", () => {
  it("normalizes each physical axis independently", () => {
    expect(normalizeAxisValue(0, [0, 0.5, 1])).toBe(-1);
    expect(normalizeAxisValue(0.5, [0, 0.5, 1])).toBe(0);
    expect(normalizeAxisValue(1, [0, 0.5, 1])).toBe(1);
  });

  it("keeps nonuniform cell widths and fills the local cube", () => {
    const cells = buildAxisCells([0, 1, 3]);
    expect(cells).toHaveLength(3);
    expect(cells.reduce((sum, cell) => sum + cell.size, 0)).toBeCloseTo(2);
    expect(cells[0]?.size).toBeLessThan(cells[2]?.size ?? 0);
    expect(cells[0]?.min).toBeCloseTo(-1);
    expect(cells[2]?.max).toBeCloseTo(1);
  });

  it("maps a fine neighborhood into its physical location in the coarse cube", () => {
    const neighborhood = refinement({
      axes: {
        m_local: [0.49, 0.5, 0.51],
        m_cross: [3.4, 3.5, 3.6],
        alpha: [0.24, 0.25, 0.26],
      },
    });
    const transform = refinementToGlobalTransform(neighborhood, {
      m_local: { count: 20, values: [0, 1] },
      m_cross: { count: 20, values: [0, 7] },
      alpha: { count: 20, values: [0, 1] },
    });
    expect(transform.position[0]).toBeCloseTo(0);
    expect(transform.position[1]).toBeCloseTo(0);
    expect(transform.position[2]).toBeCloseTo(-0.5);
    expect(transform.scale[0]).toBeCloseTo(0.03);
    expect(refinementContainsAlpha(neighborhood, 0.25, [0, 1])).toBe(true);
    expect(refinementContainsAlpha(neighborhood, 0.75, [0, 1])).toBe(false);
  });

  it("uses grid_index[2] as the alpha slice", () => {
    const data = [datum("triple_00000", 0), datum("triple_00001", 1)];
    const split = splitPointDataByAlpha(data, 1);
    expect(split.active.map((item) => item.id)).toEqual(["triple_00001"]);
    expect(split.faded.map((item) => item.id)).toEqual(["triple_00000"]);
  });

  it("omits off-slice points for a clean pinned 2D view", () => {
    const data = [datum("triple_00000", 0), datum("triple_00001", 1)];
    const split = splitPointDataByAlpha(data, 1, false);
    expect(split.active.map((item) => item.id)).toEqual(["triple_00001"]);
    expect(split.faded).toEqual([]);
  });
});

describe("refinement geometry", () => {
  it("separates active and faded refinement cells by alpha", () => {
    const neighborhood = refinement({
      axes: {
        m_local: [0],
        m_cross: [0],
        alpha: [0, 0.25],
      },
      samples: [
        {
          grid_index: [0, 0, 0],
          coordinates: { m_local: 0, m_cross: 0, alpha: 0 },
          status: "self_replicator",
        },
        {
          grid_index: [0, 0, 1],
          coordinates: { m_local: 0, m_cross: 0, alpha: 0.25 },
          status: "nonreplicator",
        },
      ],
    });
    const cells = buildRefinementCells(neighborhood, 0);
    expect(cells.positive).toHaveLength(1);
    expect(cells.fadedNegative).toHaveLength(1);
    expect(cells.negative).toHaveLength(0);
  });

  it("draws a white boundary only between tested positive and negative neighbors", () => {
    const neighborhood = refinement({
      samples: [
        {
          grid_index: [0, 0, 0],
          coordinates: { m_local: 0, m_cross: 0, alpha: 0 },
          status: "self_replicator",
        },
        {
          grid_index: [1, 0, 0],
          coordinates: { m_local: 1, m_cross: 0, alpha: 0 },
          status: "nonreplicator",
        },
      ],
    });
    expect(buildRefinementBoundarySegments(neighborhood)).toHaveLength(24);

    const withUnknownNeighbor = refinement({
      samples: neighborhood.samples.slice(0, 1),
    });
    expect(buildRefinementBoundarySegments(withUnknownNeighbor)).toHaveLength(
      0,
    );
  });

  it("does not turn an alpha-neighbor transition into a 2D slice boundary", () => {
    const neighborhood = refinement({
      axes: {
        m_local: [0],
        m_cross: [0],
        alpha: [0, 1],
      },
      samples: [
        {
          grid_index: [0, 0, 0],
          coordinates: { m_local: 0, m_cross: 0, alpha: 0 },
          status: "self_replicator",
        },
        {
          grid_index: [0, 0, 1],
          coordinates: { m_local: 0, m_cross: 0, alpha: 1 },
          status: "nonreplicator",
        },
      ],
    });
    expect(buildRefinementBoundarySegments(neighborhood)).toHaveLength(24);
    expect(buildRefinementBoundarySegments(neighborhood, 0)).toHaveLength(0);
  });
});
