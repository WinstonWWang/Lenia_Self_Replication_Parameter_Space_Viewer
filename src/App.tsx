import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AlphaSidebar } from "./components/AlphaSidebar";
import { CubeViewer } from "./components/CubeViewer";
import { DetailPanel } from "./components/DetailPanel";
import { DynamicsDrawer } from "./components/DynamicsDrawer";
import { Legend } from "./components/Legend";
import { SearchBar } from "./components/SearchBar";
import {
  deriveDisplayStatus,
  findPointReview,
  findRefinementNeighborhood,
  loadSiteData,
  type DisplayStatus,
  type LoadedSiteData,
  type RefinementSample,
  type SitePoint,
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

function updatePointQuery(
  pointId: string | null,
  mode: "push" | "replace" = "push",
) {
  const url = new URL(window.location.href);
  if (pointId) {
    url.searchParams.set("point", pointId);
  } else {
    url.searchParams.delete("point");
  }
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
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [selectedRefinementSample, setSelectedRefinementSample] =
    useState<RefinementSample | null>(null);
  const [hoveredPointId, setHoveredPointId] = useState<string | null>(null);
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
  const selectedPoint = selectedPointId
    ? pointById.get(selectedPointId) ?? null
    : null;
  const selectedReview =
    selectedPoint && data
      ? findPointReview(data.reviewOverlay, selectedPoint.id)
      : undefined;
  const selectedNeighborhood =
    selectedPoint && data
      ? findRefinementNeighborhood(
          data.refinementCatalog,
          selectedPoint.id,
        )
      : undefined;
  const selectedReplayPoint = selectedNeighborhood?.replay_source_point_id
    ? pointById.get(selectedNeighborhood.replay_source_point_id)
    : undefined;
  const selectedReplayReview =
    selectedReplayPoint && data
      ? findPointReview(data.reviewOverlay, selectedReplayPoint.id)
      : undefined;

  const selectPoint = useCallback(
    (
      point: SitePoint,
      options: { clearSlice?: boolean; history?: "push" | "replace" } = {},
    ) => {
      setSelectedPointId(point.id);
      setSelectedRefinementSample(null);
      setPreviewAlphaIndex(null);
      if (options.clearSlice) {
        setPinnedAlphaIndex(null);
      }
      const review = data
        ? findPointReview(data.reviewOverlay, point.id)
        : undefined;
      const displayStatus = deriveDisplayStatus(point, review);
      setVisibleStatuses((current) => {
        if (current.has(displayStatus)) return current;
        const next = new Set(current);
        next.add(displayStatus);
        return next;
      });
      const hasNeighborhood = Boolean(
        data &&
          findRefinementNeighborhood(data.refinementCatalog, point.id),
      );
      setLocalModeEnabled(
        displayStatus === "self_replicator" &&
          hasNeighborhood,
      );
      updatePointQuery(point.id, options.history ?? "push");
    },
    [data],
  );

  useEffect(() => {
    if (!data || initializedFromUrl.current) return;
    initializedFromUrl.current = true;
    const pointId = new URL(window.location.href).searchParams.get("point");
    const point = pointId ? pointById.get(pointId) : undefined;
    if (point) {
      selectPoint(point, { clearSlice: true, history: "replace" });
    } else if (pointId) {
      updatePointQuery(null, "replace");
    }
  }, [data, pointById, selectPoint]);

  useEffect(() => {
    if (!data) return;
    const handlePopState = () => {
      const pointId = new URL(window.location.href).searchParams.get("point");
      const point = pointId ? pointById.get(pointId) : undefined;
      if (point) {
        selectPoint(point, { clearSlice: true, history: "replace" });
      } else {
        setSelectedPointId(null);
        setSelectedRefinementSample(null);
        setLocalModeEnabled(false);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [data, pointById, selectPoint]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || dynamicsOpen) return;
      if (previewAlphaIndex !== null || pinnedAlphaIndex !== null) {
        setPreviewAlphaIndex(null);
        setPinnedAlphaIndex(null);
      } else if (selectedRefinementSample) {
        setSelectedRefinementSample(null);
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
    selectedRefinementSample,
  ]);

  if (runtime.error) {
    return <ErrorView message={runtime.error} />;
  }
  if (!data) {
    return <LoadingView />;
  }

  const handleCubeSelect = (pointId: string) => {
    const point = pointById.get(pointId);
    if (point) selectPoint(point);
  };
  const handleAlphaSelect = (alphaIndex: number | null) => {
    setPinnedAlphaIndex(alphaIndex);
    setPreviewAlphaIndex(null);
    setSelectedRefinementSample(null);
    setLocalModeEnabled(false);
  };

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="site-header__identity">
          <p className="site-header__eyebrow">Cross-scale Lenia search</p>
          <h1>Lenia Self-Replication Parameter Space Viewer</h1>
          <p className="site-header__summary">
            20 × 20 × 20 grid · {data.manifest.points.length.toLocaleString()}{" "}
            parameter triples
          </p>
        </div>
        <SearchBar
          manifest={data.manifest}
          onSelect={(point) =>
            selectPoint(point, { clearSlice: true })
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
          selectedPoint ? "viewer-layout--selected" : ""
        }`}
      >
        <AlphaSidebar
          manifest={data.manifest}
          reviewOverlay={data.reviewOverlay}
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
              selectedPointId={selectedPointId}
              selectedRefinementSample={selectedRefinementSample}
              hoveredPointId={hoveredPointId}
              pinnedAlphaIndex={pinnedAlphaIndex}
              previewAlphaIndex={previewAlphaIndex}
              localModeEnabled={localModeEnabled}
              visibleStatuses={visibleStatuses}
              showLegend={false}
              onSelectPoint={handleCubeSelect}
              onSelectRefinementSample={setSelectedRefinementSample}
              onHoverPoint={setHoveredPointId}
              onPinnedAlphaChange={(alphaIndex) => {
                setPinnedAlphaIndex(alphaIndex);
                setPreviewAlphaIndex(null);
                setSelectedRefinementSample(null);
                setLocalModeEnabled(false);
              }}
              onPreviewAlphaChange={setPreviewAlphaIndex}
            />
            <Legend
              visibleStatuses={visibleStatuses}
              onToggle={(status) => {
                setHoveredPointId(null);
                setVisibleStatuses((current) => {
                  const next = new Set(current);
                  if (next.has(status)) next.delete(status);
                  else next.add(status);
                  return next;
                });
              }}
            />
            <p className="viewer-card__hint">
              Drag to orbit · scroll to zoom · Shift-drag or right-drag to pan
            </p>
          </div>
        </section>

        {selectedPoint ? (
          <DetailPanel
            point={selectedPoint}
            assetBaseUrl={data.assetBaseUrl}
            review={selectedReview}
            reviewAssetBaseUrl={data.reviewAssetBaseUrl}
            refinementSample={selectedRefinementSample}
            refinementSharedMedia={selectedNeighborhood?.shared_media}
            refinementReplayPoint={selectedReplayPoint}
            refinementReplayReview={selectedReplayReview}
            refinementAssetBaseUrl={data.refinementAssetBaseUrl}
            scoreSemantics={data.manifest.score_semantics}
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
