import type {
  DisplayStatus,
  FeaturedCatalog,
  ReviewOverlay,
  SiteManifest,
} from "../data";

import { SliceThumbnail } from "./SliceThumbnail";

export interface AlphaSidebarProps {
  manifest: SiteManifest;
  reviewOverlay: ReviewOverlay;
  selectedAlphaIndex: number | null;
  isLocalMode?: boolean;
  visibleStatuses?: ReadonlySet<DisplayStatus>;
  featuredCatalog?: FeaturedCatalog | null;
  onSelectAlpha: (alphaIndex: number | null) => void;
}

const formatAlpha = (value: number): string =>
  value.toFixed(3).replace(/\.?0+$/, "");

export function AlphaSidebar({
  manifest,
  reviewOverlay,
  selectedAlphaIndex,
  isLocalMode = false,
  visibleStatuses,
  featuredCatalog,
  onSelectAlpha,
}: AlphaSidebarProps) {
  const isFullCubeSelected =
    selectedAlphaIndex === null && !isLocalMode;
  return (
    <aside className="alpha-sidebar" aria-labelledby="alpha-sidebar-title">
      <h2 id="alpha-sidebar-title" className="alpha-sidebar__title">
        α slices
      </h2>
      <div className="alpha-sidebar__list" role="list">
        <div className="alpha-sidebar__item" role="listitem">
          <button
            className={`alpha-slice-button alpha-slice-button--full ${
              isFullCubeSelected ? "is-selected" : ""
            }`}
            type="button"
            aria-pressed={isFullCubeSelected}
            aria-label="Show the full parameter cube"
            onClick={() => onSelectAlpha(null)}
          >
            <span className="alpha-slice-button__label">Full cube</span>
            <span
              className="alpha-slice-button__blank-thumbnail"
              aria-hidden="true"
            />
          </button>
        </div>

        {manifest.axes.alpha.values.map((alpha, alphaIndex) => {
          const isSelected = selectedAlphaIndex === alphaIndex;
          const label = `α = ${formatAlpha(alpha)}`;

          return (
            <div
              className="alpha-sidebar__item"
              role="listitem"
              key={`${alphaIndex}-${alpha}`}
            >
              <button
                className={`alpha-slice-button ${
                  isSelected ? "is-selected" : ""
                }`}
                type="button"
                aria-pressed={isSelected}
                aria-label={`Show alpha slice ${formatAlpha(alpha)}`}
                onClick={() => onSelectAlpha(alphaIndex)}
              >
                <span className="alpha-slice-button__label">{label}</span>
                <SliceThumbnail
                  manifest={manifest}
                  reviewOverlay={reviewOverlay}
                  alphaIndex={alphaIndex}
                  visibleStatuses={visibleStatuses}
                  featuredCatalog={featuredCatalog}
                />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
