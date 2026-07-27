import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FeaturedPoint, SiteManifest } from "../data";
import { SearchBar } from "./SearchBar";

afterEach(cleanup);

const featuredPoint = {
  id: "preclassification_sobol_triple_00075",
  display_label: "triple_00075",
  coordinates: {
    m_local: 0.3152100145816803,
    m_cross: 0.17585211992263794,
    alpha: 0.7561357617378235,
  },
} as FeaturedPoint;

const manifest = {
  points: [
    {
      id: "triple_00075",
      coordinates: {
        m_local: 0,
        m_cross: 0,
        alpha: 0,
      },
    },
  ],
} as SiteManifest;

describe("SearchBar featured selections", () => {
  it("labels a colliding historical name as Featured off-grid and selects its namespaced ID", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onSelectFeatured = vi.fn();
    render(
      <SearchBar
        manifest={manifest}
        featuredPoints={[featuredPoint]}
        onSelect={onSelect}
        onSelectFeatured={onSelectFeatured}
      />,
    );

    const input = screen.getByRole("textbox", {
      name: "Find a parameter triple",
    });
    await user.type(input, "triple_00075");
    expect(
      screen.getByRole("button", {
        name: "Select featured off-grid triple_00075",
      }),
    ).toHaveTextContent("Featured off-grid");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(onSelectFeatured).toHaveBeenCalledWith(featuredPoint);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "0.3152100145816803",
    );
    expect(
      screen.queryByLabelText("Featured parameter results"),
    ).not.toBeInTheDocument();
  });

  it("selects exact featured coordinates before coarse-grid snapping", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onSelectFeatured = vi.fn();
    render(
      <SearchBar
        manifest={manifest}
        featuredPoints={[featuredPoint]}
        onSelect={onSelect}
        onSelectFeatured={onSelectFeatured}
      />,
    );

    await user.type(
      screen.getByRole("textbox", {
        name: "Find a parameter triple",
      }),
      "(0.3152100145816803, 0.17585211992263794, 0.7561357617378235)",
    );
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(onSelectFeatured).toHaveBeenCalledWith(featuredPoint);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
