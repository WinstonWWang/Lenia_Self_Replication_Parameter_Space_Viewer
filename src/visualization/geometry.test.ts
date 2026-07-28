import { describe, expect, it } from "vitest";

import type {
  FeaturedCatalog,
  RefinementNeighborhood,
  SiteManifest,
  SitePoint,
} from "../data";
import {
  buildAxisCells,
  buildRefinementBoundarySegments,
  buildRefinementCells,
  coordinatesToWorld,
  makeFeaturedPointRenderData,
  makePointRenderData,
  normalizeAxisValue,
  refinementAlphaIndexForSlab,
  refinementContainsAlpha,
  refinementToGlobalTransform,
  selfReplicatorGlowRadius,
  SELF_REPLICATOR_GLOW_DIAMETER_GRID_FRACTION,
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
    kind: "coarse",
    id,
    point,
    coordinates: point.coordinates,
    position: [0, 0, alphaIndex],
    alphaIndex,
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

  it("caps the self-replicator glow below half the smallest grid spacing", () => {
    const axes = {
      m_local: { count: 20 as const, values: [0, 0.1, 1] },
      m_cross: { count: 20 as const, values: [0, 0.5, 1] },
      alpha: { count: 20 as const, values: [0, 0.5, 1] },
    };
    const smallestNormalizedSpacing = 0.2;
    const glowDiameter = selfReplicatorGlowRadius(axes) * 2;
    expect(glowDiameter).toBeCloseTo(
      smallestNormalizedSpacing *
        SELF_REPLICATOR_GLOW_DIAMETER_GRID_FRACTION,
    );
    expect(glowDiameter).toBeLessThan(
      smallestNormalizedSpacing / 2,
    );
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

  it("anchors a featured neighborhood on its exact off-grid center", () => {
    const center = {
      m_local: 0.3152100145816803,
      m_cross: 0.17585211992263794,
      alpha: 0.7561357617378235,
    };
    const neighborhood = refinement({
      axes: {
        m_local: [0.3, center.m_local, 0.32],
        m_cross: [0.16, center.m_cross, 0.18],
        alpha: [0.74, center.alpha, 0.76],
      },
    });
    const axes = {
      m_local: { count: 20 as const, values: [0, 1] },
      m_cross: { count: 20 as const, values: [0, 7] },
      alpha: { count: 20 as const, values: [0, 1] },
    };
    const transform = refinementToGlobalTransform(
      neighborhood,
      axes,
      center,
    );
    const localCenter = [
      buildAxisCells(neighborhood.axes.m_local)[1]?.center ?? 0,
      buildAxisCells(neighborhood.axes.m_cross)[1]?.center ?? 0,
      buildAxisCells(neighborhood.axes.alpha)[1]?.center ?? 0,
    ];
    const transformedCenter = transform.position.map(
      (value, index) =>
        value +
        (localCenter[index] ?? 0) * (transform.scale[index] ?? 1),
    );
    const expectedCenter = coordinatesToWorld(center, axes);
    transformedCenter.forEach((value, index) => {
      expect(value).toBeCloseTo(expectedCenter[index] ?? 0, 12);
    });
  });

  it("shows the featured center plane in its nearest coarse alpha slab", () => {
    const centerAlpha = 0.7561357617378235;
    const neighborhood = refinement({
      axes: {
        m_local: [0.3152100145816803],
        m_cross: [0.17585211992263794],
        alpha: [0.751, centerAlpha, 0.761],
      },
    });
    const globalAlpha = Array.from(
      { length: 20 },
      (_, index) => index / 19,
    );

    expect(
      refinementAlphaIndexForSlab(
        neighborhood,
        globalAlpha,
        14,
        centerAlpha,
      ),
    ).toBe(1);
    expect(
      refinementAlphaIndexForSlab(
        neighborhood,
        globalAlpha,
        13,
        centerAlpha,
      ),
    ).toBeNull();
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

  it("places only off-grid featured points at exact coordinates and in their nearest alpha slab", () => {
    const axisValues = Array.from(
      { length: 20 },
      (_, index) => index / 19,
    );
    const crossValues = Array.from(
      { length: 20 },
      (_, index) => (7.31913948059082 * index) / 19,
    );
    const manifest = {
      axes: {
        m_local: { count: 20, values: axisValues },
        m_cross: { count: 20, values: crossValues },
        alpha: { count: 20, values: axisValues },
      },
      points: [
        {
          id: "triple_01608",
          grid_index: [4, 0, 8],
          coordinates: {
            m_local: 0.2,
            m_cross: 0,
            alpha: 0.4,
          },
          classification: "dynamics_unresolved",
        },
      ],
    } as SiteManifest;
    const coordinates = {
      m_local: 0.3152100145816803,
      m_cross: 0.17585211992263794,
      alpha: 0.7561357617378235,
    };
    const catalog = {
      featured_points: [
        {
          id: "preclassification_sobol_triple_00075",
          display_label: "triple_00075",
          coordinates,
        },
        {
          id: "canonical-feature",
          display_label: "triple_01608",
          coarse_point_id: "triple_01608",
          coordinates: { m_local: 0.2, m_cross: 0, alpha: 0.4 },
        },
      ],
    } as FeaturedCatalog;

    const rendered = makeFeaturedPointRenderData(manifest, catalog);
    expect(rendered).toHaveLength(1);
    expect(rendered[0]?.position).toEqual(
      coordinatesToWorld(coordinates, manifest.axes),
    );
    expect(rendered[0]?.position[0]).not.toBe(
      normalizeAxisValue(axisValues[6] ?? 0, axisValues),
    );
    expect(rendered[0]?.alphaIndex).toBe(14);
    expect(splitPointDataByAlpha(rendered, 14).active).toHaveLength(1);
    expect(splitPointDataByAlpha(rendered, 13).active).toHaveLength(0);
    expect(rendered.map((datum) => datum.id)).not.toContain(
      "canonical-feature",
    );

    const canonical = makePointRenderData(manifest, null, catalog);
    expect(canonical).toHaveLength(1);
    expect(canonical[0]?.id).toBe("triple_01608");
    expect(canonical[0]?.status).toBe("self_replicator");
    expect(canonical[0]?.color).toBe("#43d879");

    const minimumGridSpacing = 2 / 19;
    const glowDiameter = selfReplicatorGlowRadius(manifest.axes) * 2;
    expect(glowDiameter).toBeCloseTo(
      minimumGridSpacing *
        SELF_REPLICATOR_GLOW_DIAMETER_GRID_FRACTION,
    );
    expect(glowDiameter).toBeLessThanOrEqual(
      minimumGridSpacing / 2,
    );
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
