import { describe, expect, it } from "vitest";
import bundledManifest from "../../public/data/site-manifest.json";
import {
  getRefinementCatalogSemanticIssues,
  getReviewOverlaySemanticIssues,
} from "./semantics";
import {
  validateRefinementCatalog,
  validateReviewOverlay,
} from "./validators";
import type {
  RefinementCatalog,
  ReviewOverlay,
  SiteManifest,
} from "./types";

const manifest = bundledManifest as unknown as SiteManifest;
const unresolvedPoint = manifest.points.find(
  (point) => point.classification === "dynamics_unresolved",
);

if (!unresolvedPoint) {
  throw new Error("The bundled manifest must include an unresolved point");
}

const emptyReviewOverlay: ReviewOverlay = {
  schema_version: 1,
  dataset_id: manifest.dataset_id,
  reviews: [],
};

const emptyRefinementCatalog: RefinementCatalog = {
  schema_version: 1,
  dataset_id: manifest.dataset_id,
  neighborhoods: [],
};

describe("public overlay text safety", () => {
  it("accepts valid empty review and refinement documents", () => {
    expect(
      getReviewOverlaySemanticIssues(emptyReviewOverlay, manifest),
    ).toEqual([]);
    expect(
      getRefinementCatalogSemanticIssues(emptyRefinementCatalog, manifest),
    ).toEqual([]);
  });

  it("rejects private paths in review notes", () => {
    const overlay: ReviewOverlay = {
      ...emptyReviewOverlay,
      reviews: [
        {
          point_id: unresolvedPoint.id,
          status: "self_replicator",
          notes: [
            "Reviewed from C:",
            "Users",
            "Analyst",
            "private-run.json",
          ].join("\\"),
        },
      ],
    };

    expect(getReviewOverlaySemanticIssues(overlay, manifest)).toContain(
      "review overlay contains a forbidden private-path or secret pattern",
    );
  });

  it("rejects private paths in review asset source metadata", () => {
    const overlay: ReviewOverlay = {
      ...emptyReviewOverlay,
      reviews: [
        {
          point_id: unresolvedPoint.id,
          status: "self_replicator",
          media: {
            parameters: {
              key: "repro/v1/triple_00000/parameters.json",
              sha256: "0".repeat(64),
              bytes: 1,
              source: [
                "",
                "n",
                "home",
                "researcher",
                "private",
                "parameters.json",
              ].join("/"),
            },
          },
        },
      ],
    };

    expect(getReviewOverlaySemanticIssues(overlay, manifest)).toContain(
      "review overlay contains a forbidden private-path or secret pattern",
    );
  });

  it("rejects private paths in refinement asset source metadata", () => {
    const catalog: RefinementCatalog = {
      ...emptyRefinementCatalog,
      neighborhoods: [
        {
          id: "refinement-safe-id",
          center_point_id: unresolvedPoint.id,
          axes: {
            m_local: [unresolvedPoint.coordinates.m_local],
            m_cross: [unresolvedPoint.coordinates.m_cross],
            alpha: [unresolvedPoint.coordinates.alpha],
          },
          shared_media: {
            parameters: {
              key: "repro/v1/triple_00000/parameters.json",
              sha256: "0".repeat(64),
              bytes: 1,
              source: [
                "",
                "n",
                "netscratch",
                "researcher",
                "private",
                "parameters.json",
              ].join("/"),
            },
          },
          samples: [],
        },
      ],
    };

    expect(getRefinementCatalogSemanticIssues(catalog, manifest)).toContain(
      "refinement catalog contains a forbidden private-path or secret pattern",
    );
  });

  it("rejects multiple refinement neighborhoods for one center", () => {
    const neighborhood = {
      id: "first",
      center_point_id: unresolvedPoint.id,
      axes: {
        m_local: [unresolvedPoint.coordinates.m_local],
        m_cross: [unresolvedPoint.coordinates.m_cross],
        alpha: [unresolvedPoint.coordinates.alpha],
      },
      samples: [],
    };
    const catalog: RefinementCatalog = {
      ...emptyRefinementCatalog,
      neighborhoods: [
        neighborhood,
        {
          ...neighborhood,
          id: "second",
        },
      ],
    };

    expect(getRefinementCatalogSemanticIssues(catalog, manifest)).toContain(
      `duplicate refinement center ${unresolvedPoint.id}`,
    );
  });
});

describe("auxiliary asset-base validation", () => {
  it.each([
    "http://assets.example",
    "https://exa mple.com",
    "https://example.com:bad/assets",
    "https:///assets.example/data",
    "https://example.com/assets?token=public",
    "https://example.com/assets#fragment",
    "not-a-url",
  ])("rejects unsafe review asset base %s", (assetBaseUrl) => {
    expect(
      validateReviewOverlay({
        ...emptyReviewOverlay,
        asset_base_url: assetBaseUrl,
      }),
    ).toBe(false);
  });

  it("accepts an empty inherited base and a clean HTTPS base", () => {
    expect(
      validateReviewOverlay({
        ...emptyReviewOverlay,
        asset_base_url: "",
      }),
    ).toBe(true);
    expect(
      validateRefinementCatalog({
        ...emptyRefinementCatalog,
        asset_base_url: "https://assets.example/lenia",
      }),
    ).toBe(true);
  });
});
