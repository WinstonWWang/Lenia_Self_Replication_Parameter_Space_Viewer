import { useId, useState, type FormEvent } from "react";

import {
  findExactFeaturedPoint,
  findFeaturedPointByName,
  parseParameterTriple,
  snapToNearestTestedPoint,
  type FeaturedPoint,
  type ParameterCoordinates,
  type SiteManifest,
  type SitePoint,
} from "../data";

export interface SearchBarProps {
  manifest: SiteManifest;
  onSelect: (point: SitePoint) => void;
  featuredPoints?: readonly FeaturedPoint[];
  onSelectFeatured?: (point: FeaturedPoint) => void;
  disabled?: boolean;
}

const formatParameter = (value: number): string =>
  value.toFixed(5).replace(/\.?0+$/, "");

const formatTriple = (
  coordinates: ParameterCoordinates,
  exact = false,
): string => {
  const { m_local: mLocal, m_cross: mCross, alpha } = coordinates;
  const format = exact ? String : formatParameter;
  return `(${format(mLocal)}, ${format(mCross)}, ${format(alpha)})`;
};

export function SearchBar({
  manifest,
  onSelect,
  featuredPoints = [],
  onSelectFeatured,
  disabled = false,
}: SearchBarProps) {
  const inputId = useId();
  const hintId = useId();
  const messageId = useId();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const offGridFeatured = featuredPoints.filter(
    (point) => point.coarse_point_id === undefined,
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const featuredSuggestions =
    normalizedQuery && !parseParameterTriple(query)
      ? offGridFeatured
          .filter(
            (point) =>
              point.display_label
                .toLocaleLowerCase()
                .includes(normalizedQuery) ||
              point.id.toLocaleLowerCase().includes(normalizedQuery),
          )
          .slice(0, 5)
      : [];

  const selectFeatured = (point: FeaturedPoint) => {
    if (!onSelectFeatured) return;
    onSelectFeatured(point);
    setQuery(formatTriple(point.coordinates, true));
    setError(null);
    setFeedback(
      `Selected Featured off-grid ${point.display_label} at exact coordinates ${formatTriple(point.coordinates, true)}.`,
    );
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const namedFeatured = findFeaturedPointByName(offGridFeatured, query);
    if (namedFeatured && onSelectFeatured) {
      selectFeatured(namedFeatured);
      return;
    }

    const parsed = parseParameterTriple(query);
    if (!parsed) {
      setFeedback(null);
      setError(
        "Enter a featured label or three finite numbers separated by commas, for example (0.5, 3.2, 0.75).",
      );
      return;
    }

    const exactFeatured = findExactFeaturedPoint(offGridFeatured, parsed);
    if (exactFeatured && onSelectFeatured) {
      selectFeatured(exactFeatured);
      return;
    }

    if (manifest.points.length === 0) {
      setFeedback(null);
      setError("No parameter points are available to search.");
      return;
    }

    const result = snapToNearestTestedPoint(manifest, parsed);
    onSelect(result.point);
    setError(null);
    setFeedback(
      `Snapped to tested point ${formatTriple(result.point.coordinates)} — ${result.point.id}${
        result.wasSnapped ? "." : " (the entered triple was already on the grid)."
      }`,
    );
  };

  const describedBy = error || feedback
    ? `${hintId} ${messageId}`
    : hintId;

  return (
    <form
      className="parameter-search"
      role="search"
      aria-label="Search the parameter space"
      onSubmit={handleSubmit}
    >
      <label className="parameter-search__label" htmlFor={inputId}>
        Find a parameter triple
      </label>
      <div className="parameter-search__controls">
        <input
          id={inputId}
          className="parameter-search__input"
          name="parameter-triple"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder="(m_l, m_c, alpha)"
          value={query}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          disabled={disabled}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setError(null);
            setFeedback(null);
          }}
        />
        <button
          className="parameter-search__submit"
          type="submit"
          disabled={
            disabled ||
            (manifest.points.length === 0 && offGridFeatured.length === 0)
          }
        >
          Search
        </button>
      </div>
      {featuredSuggestions.length > 0 ? (
        <ul
          className="parameter-search__results"
          aria-label="Featured parameter results"
        >
          {featuredSuggestions.map((point) => (
            <li key={point.id}>
              <button
                type="button"
                disabled={disabled || !onSelectFeatured}
                onClick={() => selectFeatured(point)}
                aria-label={`Select featured off-grid ${point.display_label}`}
              >
                <span>{point.display_label}</span>
                <strong>Featured off-grid</strong>
                <small>{formatTriple(point.coordinates, true)}</small>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <span id={hintId} className="parameter-search__hint">
        Enter a featured label or (m<sub>ℓ</sub>, m<sub>c</sub>, α). Exact
        featured coordinates are selected before coarse-grid snapping.
      </span>
      {(error || feedback) && (
        <span
          id={messageId}
          className={`parameter-search__message ${
            error
              ? "parameter-search__message--error"
              : "parameter-search__message--success"
          }`}
          role={error ? "alert" : "status"}
          aria-live={error ? "assertive" : "polite"}
        >
          {error ?? feedback}
        </span>
      )}
    </form>
  );
}
