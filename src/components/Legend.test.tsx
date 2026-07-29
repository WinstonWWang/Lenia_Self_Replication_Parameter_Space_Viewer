import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DisplayStatus } from "../data";
import { Legend } from "./Legend";

afterEach(cleanup);

const visibleStatuses = new Set<DisplayStatus>([
  "self_replicator",
  "unresolved",
  "experimentally_dead",
  "physically_uninteresting",
]);

describe("Legend refinement filter", () => {
  it("keeps the refinement-only control out of the global legend", () => {
    render(
      <Legend
        visibleStatuses={visibleStatuses}
        onToggle={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", {
        name: "Show only self-replicating variations",
      }),
    ).not.toBeInTheDocument();
  });

  it("exposes an independent pressed toggle in a local refinement view", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onToggleReplicatorVariations = vi.fn();
    const { rerender } = render(
      <Legend
        visibleStatuses={visibleStatuses}
        onToggle={onToggle}
        showRefinementToggle
        replicatorVariationsOnly={false}
        onToggleReplicatorVariations={
          onToggleReplicatorVariations
        }
      />,
    );

    const refinementToggle = screen.getByRole("button", {
      name: "Show only self-replicating variations",
    });
    expect(refinementToggle).toHaveAttribute("aria-pressed", "false");
    await user.click(refinementToggle);
    expect(onToggleReplicatorVariations).toHaveBeenCalledOnce();
    expect(onToggle).not.toHaveBeenCalled();

    rerender(
      <Legend
        visibleStatuses={visibleStatuses}
        onToggle={onToggle}
        showRefinementToggle
        replicatorVariationsOnly
        onToggleReplicatorVariations={
          onToggleReplicatorVariations
        }
      />,
    );
    expect(refinementToggle).toHaveAttribute("aria-pressed", "true");
  });
});
