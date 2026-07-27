import { useEffect, useId, useRef } from "react";
import katex from "katex";

import { DYNAMICS_EQUATIONS } from "../science/equations";

export interface DynamicsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface KatexEquationProps {
  equation: string;
}

function KatexEquation({ equation }: KatexEquationProps) {
  const equationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = equationRef.current;
    if (!element) {
      return;
    }

    katex.render(equation, element, {
      displayMode: true,
      output: "htmlAndMathml",
      strict: "warn",
      throwOnError: false,
      trust: false,
    });
  }, [equation]);

  return <div className="dynamics-drawer__equation" ref={equationRef} />;
}

export function DynamicsDrawer({
  isOpen,
  onClose,
}: DynamicsDrawerProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusableElements?.length) {
        event.preventDefault();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="dynamics-drawer" data-testid="dynamics-drawer">
      <button
        aria-label="Close dynamics equations"
        className="dynamics-drawer__backdrop"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="dynamics-drawer__panel"
        ref={dialogRef}
        role="dialog"
      >
        <header className="dynamics-drawer__header">
          <h2 className="visually-hidden" id={titleId}>
            Dynamics equations
          </h2>
          <button
            aria-label="Close dynamics equations"
            className="dynamics-drawer__close"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="dynamics-drawer__body">
          {DYNAMICS_EQUATIONS.map((equation) => (
            <KatexEquation equation={equation} key={equation} />
          ))}
        </div>
      </section>
    </div>
  );
}
