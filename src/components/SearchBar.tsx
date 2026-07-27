import { useId, useState, type FormEvent } from "react";

import {
  parseParameterTriple,
  snapToNearestTestedPoint,
  type SiteManifest,
  type SitePoint,
} from "../data";

export interface SearchBarProps {
  manifest: SiteManifest;
  onSelect: (point: SitePoint) => void;
  disabled?: boolean;
}

const formatParameter = (value: number): string =>
  value.toFixed(5).replace(/\.?0+$/, "");

const formatTriple = (point: SitePoint): string => {
  const { m_local: mLocal, m_cross: mCross, alpha } = point.coordinates;
  return `(${formatParameter(mLocal)}, ${formatParameter(mCross)}, ${formatParameter(alpha)})`;
};

export function SearchBar({
  manifest,
  onSelect,
  disabled = false,
}: SearchBarProps) {
  const inputId = useId();
  const hintId = useId();
  const messageId = useId();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const parsed = parseParameterTriple(query);
    if (!parsed) {
      setFeedback(null);
      setError(
        "Enter three finite numbers separated by commas, for example (0.5, 3.2, 0.75).",
      );
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
      `Snapped to tested point ${formatTriple(result.point)} — ${result.point.id}${
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
          disabled={disabled || manifest.points.length === 0}
        >
          Search
        </button>
      </div>
      <span id={hintId} className="parameter-search__hint">
        Enter (m<sub>ℓ</sub>, m<sub>c</sub>, α). The viewer selects the nearest
        tested grid point.
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
