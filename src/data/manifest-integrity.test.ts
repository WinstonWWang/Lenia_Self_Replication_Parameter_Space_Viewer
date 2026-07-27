import { describe, expect, it, vi } from "vitest";
import bundledManifest from "../../public/data/site-manifest.json";
import bundledManifestText from "../../public/data/site-manifest.json?raw";
import { loadSiteData } from "./loader";
import {
  assertCanonicalManifestIntegrity,
  ManifestIntegrityError,
} from "./manifest-integrity";
import type { SiteManifest } from "./types";

const manifest = bundledManifest as unknown as SiteManifest;

describe("canonical manifest integrity", () => {
  it("accepts the publisher-canonical bundled manifest", async () => {
    await expect(
      assertCanonicalManifestIntegrity(
        bundledManifestText,
        manifest.manifest_sha256,
        manifest.manifest_sha256,
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects content tampering that leaves the declared digest unchanged", async () => {
    const tampered = bundledManifestText.replace(
      '"dataset_id":"product-lenia-mlocal-mcross-alpha-v1"',
      '"dataset_id":"tampered-lenia-mlocal-mcross-alpha-v1"',
    );
    expect(tampered).not.toBe(bundledManifestText);

    await expect(
      assertCanonicalManifestIntegrity(
        tampered,
        manifest.manifest_sha256,
        manifest.manifest_sha256,
      ),
    ).rejects.toThrow(
      new ManifestIntegrityError(
        "Live site manifest content does not match its declared digest",
      ),
    );
  });

  it("rejects a pointer digest that differs from the manifest", async () => {
    const otherDigest = "0".repeat(64);

    await expect(
      assertCanonicalManifestIntegrity(
        bundledManifestText,
        manifest.manifest_sha256,
        otherDigest,
      ),
    ).rejects.toThrow("does not match its pointer");
  });

  it("makes the remote loader fall back when canonical content is tampered", async () => {
    const configUrl =
      "https://winstonwwang.github.io/Lenia_Self_Replication_Parameter_Space_Viewer/site-config.json";
    const pointerUrl = "https://assets.example/manifests/latest.json";
    const snapshotUrl = `https://assets.example/manifests/snapshots/${manifest.manifest_sha256}.json`;
    const tampered = bundledManifestText.replace(
      '"generated_at":"2026-',
      '"generated_at":"2025-',
    );
    expect(tampered).not.toBe(bundledManifestText);

    const config = {
      schema_version: 1,
      manifest_pointer_url: pointerUrl,
      fallback_manifest_url: "./data/site-manifest.json",
      fallback_asset_base_url: "./",
      refresh_interval_seconds: 300,
    };
    const pointer = {
      schema_version: 1,
      published_at: manifest.generated_at,
      manifest_key: `manifests/snapshots/${manifest.manifest_sha256}.json`,
      manifest_sha256: manifest.manifest_sha256,
      manifest_bytes: new TextEncoder().encode(tampered).length,
      manifest_content_encoding: "identity",
      manifest_object_sha256: "0".repeat(64),
      manifest_object_bytes: new TextEncoder().encode(tampered).length,
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === configUrl) return new Response(JSON.stringify(config));
      if (url === pointerUrl) return new Response(JSON.stringify(pointer));
      if (url === snapshotUrl) return new Response(tampered);
      if (url.endsWith("/data/site-manifest.json")) {
        return new Response(bundledManifestText);
      }
      return new Response("missing", { status: 404 });
    }) as unknown as typeof fetch;

    const result = await loadSiteData({ configUrl, fetcher });

    expect(result.source).toBe("fallback");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(
      "content does not match its declared digest",
    );
  });
});
