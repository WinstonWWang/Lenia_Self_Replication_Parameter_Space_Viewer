import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AlphaSidebar } from "./components/AlphaSidebar";
import { CubeViewer } from "./components/CubeViewer";
import { DetailPanel } from "./components/DetailPanel";
import { DynamicsDrawer } from "./components/DynamicsDrawer";
import { FeaturedDetailPanel } from "./components/FeaturedDetailPanel";
import { Legend } from "./components/Legend";
import { SearchBar } from "./components/SearchBar";
import {
  deriveDisplayStatus,
  findFeaturedNeighborhood,
  findFeaturedPointForCoarsePoint,
  findPointReview,
  findRefinementNeighborhood,
  loadSiteData,
  readSelectionFromUrl,
  visibleOffGridFeaturedPoints,
  writeSelectionToUrl,
  type DisplayStatus,
  type FeaturedSample,
  type LoadedSiteData,
  type RefinementSample,
  type SelectedParameterPoint,
} from "./data";

const ALL_DISPLAY_STATUSES: readonly DisplayStatus[] = [
  "self_replicator",
  "unresolved",
  "experimentally_dead",
  "physically_uninteresting",
];

interface RuntimeState {
  data: LoadedSiteData | null;
  error: string | null;
}

function describeError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The parameter-space data could not be loaded.";
}

function updateSelectionQuery(
  selection: SelectedParameterPoint | null,
  mode: "push" | "replace" = "push",
) {
  const url = writeSelectionToUrl(
    new URL(window.location.href),
    selection,
  );
  window.history[mode === "push" ? "pushState" : "replaceState"](
    null,
    "",
    url,
  );
}

function useRuntimeData(): RuntimeState {
  const [state, setState] = useState<RuntimeState>({
    data: null,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let refreshTimer: number | undefined;
    let retryDelayMs = 10_000;

    const scheduleRefresh = (delayMs: number) => {
      if (!active) return;
      refreshTimer = window.setTimeout(refresh, delayMs);
    };

    const refresh = async () => {
      try {
        const data = await loadSiteData({ signal: controller.signal });
        if (!active) return;
        setState({ data, error: null });
        retryDelayMs = 10_000;
        scheduleRefresh(
          data.config.refresh_interval_seconds * 1000,
        );
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        setState((current) =>
          current.data
            ? current
            : { data: null, error: describeError(error) },
        );
        scheduleRefresh(retryDelayMs);
        retryDelayMs = Math.min(retryDelayMs * 2, 120_000);
      }
    };

    void refresh();
    return () => {
      active = false;
      controller.abort();
      if (refreshTimer !== undefined) {
        window.clearTimeout(refreshTimer);
      }
    };
  }, []);

  return state;
}

function LoadingView() {
  return (
    <main className="load-state" aria-live="polite">
      <div className="load-state__spinner" aria-hidden="true" />
      <h2>Loading the parameter space</h2>
      <p>Validating 8,000 tested grid points…</p>
    </main>
  );
}

function ErrorView({ message }: { message: string }) {
  return (
    <main className="load-state load-state--error" role="alert">
      <h2>The viewer could not start</h2>
      <p>{message}</p>
      <button type="button" onClick={() => window.location.reload()}>
        Try again
      </button>
    </main>
  );
}

export default function App() {
  const runtime = useRuntimeData();
  const data = runtime.data;
  const [selectedPoint, setSelectedPoint] =
    useState<SelectedParameterPoint | null>(null);
  const [selectedLocalSample, setSelectedLocalSample] = useState<
    RefinementSample | FeaturedSample | null
  >(null);
  const [hoveredPoint, setHoveredPoint] =
    useState<SelectedParameterPoint | null>(null);
  const [pinnedAlphaIndex, setPinnedAlphaIndex] = useState<number | null>(null);
  const [previewAlphaIndex, setPreviewAlphaIndex] = useState<number | null>(
    null,
  );
  const [localModeEnabled, setLocalModeEnabled] = useState(false);
  const [dynamicsOpen, setDynamicsOpen] = useState(false);
  const [visibleStatuses, setVisibleStatuses] = useState<
    Set<DisplayStatus>
  >(() => new Set(ALL_DISPLAY_STATUSES));
  const initializedFromUrl = useRef(false);

  const pointById = useMemo(
    () =>
      new Map(
        data?.manifest.points.map((point) => [point.id, point] as const) ?? [],
      ),
    [data?.manifest.points],
  );
  const featuredPointById = useMemo(
    () =>
      new Map(
        data?.featuredCatalog.featured_points
          .filter((point) => point.coarse_point_id === undefined)
          .map((point) => [point.id, point] as const) ?? [],
      ),
    [data?.featuredCatalog.featured_points],
  );
  const coarseIds = useMemo(
    () => new Set(pointById.keys()),
    [pointById],
  );
  const featuredIds = useMemo(
    () => new Set(featuredPointById.keys()),
    [featuredPointById],
  );
  const offGridFeaturedPoints = useMemo(
    () =>
      data
        ? visibleOffGridFeaturedPoints(data.featuredCatalog)
        : [],
    [data],
  );
  const selectedCoarsePoint =
    selectedPoint?.kind === "coarse"
      ? pointById.get(selectedPoint.id) ?? null
      : null;
  const selectedFeaturedPoint =
    selectedPoint?.kind === "featured"
      ? featuredPointById.get(selectedPoint.id) ?? null
      : null;
  const selectedLinkedFeaturedPoint =
    selectedCoarsePoint && data
      ? findFeaturedPointForCoarsePoint(
          data.featuredCatalog,
          selectedCoarsePoint.id,
        )
      : undefined;
  const selectedReview =
    selectedCoarsePoint && data
      ? findPointReview(data.reviewOverlay, selectedCoarsePoint.id)
      : undefined;
  const selectedRefinementNeighborhood =
    selectedCoarsePoint && data
      ? findRefinementNeighborhood(
          data.refinementCatalog,
          selectedCoarsePoint.id,
        )
      : undefined;
  const selectedLinkedFeaturedNeighborhood =
    selectedLinkedFeaturedPoint && data
      ? findFeaturedNeighborhood(
          data.featuredCatalog,
          selectedLinkedFeaturedPoint,
        )
      : undefined;
  const selectedNeighborhood =
    selectedRefinementNeighborhood ??
    selectedLinkedFeaturedNeighborhood;
  const selectedFeaturedNeighborhood =
    selectedFeaturedPoint && data
      ? findFeaturedNeighborhood(
          data.featuredCatalog,
          selectedFeaturedPoint,
        )
      : undefined;
  const selectedReplayPoint =
    selectedRefinementNeighborhood?.replay_source_point_id
    ? pointById.get(
        selectedRefinementNeighborhood.replay_source_point_id,
      )
    : undefined;
  const selectedReplayReview =
    selectedReplayPoint && data
      ? findPointReview(data.reviewOverlay, selectedReplayPoint.id)
      : undefined;

  const selectPoint = useCallback(
    (
      selection: SelectedParameterPoint,
      options: { clearSlice?: boolean; history?: "push" | "replace" } = {},
    ) => {
      const coarsePoint =
        selection.kind === "coarse"
          ? pointById.get(selection.id)
          : undefined;
      const featuredPoint =
        selection.kind === "featured"
          ? featuredPointById.get(selection.id)
          : undefined;
      if (!coarsePoint && !featuredPoint) return;
      const linkedFeaturedPoint =
        coarsePoint && data
          ? findFeaturedPointForCoarsePoint(
              data.featuredCatalog,
              coarsePoint.id,
            )
          : undefined;

      setSelectedPoint(selection);
      setSelectedLocalSample(null);
      setPreviewAlphaIndex(null);
      if (options.clearSlice) {
        setPinnedAlphaIndex(null);
      }
      const displayStatus: DisplayStatus = coarsePoint
        ? deriveDisplayStatus(
            coarsePoint,
            data
              ? findPointReview(data.reviewOverlay, coarsePoint.id)
              : undefined,
            data?.featuredCatalog,
          )
        : "self_replicator";
      setVisibleStatuses((current) => {
        if (current.has(displayStatus)) return current;
        const next = new Set(current);
        next.add(displayStatus);
        return next;
      });
      const hasNeighborhood =
        selection.kind === "coarse"
          ? Boolean(
              data &&
                (findRefinementNeighborhood(
                  data.refinementCatalog,
                  selection.id,
                ) ??
                  (linkedFeaturedPoint
                    ? findFeaturedNeighborhood(
                        data.featuredCatalog,
                        linkedFeaturedPoint,
                      )
                    : undefined)),
            )
          : Boolean(
              data &&
                findFeaturedNeighborhood(
                  data.featuredCatalog,
                  selection.id,
                ),
            );
      setLocalModeEnabled(
        displayStatus === "self_replicator" &&
          hasNeighborhood,
      );
      updateSelectionQuery(selection, options.history ?? "push");
    },
    [data, featuredPointById, pointById],
  );

  useEffect(() => {
    if (!data || initializedFromUrl.current) return;
    initializedFromUrl.current = true;
    const url = new URL(window.location.href);
    const selection = readSelectionFromUrl(url, coarseIds, featuredIds);
    if (selection) {
      selectPoint(selection, { clearSlice: true, history: "replace" });
    } else if (
      url.searchParams.has("point") ||
      url.searchParams.has("featured")
    ) {
      updateSelectionQuery(null, "replace");
    }
  }, [coarseIds, data, featuredIds, selectPoint]);

  useEffect(() => {
    if (!data) return;
    const handlePopState = () => {
      const url = new URL(window.location.href);
      const selection = readSelectionFromUrl(
        url,
        coarseIds,
        featuredIds,
      );
      if (selection) {
        selectPoint(selection, {
          clearSlice: true,
          history: "replace",
        });
      } else {
        setSelectedPoint(null);
        setSelectedLocalSample(null);
        setHoveredPoint(null);
        setLocalModeEnabled(false);
        if (
          url.searchParams.has("point") ||
          url.searchParams.has("featured")
        ) {
          updateSelectionQuery(null, "replace");
        }
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [coarseIds, data, featuredIds, selectPoint]);

  useEffect(() => {
    if (!selectedPoint) return;
    const stillAvailable =
      selectedPoint.kind === "coarse"
        ? pointById.has(selectedPoint.id)
        : featuredPointById.has(selectedPoint.id);
    if (stillAvailable) return;
    setSelectedPoint(null);
    setSelectedLocalSample(null);
    setHoveredPoint(null);
    setLocalModeEnabled(false);
    updateSelectionQuery(null, "replace");
  }, [featuredPointById, pointById, selectedPoint]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || dynamicsOpen) return;
      if (previewAlphaIndex !== null || pinnedAlphaIndex !== null) {
        setPreviewAlphaIndex(null);
        setPinnedAlphaIndex(null);
        setHoveredPoint(null);
      } else if (selectedLocalSample) {
        setSelectedLocalSample(null);
      } else if (localModeEnabled) {
        setLocalModeEnabled(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [
    dynamicsOpen,
    localModeEnabled,
    pinnedAlphaIndex,
    previewAlphaIndex,
    selectedLocalSample,
  ]);

  if (runtime.error) {
    return <ErrorView message={runtime.error} />;
  }
  if (!data) {
    return <LoadingView />;
  }

  const handleCubeSelect = (selection: SelectedParameterPoint) => {
    selectPoint(selection);
  };
  const handleAlphaSelect = (alphaIndex: number | null) => {
    setPinnedAlphaIndex(alphaIndex);
    setPreviewAlphaIndex(null);
    setHoveredPoint(null);
    setSelectedLocalSample(null);
    setLocalModeEnabled(false);
  };

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="site-header__identity">
          <p className="site-header__eyebrow">Cross-scale Lenia search</p>
          <h1>Lenia Self-Replication Parameter Space Viewer</h1>
          <p className="site-header__summary">
            {data.manifest.points.length.toLocaleString()} grid points +{" "}
            {offGridFeaturedPoints.length.toLocaleString()} exact off-grid
            replicators
          </p>
        </div>
        <SearchBar
          manifest={data.manifest}
          featuredPoints={offGridFeaturedPoints}
          onSelect={(point) =>
            selectPoint(
              { kind: "coarse", id: point.id },
              { clearSlice: true },
            )
          }
          onSelectFeatured={(point) =>
            selectPoint(
              { kind: "featured", id: point.id },
              { clearSlice: true },
            )
          }
        />
        <div className="site-header__data-state">
          <span
            className={`data-source data-source--${data.source}`}
            title={data.warnings.join("\n") || undefined}
          >
            {data.source === "remote" ? "Live snapshot" : "Bundled snapshot"}
          </span>
          {data.warnings.length > 0 ? (
            <details className="runtime-notice">
              <summary>{data.warnings.length} data notice</summary>
              <ul>
                {data.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </header>

      <main
        className={`viewer-layout ${
          selectedCoarsePoint || selectedFeaturedPoint
            ? "viewer-layout--selected"
            : ""
        }`}
      >
        <AlphaSidebar
          manifest={data.manifest}
          reviewOverlay={data.reviewOverlay}
          featuredCatalog={data.featuredCatalog}
          selectedAlphaIndex={pinnedAlphaIndex}
          isLocalMode={localModeEnabled}
          visibleStatuses={visibleStatuses}
          onSelectAlpha={handleAlphaSelect}
        />

        <section className="viewer-column" aria-label="Parameter-space viewer">
          <div className="viewer-card">
            <CubeViewer
              manifest={data.manifest}
              reviewOverlay={data.reviewOverlay}
              refinementCatalog={data.refinementCatalog}
              featuredCatalog={data.featuredCatalog}
              selectedPoint={selectedPoint}
              selectedLocalSample={selectedLocalSample}
              hoveredPoint={hoveredPoint}
              pinnedAlphaIndex={pinnedAlphaIndex}
              previewAlphaIndex={previewAlphaIndex}
              localModeEnabled={localModeEnabled}
              visibleStatuses={visibleStatuses}
              showLegend={false}
              onSelectPoint={handleCubeSelect}
              onSelectLocalSample={setSelectedLocalSample}
              onHoverPoint={setHoveredPoint}
              onPinnedAlphaChange={(alphaIndex) => {
                setPinnedAlphaIndex(alphaIndex);
                setPreviewAlphaIndex(null);
                setHoveredPoint(null);
                setSelectedLocalSample(null);
                setLocalModeEnabled(false);
              }}
              onPreviewAlphaChange={setPreviewAlphaIndex}
            />
            <Legend
              visibleStatuses={visibleStatuses}
              onToggle={(status) => {
                setHoveredPoint(null);
                setVisibleStatuses((current) => {
                  const next = new Set(current);
                  if (next.has(status)) next.delete(status);
                  else next.add(status);
                  return next;
                });
              }}
            />
            <p className="viewer-card__hint">
              {pinnedAlphaIndex === null
                ? "Drag to orbit · scroll to zoom · Shift-drag or right-drag to pan"
                : "Drag to pan · scroll to zoom · press Esc for the full cube"}
            </p>
          </div>
        </section>

        {selectedCoarsePoint ? (
          <DetailPanel
            point={selectedCoarsePoint}
            assetBaseUrl={data.assetBaseUrl}
            review={selectedReview}
            reviewAssetBaseUrl={data.reviewAssetBaseUrl}
            refinementSample={selectedLocalSample}
            refinementSharedMedia={selectedNeighborhood?.shared_media}
            refinementReplayPoint={selectedReplayPoint}
            refinementReplayReview={selectedReplayReview}
            refinementAssetBaseUrl={
              selectedRefinementNeighborhood
                ? data.refinementAssetBaseUrl
                : data.featuredAssetBaseUrl
            }
            confirmedSelfReplicator={Boolean(
              selectedLinkedFeaturedPoint,
            )}
            confirmedMedia={selectedLinkedFeaturedPoint?.media}
            confirmedMediaAssetBaseUrl={data.featuredAssetBaseUrl}
            scoreSemantics={data.manifest.score_semantics}
          />
        ) : selectedFeaturedPoint ? (
          <FeaturedDetailPanel
            point={selectedFeaturedPoint}
            assetBaseUrl={data.featuredAssetBaseUrl}
            neighborhood={selectedFeaturedNeighborhood}
            selectedSample={selectedLocalSample as FeaturedSample | null}
          />
        ) : null}
      </main>

      <button
        className="dynamics-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={dynamicsOpen}
        onClick={() => setDynamicsOpen(true)}
      >
        Dynamics
      </button>
      <DynamicsDrawer
        isOpen={dynamicsOpen}
        onClose={() => setDynamicsOpen(false)}
      />
    </div>
  );
}
