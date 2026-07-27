export type SelectedParameterPoint =
  | { kind: "coarse"; id: string }
  | { kind: "featured"; id: string };

export function selectionKey(
  selection: SelectedParameterPoint,
): string {
  return `${selection.kind}:${selection.id}`;
}

export function sameSelection(
  left: SelectedParameterPoint | null,
  right: SelectedParameterPoint | null,
): boolean {
  return (
    left?.kind === right?.kind &&
    left?.id === right?.id
  );
}

export function readSelectionFromUrl(
  url: URL,
  coarseIds: ReadonlySet<string>,
  featuredIds: ReadonlySet<string>,
): SelectedParameterPoint | null {
  const featuredId = url.searchParams.get("featured");
  if (featuredId !== null) {
    return featuredIds.has(featuredId)
      ? { kind: "featured", id: featuredId }
      : null;
  }

  const coarseId = url.searchParams.get("point");
  if (coarseId && coarseIds.has(coarseId)) {
    return { kind: "coarse", id: coarseId };
  }
  return null;
}

export function writeSelectionToUrl(
  url: URL,
  selection: SelectedParameterPoint | null,
): URL {
  const next = new URL(url);
  next.searchParams.delete("point");
  next.searchParams.delete("featured");
  if (selection?.kind === "coarse") {
    next.searchParams.set("point", selection.id);
  } else if (selection?.kind === "featured") {
    next.searchParams.set("featured", selection.id);
  }
  return next;
}
