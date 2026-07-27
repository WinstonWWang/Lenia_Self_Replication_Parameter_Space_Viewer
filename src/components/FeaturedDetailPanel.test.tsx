import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  FeaturedNeighborhood,
  FeaturedPoint,
  FeaturedSample,
  InitialFieldAsset,
  PosterAsset,
  VideoAsset,
} from "../data";
import { FeaturedDetailPanel } from "./FeaturedDetailPanel";

afterEach(cleanup);

vi.mock("./VideoPanel", () => ({
  VideoPanel: ({
    src,
    posterSrc,
    placeholderMessage,
  }: {
    src?: string | null;
    posterSrc?: string | null;
    placeholderMessage?: string;
  }) => (
    <div
      data-testid="video-panel"
      data-src={src ?? ""}
      data-poster-src={posterSrc ?? ""}
    >
      {placeholderMessage}
    </div>
  ),
}));

vi.mock("./InitialFieldPanel", () => ({
  InitialFieldPanel: ({ src }: { src?: string | null }) => (
    <div data-testid="initial-field-panel" data-src={src ?? ""} />
  ),
}));

const video: VideoAsset = {
  key: "media/v1/featured/center.mp4",
  sha256: "a".repeat(64),
  bytes: 100,
  width: 256,
  height: 256,
  frames: 1000,
  fps: 30,
  scored_updates: 800,
  replay_updates: 1000,
};

const poster: PosterAsset = {
  key: "media/v1/featured/center.webp",
  sha256: "b".repeat(64),
  bytes: 100,
  width: 256,
  height: 256,
};

const initialField: InitialFieldAsset = {
  key: "repro/v1/featured/initial-field.npy",
  sha256: "c".repeat(64),
  bytes: 256 * 256 * 4,
  width: 256,
  height: 256,
  format: "npy",
};

function featuredPoint(): FeaturedPoint {
  return {
    id: "preclassification_sobol_triple_00075",
    display_label: "triple_00075",
    namespace: "preclassification_sobol",
    coordinates: {
      m_local: 0.3152100145816803,
      m_cross: 0.17585211992263794,
      alpha: 0.7561357617378235,
    },
    source_reported_coordinates: {
      m_local: 0.3152100224314431,
      m_cross: 0.175852116212991,
      alpha: 0.7561357617378235,
    },
    coordinate_semantics:
      "Applied coordinates are the float32 simulator parameters.",
    status: "self_replicator",
    reviewed_at: "2026-07-27T00:00:00Z",
    refinement_neighborhood_id: "featured-neighborhood-00075",
    media: {
      video,
      poster,
      parameters: null,
      initial_field: initialField,
    },
    search_result: {
      best_loss: 1.25,
      best_loss_prompt: -0.75,
      best_clip_score_prompt: 0.75,
      best_loss_softmax: 2.5,
      provenance: "Recovered from the original search report.",
    },
    score_warning: "Search score, not replication verification.",
    center_video_world_pixels: 256,
    refinement_simulation_world_pixels: 512,
    world_size_comparison_note:
      "The center replay and variation simulations used different worlds.",
  } as FeaturedPoint;
}

describe("FeaturedDetailPanel", () => {
  it("shows truthful off-grid metadata and resolves center assets", () => {
    render(
      <FeaturedDetailPanel
        point={featuredPoint()}
        assetBaseUrl="https://assets.example/featured/"
      />,
    );

    expect(screen.getByText("Featured off-grid")).toBeInTheDocument();
    expect(screen.getByText("Confirmed self-replicator")).toBeInTheDocument();
    expect(screen.getByText("0.3152100145816803")).toBeInTheDocument();
    expect(screen.getByText("0.3152100224314431")).toBeInTheDocument();
    expect(
      screen.getByText("Recovered from the original search report."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The center replay and variation simulations used different worlds.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("video-panel")).toHaveAttribute(
      "data-src",
      "https://assets.example/featured/media/v1/featured/center.mp4",
    );
    expect(screen.getByTestId("initial-field-panel")).toHaveAttribute(
      "data-src",
      "https://assets.example/featured/repro/v1/featured/initial-field.npy",
    );
  });

  it("does not inherit a center or shared video through explicit sample null", () => {
    const sample = {
      grid_index: [0, 0, 0],
      coordinates: {
        m_local: 0.314,
        m_cross: 0.174,
        alpha: 0.755,
      },
      status: "nonreplicator",
      scan_index: 1,
      variation_label: "variation_00001",
      media: { video: null },
    } as FeaturedSample;
    const neighborhood = {
      id: "featured-neighborhood-00075",
      center_featured_id: "preclassification_sobol_triple_00075",
      axes: {
        m_local: [0.314],
        m_cross: [0.174],
        alpha: [0.755],
      },
      shared_media: {
        video: {
          ...video,
          key: "media/v1/featured/shared.mp4",
        },
        initial_field: initialField,
      },
      samples: [sample],
    } as FeaturedNeighborhood;

    render(
      <FeaturedDetailPanel
        point={featuredPoint()}
        neighborhood={neighborhood}
        selectedSample={sample}
        assetBaseUrl="https://assets.example/featured/"
      />,
    );

    expect(screen.getByText("variation_00001")).toBeInTheDocument();
    expect(screen.getByText("Reviewed non-replicator")).toBeInTheDocument();
    expect(
      screen.getByText("No individual variation replay was generated"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("video-panel")).toHaveAttribute("data-src", "");
    expect(screen.getByTestId("video-panel")).toHaveAttribute(
      "data-poster-src",
      "",
    );
    expect(screen.getByTestId("initial-field-panel")).toHaveAttribute(
      "data-src",
      "https://assets.example/featured/repro/v1/featured/initial-field.npy",
    );
  });
});
