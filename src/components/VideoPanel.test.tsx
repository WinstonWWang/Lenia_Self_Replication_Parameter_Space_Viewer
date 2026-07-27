import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VideoAsset } from "../data";
import { VideoPanel } from "./VideoPanel";

const squareVideo: VideoAsset = {
  key: "media/v1/test/replay.mp4",
  sha256: "a".repeat(64),
  bytes: 100,
  width: 800,
  height: 800,
  frames: 1001,
  fps: 30,
  scored_updates: 800,
  replay_updates: 1000,
};

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("VideoPanel", () => {
  it("uses the published video aspect ratio and contains the full centered frame", () => {
    const { container } = render(
      <VideoPanel
        asset={squareVideo}
        src="https://assets.example/replay.mp4"
        selectionKey="triple_01608"
      />,
    );

    const frame = container.querySelector(".video-panel__frame");
    const video = screen.getByLabelText("Lenia dynamics replay");

    expect(frame).toHaveStyle({ aspectRatio: "800 / 800" });
    expect(getComputedStyle(video).objectFit).toBe("contain");
    expect(["center center", "50% 50%"]).toContain(
      getComputedStyle(video).objectPosition,
    );
  });
});
