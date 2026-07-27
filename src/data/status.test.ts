import { describe, expect, it } from "vitest";
import { deriveDisplayStatus } from "./status";
import type { ReviewOverlay, SitePoint } from "./types";

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
});
