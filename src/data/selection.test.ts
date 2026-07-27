import { describe, expect, it } from "vitest";

import {
  readSelectionFromUrl,
  sameSelection,
  selectionKey,
  writeSelectionToUrl,
} from "./selection";

const coarseIds = new Set(["triple_00075", "triple_01608"]);
const featuredIds = new Set([
  "preclassification_sobol_triple_00075",
  "reference_triple_original",
]);

describe("parameter selection URLs", () => {
  it("keeps canonical and colliding featured identities separate", () => {
    expect(
      readSelectionFromUrl(
        new URL("https://example.test/?point=triple_00075"),
        coarseIds,
        featuredIds,
      ),
    ).toEqual({ kind: "coarse", id: "triple_00075" });
    expect(
      readSelectionFromUrl(
        new URL(
          "https://example.test/?featured=preclassification_sobol_triple_00075",
        ),
        coarseIds,
        featuredIds,
      ),
    ).toEqual({
      kind: "featured",
      id: "preclassification_sobol_triple_00075",
    });
  });

  it("gives a valid featured selection precedence over point", () => {
    expect(
      readSelectionFromUrl(
        new URL(
          "https://example.test/?point=triple_00075&featured=reference_triple_original",
        ),
        coarseIds,
        featuredIds,
      ),
    ).toEqual({ kind: "featured", id: "reference_triple_original" });
  });

  it("does not fall through to a coarse point when featured is invalid", () => {
    expect(
      readSelectionFromUrl(
        new URL(
          "https://example.test/?featured=canonical-linked-feature&point=triple_01608",
        ),
        coarseIds,
        featuredIds,
      ),
    ).toBeNull();
  });

  it("writes exactly one collision-proof query parameter", () => {
    const coarseUrl = writeSelectionToUrl(
      new URL(
        "https://example.test/?featured=reference_triple_original&point=old",
      ),
      { kind: "coarse", id: "triple_01608" },
    );
    expect(coarseUrl.search).toBe("?point=triple_01608");

    const featuredUrl = writeSelectionToUrl(coarseUrl, {
      kind: "featured",
      id: "reference_triple_original",
    });
    expect(featuredUrl.search).toBe(
      "?featured=reference_triple_original",
    );
  });

  it("provides stable keys and equality", () => {
    const selection = {
      kind: "featured" as const,
      id: "reference_triple_original",
    };
    expect(selectionKey(selection)).toBe(
      "featured:reference_triple_original",
    );
    expect(sameSelection(selection, { ...selection })).toBe(true);
    expect(
      sameSelection(selection, {
        kind: "coarse",
        id: "reference_triple_original",
      }),
    ).toBe(false);
  });
});
