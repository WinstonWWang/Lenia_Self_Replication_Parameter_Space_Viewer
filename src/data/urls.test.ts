import { describe, expect, it } from "vitest";
import {
  resolveAssetUrl,
  resolveConfiguredUrl,
  resolveSnapshotUrl,
} from "./urls";

const DIGEST = "a".repeat(64);

describe("provider-neutral URL resolution", () => {
  it("keeps fallback assets beneath the GitHub Pages project path", () => {
    const configUrl =
      "https://winstonwwang.github.io/Lenia_Self_Replication_Parameter_Space_Viewer/site-config.json";
    const base = resolveConfiguredUrl("./", configUrl);
    expect(
      resolveAssetUrl(
        `media/v1/triple_00503/top_1/${DIGEST}.png`,
        base,
      ),
    ).toBe(
      `https://winstonwwang.github.io/Lenia_Self_Replication_Parameter_Space_Viewer/media/v1/triple_00503/top_1/${DIGEST}.png`,
    );
  });

  it("resolves a snapshot from the object root without duplicating manifests", () => {
    const pointer =
      "https://huggingface.co/datasets/example/lenia/resolve/main/manifests/latest.json";
    expect(
      resolveSnapshotUrl(
        pointer,
        `manifests/snapshots/${DIGEST}.json`,
      ).href,
    ).toBe(
      `https://huggingface.co/datasets/example/lenia/resolve/main/manifests/snapshots/${DIGEST}.json`,
    );
  });

  it.each([
    "../secret.json",
    "media/v1/../secret.json",
    "media/v1/%2e%2e/secret.json",
    "/media/v1/asset.png",
    "media\\v1\\asset.png",
    "https://evil.example/media/v1/asset.png",
  ])("rejects unsafe asset key %s", (key) => {
    expect(() =>
      resolveAssetUrl(key, "https://assets.example/data/"),
    ).toThrow();
  });
});
