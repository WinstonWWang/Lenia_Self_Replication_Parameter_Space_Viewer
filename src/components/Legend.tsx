import type { DisplayStatus } from "../data";

const LEGEND_ITEMS: ReadonlyArray<{
  status: DisplayStatus;
  className: string;
  label: string;
}> = [
  {
    status: "self_replicator",
    className: "self-replicator",
    label: "Self-replicator",
  },
  { status: "unresolved", className: "unresolved", label: "Unresolved" },
  {
    status: "experimentally_dead",
    className: "experimentally-dead",
    label: "Experimentally dead",
  },
  {
    status: "physically_uninteresting",
    className: "physically-uninteresting",
    label: "Physically uninteresting",
  },
] as const;

export interface LegendProps {
  visibleStatuses: ReadonlySet<DisplayStatus>;
  onToggle: (status: DisplayStatus) => void;
  showRefinementToggle?: boolean;
  replicatorVariationsOnly?: boolean;
  onToggleReplicatorVariations?: () => void;
}

export function Legend({
  visibleStatuses,
  onToggle,
  showRefinementToggle = false,
  replicatorVariationsOnly = false,
  onToggleReplicatorVariations,
}: LegendProps) {
  return (
    <aside className="viewer-legend" aria-label="Point status legend">
      <h2>Status · click to filter</h2>
      <ul>
        {LEGEND_ITEMS.map(({ status, className, label }) => (
          <li key={status}>
            <button
              type="button"
              aria-pressed={visibleStatuses.has(status)}
              onClick={() => onToggle(status)}
            >
              <span
                className={`viewer-legend__swatch viewer-legend__swatch--${className}`}
                aria-hidden="true"
              />
              <span>{label}</span>
            </button>
          </li>
        ))}
      </ul>
      {showRefinementToggle && onToggleReplicatorVariations && (
        <div className="viewer-legend__refinement">
          <h3>Local variations</h3>
          <button
            className="viewer-legend__variation-toggle"
            type="button"
            aria-label="Show only self-replicating variations"
            aria-pressed={replicatorVariationsOnly}
            onClick={onToggleReplicatorVariations}
          >
            <span className="viewer-legend__switch" aria-hidden="true" />
            <span>Replicators only</span>
          </button>
        </div>
      )}
    </aside>
  );
}
