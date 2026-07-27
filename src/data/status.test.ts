import { describe, expect, it } from "vitest";
import { deriveDisplayStatus } from "./status";
import type {
  FeaturedCatalog,
  ReviewOverlay,
  SitePoint,
} from "./types";

function point(
  classification: SitePoint["classification"],
  id = "triple_00400",
): SitePoint {
  return { id, classification } as SitePoint;
}

const selfReplicatorOverlay: ReviewOverlay = {
  schema_version: 1,
  dataset_id: "product-lenia-mlocal-mcross-alpha-v1",
  reviews: [
    {
      point_id: "triple_00400",
      status: "self_replicator",
    },
  ],
};

const linkedFeaturedCatalog = {
  schema_version: 1,
  dataset_id: "product-lenia-mlocal-mcross-alpha-v1",
  featured_points: [
    {
      id: "grid_triple_00400",
      coarse_point_id: "triple_00400",
      status: "self_replicator",
    },
  ],
  neighborhoods: [],
} as unknown as FeaturedCatalog;

describe("deriveDisplayStatus", () => {
  it("uses user-facing base labels", () => {
    expect(
      deriveDisplayStatus(point("excluded_by_m_local_cutoff")),
    ).toBe("physically_uninteresting");
    expect(deriveDisplayStatus(point("experimentally_dead"))).toBe(
      "experimentally_dead",
    );
    expect(deriveDisplayStatus(point("dynamics_unresolved"))).toBe(
      "unresolved",
    );
  });

  it("promotes only a matching unresolved point through manual review", () => {
    expect(
      deriveDisplayStatus(
        point("dynamics_unresolved"),
        selfReplicatorOverlay,
      ),
    ).toBe("self_replicator");
    expect(
      deriveDisplayStatus(
        point("dynamics_unresolved", "triple_00401"),
        selfReplicatorOverlay,
      ),
    ).toBe("unresolved");
    expect(
      deriveDisplayStatus(
        point("experimentally_dead"),
        selfReplicatorOverlay,
      ),
    ).toBe("experimentally_dead");
  });

  it("promotes a matching canonical point through the featured catalog", () => {
    expect(
      deriveDisplayStatus(
        point("dynamics_unresolved"),
        null,
        linkedFeaturedCatalog,
      ),
    ).toBe("self_replicator");
    expect(
      deriveDisplayStatus(
        point("dynamics_unresolved", "triple_00401"),
        null,
        linkedFeaturedCatalog,
      ),
    ).toBe("unresolved");
    expect(
      deriveDisplayStatus(
        point("experimentally_dead"),
        null,
        linkedFeaturedCatalog,
      ),
    ).toBe("experimentally_dead");
    expect(
      deriveDisplayStatus(
        point("excluded_by_m_local_cutoff"),
        null,
        linkedFeaturedCatalog,
      ),
    ).toBe("physically_uninteresting");
  });
});
