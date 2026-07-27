import { describe, expect, it, vi } from "vitest";
import bundledManifest from "../../public/data/site-manifest.json";
import {
  findFeaturedNeighborhood,
  findFeaturedPoint,
  visibleOffGridFeaturedPoints,
} from "./featured";
import { loadSiteData } from "./loader";
import {
  assertPreparedFirstPublication,
  getPreparedVariationExpectations,
} from "./preparedFeatured";
import { getFeaturedCatalogSemanticIssues } from "./semantics";
import type {
  FeaturedCatalog,
  FeaturedPoint,
  OverlayMedia,
  ParameterCoordinates,
  RuntimeConfig,
  SiteManifest,
} from "./types";
import {
  validateFeaturedCatalog,
  validateRuntimeConfig,
} from "./validators";

const manifest = bundledManifest as unknown as SiteManifest;
const HASH = "a".repeat(64);
const media: OverlayMedia = {
  poster: {
    key: `media/v1/featured/${HASH}.webp`,
    sha256: HASH,
    bytes: 100,
    width: 800,
    height: 800,
  },
  video: {
    key: `media/v1/featured/${HASH}.mp4`,
    sha256: HASH,
    bytes: 1_000,
    width: 800,
    height: 800,
    frames: 300,
    fps: 25,
    scored_updates: 800,
    replay_updates: 1000,
  },
  parameters: {
    key: `repro/v1/featured/${HASH}.json`,
    sha256: HASH,
    bytes: 200,
    format: "json",
  },
  initial_field: {
    key: `repro/v1/featured/${HASH}.npy`,
    sha256: HASH,
    bytes: 262_272,
    format: "npy",
    width: 256,
    height: 256,
    value_min: 0,
    value_max: 1,
  },
};

const exactOffGrid = [
  {
    id: "preclassification_sobol_triple_00075",
    display_label: "triple_00075",
    namespace: "preclassification_sobol",
    coordinates: {
      m_local: 0.3152100145816803,
      m_cross: 0.17585211992263794,
      alpha: 0.7561357617378235,
    },
    sourceCoordinates: {
      m_local: 0.315210017375648,
      m_cross: 0.17585212592700294,
      alpha: 0.7561357384547591,
    },
    sampleCount: 701,
  },
  {
    id: "preclassification_sobol_triple_00891",
    display_label: "triple_00891",
    namespace: "preclassification_sobol",
    coordinates: {
      m_local: 0.2847903370857239,
      m_cross: 0.1466793417930603,
      alpha: 0.2798478901386261,
    },
    sourceCoordinates: {
      m_local: 0.2847903463989496,
      m_cross: 0.146679344111174,
      alpha: 0.2798478798940778,
    },
    sampleCount: 701,
  },
  {
    id: "reference_triple_original",
    display_label: "triple_original",
    namespace: "reference",
    coordinates: {
      m_local: 0.2196178287267685,
      m_cross: 0.06508693099021912,
      alpha: 0.4492952340663093,
    },
    sourceCoordinates: {
      m_local: 0.2196178287267685,
      m_cross: 0.06508693099021912,
      alpha: 0.4492952340663093,
    },
    sampleCount: 501,
  },
] as const;

const manualNonreplicatorRanges: Record<
  string,
  readonly (readonly [number, number])[]
> = {
  preclassification_sobol_triple_00075: [
    [1, 10],
    [21, 80],
    [91, 150],
    [161, 220],
    [230, 290],
    [300, 700],
  ],
  preclassification_sobol_triple_00891: [
    [1, 8],
    [11, 158],
    [161, 225],
    [231, 296],
    [301, 700],
  ],
  triple_01210: [
    [1, 352],
    [357, 400],
    [411, 450],
    [455, 500],
  ],
  triple_01608: [
    [1, 158],
    [161, 206],
    [211, 253],
    [261, 302],
    [311, 350],
    [361, 400],
    [411, 450],
    [471, 500],
  ],
  reference_triple_original: [[1, 500]],
};

function manualStatus(
  specificationKey: string,
  scanIndex: number,
): "self_replicator" | "nonreplicator" {
  const ranges = manualNonreplicatorRanges[specificationKey];
  if (!ranges) {
    throw new Error(`Missing manual ranges for ${specificationKey}`);
  }
  return ranges.some(
    ([minimum, maximum]) =>
      scanIndex >= minimum && scanIndex <= maximum,
  )
    ? "nonreplicator"
    : "self_replicator";
}

function makePoint(
  id: string,
  displayLabel: string,
  coordinates: ParameterCoordinates,
  neighborhoodId: string,
  coarsePointId?: string,
): FeaturedPoint {
  return {
    id,
    display_label: displayLabel,
    namespace: coarsePointId ? "canonical_grid" : "featured_off_grid",
    ...(coarsePointId ? { coarse_point_id: coarsePointId } : {}),
    coordinates: { ...coordinates },
    source_reported_coordinates: { ...coordinates },
    coordinate_semantics: "exact simulator-applied coordinates",
    status: "self_replicator",
    reviewed_at: "2026-07-27T00:00:00Z",
    refinement_neighborhood_id: neighborhoodId,
    media,
    search_result: {
      provenance: "Representative test fixture",
      best_loss: -0.5,
      best_loss_prompt: -0.25,
      best_clip_score_prompt: 0.25,
      best_loss_softmax: -0.25,
    },
    score_warning: "Search score, not replication verification",
    center_video_world_pixels: 800,
    refinement_simulation_world_pixels: 256,
    world_size_comparison_note: null,
  };
}

export function makeFeaturedCatalogFixture(): FeaturedCatalog {
  const canonicalSpecs = ["triple_01210", "triple_01608"].map(
    (coarsePointId) => {
      const point = manifest.points.find(
        (candidate) => candidate.id === coarsePointId,
      );
      if (!point) throw new Error(`Missing ${coarsePointId} fixture center`);
      return {
        id: `canonical_featured_${coarsePointId}`,
        display_label: coarsePointId,
        coordinates: point.coordinates,
        coarsePointId,
        namespace: "frozen_337_grid",
        sampleCount: 501,
      };
    },
  );
  const specs = [...exactOffGrid, ...canonicalSpecs];
  const featuredPoints: FeaturedPoint[] = [];
  const neighborhoods = specs.map((spec) => {
    const specificationKey =
      "coarsePointId" in spec ? spec.coarsePointId : spec.id;
    const neighborhoodId = `neighborhood_${spec.id}`;
    const point = makePoint(
      spec.id,
      spec.display_label,
      spec.coordinates,
      neighborhoodId,
      "coarsePointId" in spec ? spec.coarsePointId : undefined,
    );
    if ("sourceCoordinates" in spec) {
      point.source_reported_coordinates = {
        ...spec.sourceCoordinates,
      };
    }
    point.namespace = spec.namespace;
    featuredPoints.push(point);
    const variations = getPreparedVariationExpectations(point, manifest);
    const axes = {
      m_local: [
        ...new Set([
          point.coordinates.m_local,
          ...variations.map(({ coordinates }) => coordinates.m_local),
        ]),
      ].sort((left, right) => left - right),
      m_cross: [
        ...new Set([
          point.coordinates.m_cross,
          ...variations.map(({ coordinates }) => coordinates.m_cross),
        ]),
      ].sort((left, right) => left - right),
      alpha: [
        ...new Set([
          point.coordinates.alpha,
          ...variations.map(({ coordinates }) => coordinates.alpha),
        ]),
      ].sort((left, right) => left - right),
    };
    const gridIndex = (
      coordinates: ParameterCoordinates,
    ): [number, number, number] => [
      axes.m_local.indexOf(coordinates.m_local),
      axes.m_cross.indexOf(coordinates.m_cross),
      axes.alpha.indexOf(coordinates.alpha),
    ];
    return {
      id: neighborhoodId,
      center_featured_id: point.id,
      axes,
      shared_media: {
        parameters: media.parameters,
        initial_field: media.initial_field,
      },
      samples: [
        {
          grid_index: gridIndex(point.coordinates),
          coordinates: point.coordinates,
          status: "self_replicator" as const,
        },
        ...variations.map((variation) => ({
          grid_index: gridIndex(variation.coordinates),
          coordinates: variation.coordinates,
          status: manualStatus(
            specificationKey,
            variation.scanIndex,
          ),
          scan_index: variation.scanIndex,
          variation_label: `${point.display_label}_v${String(
            variation.variationLabel,
          ).padStart(4, "0")}`,
          media: { video: null },
        })),
      ],
    };
  });

  return {
    schema_version: 1,
    dataset_id: manifest.dataset_id,
    generated_at: "2026-07-27T00:00:00Z",
    asset_base_url: "https://assets.example/",
    based_on_manifest_sha256: manifest.manifest_sha256,
    featured_points: featuredPoints,
    neighborhoods,
  };
}

const runtimeConfig: RuntimeConfig = {
  schema_version: 1,
  manifest_pointer_url: "https://assets.example/manifests/latest.json",
  fallback_manifest_url: "./data/site-manifest.json",
  fallback_asset_base_url: "./",
  refresh_interval_seconds: 300,
};

describe("featured catalog contract", () => {
  it("accepts the optional runtime URL and still rejects unknown fields", () => {
    expect(
      validateRuntimeConfig({
        ...runtimeConfig,
        featured_catalog_url:
          "https://assets.example/featured/featured-replicators.json",
      }),
    ).toBe(true);
    expect(
      validateRuntimeConfig({
        ...runtimeConfig,
        unknown_catalog_url: "https://assets.example/unknown.json",
      }),
    ).toBe(false);
  });

  it("accepts the representative five-center, 2,905-sample catalog", () => {
    const catalog = makeFeaturedCatalogFixture();
    expect(
      validateFeaturedCatalog(catalog),
      JSON.stringify(validateFeaturedCatalog.errors),
    ).toBe(true);
    expect(getFeaturedCatalogSemanticIssues(catalog, manifest)).toEqual([]);
    expect(catalog.neighborhoods.map(({ samples }) => samples.length)).toEqual(
      [701, 701, 501, 501, 501],
    );
    expect(
      catalog.neighborhoods.reduce(
        (sum, neighborhood) => sum + neighborhood.samples.length,
        0,
      ),
    ).toBe(2905);
    const statuses = catalog.neighborhoods
      .flatMap(({ samples }) => samples)
      .reduce(
        (counts, sample) => ({
          ...counts,
          [sample.status]: counts[sample.status] + 1,
        }),
        { self_replicator: 0, nonreplicator: 0 },
      );
    expect(statuses).toEqual({
      self_replicator: 145,
      nonreplicator: 2760,
    });
    expect(() =>
      assertPreparedFirstPublication(catalog, manifest),
    ).not.toThrow();
  });

  it("rejects release-label, manual-status, and video-suppression drift", () => {
    const wrongLabel = makeFeaturedCatalogFixture();
    wrongLabel.featured_points[0].display_label = "wrong";
    expect(() =>
      assertPreparedFirstPublication(wrongLabel, manifest),
    ).toThrow(/must use display label/);

    const wrongStatus = makeFeaturedCatalogFixture();
    const numberedSample = wrongStatus.neighborhoods[0].samples.find(
      (sample) => sample.scan_index === 1,
    );
    if (!numberedSample) throw new Error("Numbered sample is required");
    numberedSample.status = "self_replicator";
    expect(() =>
      assertPreparedFirstPublication(wrongStatus, manifest),
    ).toThrow(/scan 1 must be nonreplicator/);

    const inheritedVideo = makeFeaturedCatalogFixture();
    const variedSample = inheritedVideo.neighborhoods[0].samples.find(
      (sample) => sample.scan_index === 1,
    );
    if (!variedSample?.media) {
      throw new Error("Variation media is required");
    }
    delete variedSample.media.video;
    expect(() =>
      assertPreparedFirstPublication(inheritedVideo, manifest),
    ).toThrow(/must explicitly set media\.video to null/);

    const wrongClipIdentity = makeFeaturedCatalogFixture();
    const searchResult =
      wrongClipIdentity.featured_points[0].search_result;
    if (!searchResult) throw new Error("Search result is required");
    searchResult.best_clip_score_prompt = 0.5;
    expect(
      getFeaturedCatalogSemanticIssues(
        wrongClipIdentity,
        manifest,
      ),
    ).toContain(
      `${wrongClipIdentity.featured_points[0].id} best_clip_score_prompt must equal -best_loss_prompt`,
    );
    expect(() =>
      assertPreparedFirstPublication(wrongClipIdentity, manifest),
    ).toThrow(/-best_loss_prompt/);

    const suppressedField = makeFeaturedCatalogFixture();
    const fieldSample = suppressedField.neighborhoods[0].samples.find(
      (sample) => sample.scan_index === 1,
    );
    if (!fieldSample?.media) {
      throw new Error("Variation media is required");
    }
    fieldSample.media.initial_field = null;
    expect(() =>
      assertPreparedFirstPublication(suppressedField, manifest),
    ).toThrow(/must not suppress the selected initial field/);

    const suppressedCenterVideo = makeFeaturedCatalogFixture();
    const centerPoint = suppressedCenterVideo.featured_points[0];
    const centerSample =
      suppressedCenterVideo.neighborhoods[0].samples.find(
        (sample) =>
          sample.coordinates.m_local ===
            centerPoint.coordinates.m_local &&
          sample.coordinates.m_cross ===
            centerPoint.coordinates.m_cross &&
          sample.coordinates.alpha === centerPoint.coordinates.alpha,
      );
    if (!centerSample) throw new Error("Center sample is required");
    centerSample.media = { video: null };
    expect(() =>
      assertPreparedFirstPublication(
        suppressedCenterVideo,
        manifest,
      ),
    ).toThrow(/must reuse its center video/);

    const wrongSourceCoordinates = makeFeaturedCatalogFixture();
    wrongSourceCoordinates.featured_points[0].source_reported_coordinates.alpha =
      wrongSourceCoordinates.featured_points[0].coordinates.alpha;
    expect(() =>
      assertPreparedFirstPublication(
        wrongSourceCoordinates,
        manifest,
      ),
    ).toThrow(/source-reported coordinates/);

    const wrongOriginalSource = makeFeaturedCatalogFixture();
    const originalPoint = wrongOriginalSource.featured_points.find(
      (point) => point.id === "reference_triple_original",
    );
    if (!originalPoint) throw new Error("Original point is required");
    originalPoint.source_reported_coordinates.alpha += 0.001;
    expect(() =>
      assertPreparedFirstPublication(
        wrongOriginalSource,
        manifest,
      ),
    ).toThrow(/source-reported coordinates/);

    const permutedScanMapping = makeFeaturedCatalogFixture();
    const firstScan = permutedScanMapping.neighborhoods[0].samples.find(
      (sample) => sample.scan_index === 1,
    );
    const secondScan = permutedScanMapping.neighborhoods[0].samples.find(
      (sample) => sample.scan_index === 2,
    );
    if (!firstScan || !secondScan) {
      throw new Error("First two scans are required");
    }
    firstScan.scan_index = 2;
    secondScan.scan_index = 1;
    expect(() =>
      assertPreparedFirstPublication(
        permutedScanMapping,
        manifest,
      ),
    ).toThrow(/authoritative variation coordinates/);

    const pollutedAxes = makeFeaturedCatalogFixture();
    pollutedAxes.neighborhoods[0].axes.m_local.unshift(0);
    for (const sample of pollutedAxes.neighborhoods[0].samples) {
      sample.grid_index[0] += 1;
    }
    expect(
      getFeaturedCatalogSemanticIssues(pollutedAxes, manifest),
    ).toEqual([]);
    expect(() =>
      assertPreparedFirstPublication(pollutedAxes, manifest),
    ).toThrow(/axis does not match the authoritative sampled coordinates/);
  });

  it("preserves the exact three off-grid centers and excludes canonical duplicates", () => {
    const catalog = makeFeaturedCatalogFixture();
    expect(visibleOffGridFeaturedPoints(catalog)).toHaveLength(3);
    for (const expected of exactOffGrid) {
      const point = findFeaturedPoint(catalog, expected.id);
      expect(point?.coordinates).toEqual(expected.coordinates);
      expect(point?.source_reported_coordinates).toEqual(
        expected.sourceCoordinates,
      );
      expect(findFeaturedNeighborhood(catalog, expected.id)).toBeDefined();
    }
    expect(
      catalog.featured_points.filter(
        (point) => point.coarse_point_id !== undefined,
      ),
    ).toHaveLength(2);
  });

  it("keeps historical display labels separate from canonical IDs", () => {
    const catalog = makeFeaturedCatalogFixture();
    expect(manifest.points.some((point) => point.id === "triple_00075")).toBe(
      true,
    );
    expect(findFeaturedPoint(catalog, "triple_00075")).toBeUndefined();
    expect(
      findFeaturedPoint(
        catalog,
        "preclassification_sobol_triple_00075",
      )?.display_label,
    ).toBe("triple_00075");

    const collided = structuredClone(catalog);
    const point = collided.featured_points[0];
    const neighborhood = collided.neighborhoods[0];
    point.id = "triple_00075";
    neighborhood.center_featured_id = point.id;
    expect(getFeaturedCatalogSemanticIssues(collided, manifest)).toContain(
      "featured point id triple_00075 collides with a canonical point id",
    );
  });

  it("rejects malformed IDs, axes, coordinates, unsafe media, and private text", () => {
    const malformedId = structuredClone(makeFeaturedCatalogFixture());
    malformedId.featured_points[0].id = "../featured";
    expect(validateFeaturedCatalog(malformedId)).toBe(false);

    const unsortedAxis = structuredClone(makeFeaturedCatalogFixture());
    unsortedAxis.neighborhoods[0].axes.alpha.reverse();
    expect(
      getFeaturedCatalogSemanticIssues(unsortedAxis, manifest),
    ).toContain(
      `featured neighborhood ${unsortedAxis.neighborhoods[0].id} axis alpha must be finite and strictly increasing`,
    );

    const mismatchedSample = structuredClone(
      makeFeaturedCatalogFixture(),
    );
    mismatchedSample.neighborhoods[0].samples[0].coordinates.alpha = 0.123;
    expect(
      getFeaturedCatalogSemanticIssues(mismatchedSample, manifest).some(
        (issue) => issue.includes("coordinates do not match its indices"),
      ),
    ).toBe(true);

    const unsafeMedia = structuredClone(makeFeaturedCatalogFixture());
    const poster = unsafeMedia.featured_points[0].media.poster;
    if (!poster) throw new Error("Fixture poster is required");
    poster.key = "https://evil.example/video.mp4";
    expect(validateFeaturedCatalog(unsafeMedia)).toBe(false);

    const mismatchedFilename = structuredClone(
      makeFeaturedCatalogFixture(),
    );
    const mismatchedPoster = mismatchedFilename.featured_points[0].media.poster;
    if (!mismatchedPoster) throw new Error("Fixture poster is required");
    mismatchedPoster.key = `media/v1/featured/${"b".repeat(64)}.webp`;
    expect(
      getFeaturedCatalogSemanticIssues(mismatchedFilename, manifest),
    ).toContain(
      `featured point ${mismatchedFilename.featured_points[0].id}.poster filename stem must equal its SHA-256`,
    );

    const privateText = structuredClone(makeFeaturedCatalogFixture());
    privateText.featured_points[0].score_warning =
      ["C:", "Users", "researcher", "private.json"].join("\\");
    expect(getFeaturedCatalogSemanticIssues(privateText, manifest)).toContain(
      "featured catalog contains a forbidden private-path or secret pattern",
    );
  });

  it("preserves explicit-null variation video media", () => {
    const catalog = makeFeaturedCatalogFixture();
    const varied = catalog.neighborhoods[0].samples.find(
      (sample) => sample.variation_label !== undefined,
    );
    expect(varied?.media).toHaveProperty("video", null);
  });

  it("requires the unique center sample to remain a self-replicator", () => {
    const catalog = makeFeaturedCatalogFixture();
    const point = catalog.featured_points[0];
    const neighborhood = catalog.neighborhoods[0];
    const centerSample = neighborhood.samples.find(
      (sample) =>
        sample.coordinates.m_local === point.coordinates.m_local &&
        sample.coordinates.m_cross === point.coordinates.m_cross &&
        sample.coordinates.alpha === point.coordinates.alpha,
    );
    if (!centerSample) throw new Error("Fixture center sample is required");
    centerSample.status = "nonreplicator";

    expect(getFeaturedCatalogSemanticIssues(catalog, manifest)).toContain(
      `featured neighborhood ${neighborhood.id} center sample must be self_replicator`,
    );
  });
});

describe("featured catalog loading", () => {
  const configUrl =
    "https://winstonwwang.github.io/Lenia_Self_Replication_Parameter_Space_Viewer/site-config.json";
  const featuredCatalogUrl =
    "https://assets.example/featured/featured-replicators.json";

  function makeFetcher(featuredResponse: Response): typeof fetch {
    const config = {
      ...runtimeConfig,
      featured_catalog_url: featuredCatalogUrl,
    };
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === configUrl) {
        return new Response(JSON.stringify(config));
      }
      if (url === config.manifest_pointer_url) {
        return new Response("not published", { status: 404 });
      }
      if (url.endsWith("/data/site-manifest.json")) {
        return new Response(JSON.stringify(manifest));
      }
      if (url === featuredCatalogUrl) return featuredResponse;
      return new Response("missing", { status: 404 });
    }) as unknown as typeof fetch;
  }

  it("loads, validates, and resolves featured assets independently", async () => {
    const catalog = makeFeaturedCatalogFixture();
    const fetcher = makeFetcher(
      new Response(JSON.stringify(catalog)),
    );
    const result = await loadSiteData({ configUrl, fetcher });

    expect(result.manifest.points).toHaveLength(8000);
    expect(result.featuredCatalog.featured_points).toHaveLength(5);
    expect(result.featuredAssetBaseUrl).toBe(
      "https://assets.example/",
    );
    expect(
      result.featuredAssetUrl(
        catalog.featured_points[0].media.video?.key ?? "",
      ),
    ).toBe(`https://assets.example/media/v1/featured/${HASH}.mp4`);
    expect(result.warnings).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledWith(
      new URL(featuredCatalogUrl),
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("fails soft when the configured featured document is unavailable", async () => {
    const result = await loadSiteData({
      configUrl,
      fetcher: makeFetcher(
        new Response("not published", { status: 404 }),
      ),
    });

    expect(result.manifest.points).toHaveLength(8000);
    expect(result.featuredCatalog.featured_points).toEqual([]);
    expect(result.featuredCatalog.neighborhoods).toEqual([]);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[1]).toContain("Featured off-grid data");
  });
});
