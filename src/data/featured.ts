import type {
  FeaturedCatalog,
  FeaturedNeighborhood,
  FeaturedPoint,
} from "./types";

export function emptyFeaturedCatalog(datasetId: string): FeaturedCatalog {
  return {
    schema_version: 1,
    dataset_id: datasetId,
    featured_points: [],
    neighborhoods: [],
  };
}

export function findFeaturedPoint(
  catalog: FeaturedCatalog,
  featuredId: string,
): FeaturedPoint | undefined {
  return catalog.featured_points.find((point) => point.id === featuredId);
}

export function findFeaturedNeighborhood(
  catalog: FeaturedCatalog,
  featuredPointOrId: FeaturedPoint | string,
): FeaturedNeighborhood | undefined {
  const point =
    typeof featuredPointOrId === "string"
      ? findFeaturedPoint(catalog, featuredPointOrId)
      : featuredPointOrId;
  if (!point) return undefined;
  return catalog.neighborhoods.find(
    (neighborhood) =>
      neighborhood.id === point.refinement_neighborhood_id &&
      neighborhood.center_featured_id === point.id,
  );
}

export function visibleOffGridFeaturedPoints(
  catalog: FeaturedCatalog,
): FeaturedPoint[] {
  return catalog.featured_points.filter(
    (point) => point.coarse_point_id === undefined,
  );
}
