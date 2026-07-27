import { describe, expect, it, vi } from "vitest";
import bundledManifest from "../../public/data/site-manifest.json";
import { loadSiteData } from "./loader";
import { getManifestSemanticIssues } from "./semantics";
import type { SiteManifest } from "./types";
import { validateSiteManifest } from "./validators";

const manifest = bundledManifest as unknown as SiteManifest;

describe("bundled manifest contract", () => {
  it("passes the strict handoff schema and semantic invariants", () => {
    expect(
      validateSiteManifest(manifest),
      JSON.stringify(validateSiteManifest.errors),
    ).toBe(true);
    expect(getManifestSemanticIssues(manifest)).toEqual([]);
  });
});

describe("loadSiteData fallback", () => {
  it("keeps the site usable when primary and optional documents fail", async () => {
    const configUrl =
      "https://winstonwwang.github.io/Lenia_Self_Replication_Parameter_Space_Viewer/site-config.json";
    const config = {
      schema_version: 1,
      manifest_pointer_url:
        "https://assets.example/manifests/latest.json",
      fallback_manifest_url: "./data/site-manifest.json",
      fallback_asset_base_url: "./",
      review_overlay_url: "./data/review-overlay.json",
      refinement_catalog_url: "./data/refinement-catalog.json",
      refresh_interval_seconds: 300,
    };
    const manifestText = JSON.stringify(manifest);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === configUrl) {
        return new Response(JSON.stringify(config));
      }
      if (url === config.manifest_pointer_url) {
        return new Response("not published", { status: 404 });
      }
      if (url.endsWith("/data/site-manifest.json")) {
        return new Response(manifestText);
      }
      if (url.endsWith("/data/review-overlay.json")) {
        return new Response(
          JSON.stringify({
            schema_version: 1,
            dataset_id: "wrong-dataset",
            reviews: [],
          }),
        );
      }
      if (url.endsWith("/data/refinement-catalog.json")) {
        return new Response(
          JSON.stringify({
            schema_version: 1,
            dataset_id: manifest.dataset_id,
            neighborhoods: [],
          }),
        );
      }
      return new Response("missing", { status: 404 });
    }) as unknown as typeof fetch;

    const result = await loadSiteData({ configUrl, fetcher });

    expect(result.source).toBe("fallback");
    expect(result.manifest.points).toHaveLength(8000);
    expect(result.reviewOverlay.reviews).toEqual([]);
    expect(result.refinementCatalog.neighborhoods).toEqual([]);
    expect(result.assetBaseUrl).toBe(
      "https://winstonwwang.github.io/Lenia_Self_Replication_Parameter_Space_Viewer/",
    );
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain("bundled snapshot");
    expect(result.warnings[1]).toContain("Manual review data");
  });
});
