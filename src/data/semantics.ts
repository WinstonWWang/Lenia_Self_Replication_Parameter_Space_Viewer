import type {
  AssetDescriptor,
  FeaturedCatalog,
  FeaturedPoint,
  OverlayMedia,
  ParameterCoordinates,
  RefinementCatalog,
  ReviewOverlay,
  SiteManifest,
  SitePoint,
} from "./types";
import { isSafeAssetKey } from "./urls";

const EXPECTED_CLASS_COUNTS = {
  excluded_by_m_local_cutoff: 400,
  experimentally_dead: 6412,
  dynamics_unresolved: 1188,
} as const;

const FORBIDDEN_PUBLIC_TEXT = [
  /\/n\/(?:home|holylabs|netscratch)/i,
  /[a-z]:\\/i,
  new RegExp(["secret", "access", "key"].join("[_-]?"), "i"),
  new RegExp(["access", "key", "id"].join("[_-]?"), "i"),
  new RegExp(`api[_-]?${"token"}`, "i"),
  new RegExp(`h${"f"}_[a-z0-9]+`, "i"),
];

export class SemanticValidationError extends Error {
  readonly issues: string[];

  constructor(documentName: string, issues: string[]) {
    const shown = issues.slice(0, 20);
    const remaining = issues.length - shown.length;
    const suffix = remaining > 0 ? `; and ${remaining} more` : "";
    super(
      `${documentName} failed semantic validation: ${shown.join("; ")}${suffix}`,
    );
    this.name = "SemanticValidationError";
    this.issues = issues;
  }
}

function exactCoordinate(
  point: SitePoint,
  manifest: SiteManifest,
): boolean {
  const [i, j, k] = point.grid_index;
  return (
    point.coordinates.m_local === manifest.axes.m_local.values[i] &&
    point.coordinates.m_cross === manifest.axes.m_cross.values[j] &&
    point.coordinates.alpha === manifest.axes.alpha.values[k]
  );
}

function collectAssetIssues(
  media: OverlayMedia,
  label: string,
  issues: string[],
  initialFieldSize?: number,
): void {
  for (const [kind, asset] of Object.entries(media)) {
    if (asset === null || asset === undefined) continue;
    if (!isSafeAssetKey(asset.key)) {
      issues.push(`${label}.${kind} has an unsafe asset key`);
    }
    const filename = asset.key.split("/").at(-1) ?? "";
    const extensionIndex = filename.lastIndexOf(".");
    const stem =
      extensionIndex > 0 ? filename.slice(0, extensionIndex) : filename;
    if (stem !== asset.sha256) {
      issues.push(
        `${label}.${kind} filename stem must equal its SHA-256`,
      );
    }
    if (
      kind === "initial_field" &&
      initialFieldSize !== undefined &&
      ("width" in asset || "height" in asset) &&
      (asset.width !== initialFieldSize || asset.height !== initialFieldSize)
    ) {
      issues.push(
        `${label}.initial_field must be ${initialFieldSize}x${initialFieldSize}`,
      );
    }
  }
}

function isStrictlyIncreasing(values: number[]): boolean {
  return values.every(
    (value, index) =>
      Number.isFinite(value) && (index === 0 || value > values[index - 1]),
  );
}

function containsForbiddenPublicText(value: unknown): boolean {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "string") {
      if (FORBIDDEN_PUBLIC_TEXT.some((pattern) => pattern.test(current))) {
        return true;
      }
    } else if (Array.isArray(current)) {
      pending.push(...current);
    } else if (current && typeof current === "object") {
      pending.push(...Object.keys(current), ...Object.values(current));
    }
  }
  return false;
}

function coordinatesEqual(
  left: ParameterCoordinates,
  right: ParameterCoordinates,
): boolean {
  return (
    left.m_local === right.m_local &&
    left.m_cross === right.m_cross &&
    left.alpha === right.alpha
  );
}

function coordinatesWithinManifestBounds(
  coordinates: ParameterCoordinates,
  manifest: SiteManifest,
): boolean {
  const mLocal = manifest.axes.m_local.values;
  const mCross = manifest.axes.m_cross.values;
  const alpha = manifest.axes.alpha.values;
  return (
    Number.isFinite(coordinates.m_local) &&
    Number.isFinite(coordinates.m_cross) &&
    Number.isFinite(coordinates.alpha) &&
    coordinates.m_local >= mLocal[0] &&
    coordinates.m_local <= mLocal[mLocal.length - 1] &&
    coordinates.m_cross >= mCross[0] &&
    coordinates.m_cross <= mCross[mCross.length - 1] &&
    coordinates.alpha >= alpha[0] &&
    coordinates.alpha <= alpha[alpha.length - 1]
  );
}

export function getManifestSemanticIssues(
  manifest: SiteManifest,
): string[] {
  const issues: string[] = [];
  const axes = [
    ["m_local", manifest.axes.m_local],
    ["m_cross", manifest.axes.m_cross],
    ["alpha", manifest.axes.alpha],
  ] as const;

  for (const [name, axis] of axes) {
    if (axis.count !== axis.values.length) {
      issues.push(`axis ${name} count does not match its values`);
    }
    if (!isStrictlyIncreasing(axis.values)) {
      issues.push(`axis ${name} must be finite and strictly increasing`);
    }
  }

  const ids = new Set<string>();
  const globalIndices = new Set<number>();
  const gridIndices = new Set<string>();
  const sequenceIndices = new Set<number>();
  const classCounts = {
    excluded_by_m_local_cutoff: 0,
    experimentally_dead: 0,
    dynamics_unresolved: 0,
  };
  const mediaCounts = { poster: 0, video: 0, parameters: 0 };
  const budgetCounts = { "300": 0, "900": 0 };
  let completedCount = 0;
  let notStartedCount = 0;
  let reportCount = 0;

  if (manifest.points.length !== 8000) {
    issues.push("manifest must contain exactly 8000 points");
  }

  manifest.points.forEach((point, position) => {
    const [i, j, k] = point.grid_index;
    const expectedGlobalIndex = (i * 20 + j) * 20 + k;
    const expectedId = `triple_${expectedGlobalIndex
      .toString()
      .padStart(5, "0")}`;
    const gridKey = `${i},${j},${k}`;

    if (point.global_index !== position) {
      issues.push(`${point.id} is not ordered by global_index`);
    }
    if (point.global_index !== expectedGlobalIndex) {
      issues.push(`${point.id} has an inconsistent global_index`);
    }
    if (point.id !== expectedId) {
      issues.push(`${point.id} is inconsistent with its grid_index`);
    }
    if (!exactCoordinate(point, manifest)) {
      issues.push(`${point.id} coordinates do not match its axis indices`);
    }
    if (ids.has(point.id)) issues.push(`duplicate point id ${point.id}`);
    if (globalIndices.has(point.global_index)) {
      issues.push(`duplicate global_index ${point.global_index}`);
    }
    if (gridIndices.has(gridKey)) {
      issues.push(`duplicate grid_index ${gridKey}`);
    }
    ids.add(point.id);
    globalIndices.add(point.global_index);
    gridIndices.add(gridKey);

    classCounts[point.classification] += 1;
    if (point.classification === "excluded_by_m_local_cutoff") {
      if (
        !("sampled_initial_fields" in point.evidence) ||
        point.evidence.sampled_initial_fields !== 0
      ) {
        issues.push(`${point.id} excluded evidence must have zero samples`);
      }
      if (point.asal.status !== "not_applicable") {
        issues.push(`${point.id} excluded point must have ASAL not_applicable`);
      }
    } else {
      if (
        !("sampled_initial_fields" in point.evidence) ||
        point.evidence.sampled_initial_fields !== 60
      ) {
        issues.push(`${point.id} sampled evidence must have 60 fields`);
      }
    }

    if (point.classification === "experimentally_dead") {
      if (
        !("confirmed_vacuum_count" in point.evidence) ||
        point.evidence.confirmed_vacuum_count !== 60
      ) {
        issues.push(`${point.id} dead evidence must confirm 60 vacuums`);
      }
      if (point.asal.status !== "not_applicable") {
        issues.push(`${point.id} dead point must have ASAL not_applicable`);
      }
    }

    if (point.classification === "dynamics_unresolved") {
      if (point.asal.status === "not_started") {
        notStartedCount += 1;
      } else if (point.asal.status === "completed") {
        completedCount += 1;
        const budget = String(point.asal.budget_seconds) as "300" | "900";
        budgetCounts[budget] += 1;
        if (
          Math.abs(
            point.asal.best_clip_score_prompt +
              point.asal.best_loss_prompt,
          ) > 1e-9
        ) {
          issues.push(`${point.id} has inconsistent CLIP score semantics`);
        }
        if (point.asal.report_available) reportCount += 1;
        if (
          point.asal.report_available &&
          point.asal.top.length !== 3
        ) {
          issues.push(`${point.id} available report must have three candidates`);
        }
      } else {
        issues.push(`${point.id} unresolved point has invalid ASAL status`);
      }

      if (point.asal.status !== "not_applicable") {
        if (sequenceIndices.has(point.asal.sequence_index)) {
          issues.push(
            `${point.id} duplicates Sobol sequence index ${point.asal.sequence_index}`,
          );
        }
        sequenceIndices.add(point.asal.sequence_index);
      }
    }

    if (
      point.classification !== "dynamics_unresolved" &&
      (point.media.poster !== null ||
        point.media.video !== null ||
        point.media.parameters !== null)
    ) {
      issues.push(
        `${point.id} ${point.classification} point must not publish coarse media`,
      );
    }

    for (const kind of ["poster", "video", "parameters"] as const) {
      const asset = point.media[kind] as AssetDescriptor | null;
      if (asset === null) continue;
      mediaCounts[kind] += 1;
      if (!isSafeAssetKey(asset.key)) {
        issues.push(`${point.id}.${kind} has an unsafe asset key`);
      }
    }
  });

  for (const classification of Object.keys(
    EXPECTED_CLASS_COUNTS,
  ) as Array<keyof typeof EXPECTED_CLASS_COUNTS>) {
    if (classCounts[classification] !== EXPECTED_CLASS_COUNTS[classification]) {
      issues.push(`classification count for ${classification} is incorrect`);
    }
    if (
      manifest.summary[classification] !==
      EXPECTED_CLASS_COUNTS[classification]
    ) {
      issues.push(`summary count for ${classification} is incorrect`);
    }
  }

  if (sequenceIndices.size !== 1188) {
    issues.push("Sobol sequence indices must uniquely cover all 1188 points");
  }
  if (
    completedCount !== manifest.summary.asal_completed ||
    notStartedCount !== manifest.summary.asal_not_started ||
    completedCount + notStartedCount !== 1188
  ) {
    issues.push("ASAL completion summary does not match points");
  }
  if (reportCount !== manifest.summary.asal_reports_available) {
    issues.push("ASAL report summary does not match points");
  }
  if (
    budgetCounts["300"] !==
      (manifest.summary.asal_budget_seconds_histogram["300"] ?? 0) ||
    budgetCounts["900"] !==
      (manifest.summary.asal_budget_seconds_histogram["900"] ?? 0)
  ) {
    issues.push("ASAL budget histogram does not match points");
  }
  if (
    mediaCounts.poster !== manifest.summary.media.poster ||
    mediaCounts.video !== manifest.summary.media.video ||
    mediaCounts.parameters !== manifest.summary.media.parameters
  ) {
    issues.push("media summary does not match point assets");
  }
  if (manifest.summary.total_grid_points !== manifest.points.length) {
    issues.push("total_grid_points does not match points");
  }
  if (containsForbiddenPublicText(manifest)) {
    issues.push("manifest contains a forbidden private-path or secret pattern");
  }
  return issues;
}

export function assertManifestSemantics(manifest: SiteManifest): void {
  const issues = getManifestSemanticIssues(manifest);
  if (issues.length > 0) {
    throw new SemanticValidationError("Site manifest", issues);
  }
}

export function getReviewOverlaySemanticIssues(
  overlay: ReviewOverlay,
  manifest: SiteManifest,
): string[] {
  const issues: string[] = [];
  const pointById = new Map(
    manifest.points.map((point) => [point.id, point] as const),
  );
  const reviewed = new Set<string>();

  if (overlay.dataset_id !== manifest.dataset_id) {
    issues.push("review overlay dataset_id does not match the manifest");
  }
  if (
    overlay.based_on_manifest_sha256 !== undefined &&
    overlay.based_on_manifest_sha256 !== manifest.manifest_sha256
  ) {
    issues.push("review overlay targets a different manifest snapshot");
  }
  for (const review of overlay.reviews) {
    const point = pointById.get(review.point_id);
    if (!point) {
      issues.push(`review references unknown point ${review.point_id}`);
    } else if (point.classification !== "dynamics_unresolved") {
      issues.push(`review ${review.point_id} is not dynamics_unresolved`);
    }
    if (reviewed.has(review.point_id)) {
      issues.push(`duplicate review for ${review.point_id}`);
    }
    reviewed.add(review.point_id);
    if (review.media) {
      collectAssetIssues(
        review.media,
        `review ${review.point_id}`,
        issues,
        manifest.search_configuration.field_size,
      );
    }
  }
  if (containsForbiddenPublicText(overlay)) {
    issues.push(
      "review overlay contains a forbidden private-path or secret pattern",
    );
  }
  return issues;
}

export function assertReviewOverlaySemantics(
  overlay: ReviewOverlay,
  manifest: SiteManifest,
): void {
  const issues = getReviewOverlaySemanticIssues(overlay, manifest);
  if (issues.length > 0) {
    throw new SemanticValidationError("Review overlay", issues);
  }
}

export function getRefinementCatalogSemanticIssues(
  catalog: RefinementCatalog,
  manifest: SiteManifest,
): string[] {
  const issues: string[] = [];
  const pointIds = new Set(manifest.points.map((point) => point.id));
  const neighborhoodIds = new Set<string>();
  const centerPointIds = new Set<string>();

  if (catalog.dataset_id !== manifest.dataset_id) {
    issues.push("refinement catalog dataset_id does not match the manifest");
  }
  if (
    catalog.based_on_manifest_sha256 !== undefined &&
    catalog.based_on_manifest_sha256 !== manifest.manifest_sha256
  ) {
    issues.push("refinement catalog targets a different manifest snapshot");
  }

  for (const neighborhood of catalog.neighborhoods) {
    if (neighborhoodIds.has(neighborhood.id)) {
      issues.push(`duplicate refinement neighborhood ${neighborhood.id}`);
    }
    neighborhoodIds.add(neighborhood.id);
    if (centerPointIds.has(neighborhood.center_point_id)) {
      issues.push(
        `duplicate refinement center ${neighborhood.center_point_id}`,
      );
    }
    centerPointIds.add(neighborhood.center_point_id);
    if (!pointIds.has(neighborhood.center_point_id)) {
      issues.push(
        `refinement ${neighborhood.id} has an unknown center point`,
      );
    }
    if (
      neighborhood.replay_source_point_id !== undefined &&
      !pointIds.has(neighborhood.replay_source_point_id)
    ) {
      issues.push(
        `refinement ${neighborhood.id} has an unknown replay source`,
      );
    }
    if (neighborhood.shared_media) {
      collectAssetIssues(
        neighborhood.shared_media,
        `refinement ${neighborhood.id} shared media`,
        issues,
        manifest.search_configuration.field_size,
      );
    }

    const axes = neighborhood.axes;
    for (const name of ["m_local", "m_cross", "alpha"] as const) {
      if (!isStrictlyIncreasing(axes[name])) {
        issues.push(
          `refinement ${neighborhood.id} axis ${name} must be strictly increasing`,
        );
      }
    }

    const samples = new Set<string>();
    for (const sample of neighborhood.samples) {
      const [i, j, k] = sample.grid_index;
      const key = `${i},${j},${k}`;
      if (
        i >= axes.m_local.length ||
        j >= axes.m_cross.length ||
        k >= axes.alpha.length
      ) {
        issues.push(
          `refinement ${neighborhood.id} sample ${key} is outside its axes`,
        );
      } else if (
        sample.coordinates.m_local !== axes.m_local[i] ||
        sample.coordinates.m_cross !== axes.m_cross[j] ||
        sample.coordinates.alpha !== axes.alpha[k]
      ) {
        issues.push(
          `refinement ${neighborhood.id} sample ${key} coordinates do not match its indices`,
        );
      }
      if (samples.has(key)) {
        issues.push(
          `refinement ${neighborhood.id} has duplicate sample ${key}`,
        );
      }
      samples.add(key);
      if (sample.media) {
        collectAssetIssues(
          sample.media,
          `refinement ${neighborhood.id} sample ${key}`,
          issues,
          manifest.search_configuration.field_size,
        );
      }
    }
  }
  if (containsForbiddenPublicText(catalog)) {
    issues.push(
      "refinement catalog contains a forbidden private-path or secret pattern",
    );
  }
  return issues;
}

export function assertRefinementCatalogSemantics(
  catalog: RefinementCatalog,
  manifest: SiteManifest,
): void {
  const issues = getRefinementCatalogSemanticIssues(catalog, manifest);
  if (issues.length > 0) {
    throw new SemanticValidationError("Refinement catalog", issues);
  }
}

export function getFeaturedCatalogSemanticIssues(
  catalog: FeaturedCatalog,
  manifest: SiteManifest,
): string[] {
  const issues: string[] = [];
  const manifestPoints = new Map(
    manifest.points.map((point) => [point.id, point] as const),
  );
  const pointsById = new Map<string, FeaturedPoint>();
  const neighborhoodIds = new Set<string>();
  const centerFeaturedIds = new Set<string>();
  const coarsePointIds = new Set<string>();

  if (catalog.dataset_id !== manifest.dataset_id) {
    issues.push("featured catalog dataset_id does not match the manifest");
  }
  if (
    catalog.based_on_manifest_sha256 !== undefined &&
    catalog.based_on_manifest_sha256 !== manifest.manifest_sha256
  ) {
    issues.push("featured catalog targets a different manifest snapshot");
  }
  for (const point of catalog.featured_points) {
    if (pointsById.has(point.id)) {
      issues.push(`duplicate featured point id ${point.id}`);
    }
    pointsById.set(point.id, point);
    if (manifestPoints.has(point.id)) {
      issues.push(
        `featured point id ${point.id} collides with a canonical point id`,
      );
    }

    if (!coordinatesWithinManifestBounds(point.coordinates, manifest)) {
      issues.push(`${point.id} coordinates are outside displayed bounds`);
    }
    if (
      !coordinatesWithinManifestBounds(
        point.source_reported_coordinates,
        manifest,
      )
    ) {
      issues.push(
        `${point.id} source-reported coordinates are outside displayed bounds`,
      );
    }
    if (point.media) {
      collectAssetIssues(
        point.media,
        `featured point ${point.id}`,
        issues,
        manifest.search_configuration.field_size,
      );
    }
    if (
      point.search_result?.best_loss_prompt !== undefined &&
      point.search_result.best_clip_score_prompt !== undefined &&
      Math.abs(
        point.search_result.best_clip_score_prompt +
          point.search_result.best_loss_prompt,
      ) > 1e-9
    ) {
      issues.push(
        `${point.id} best_clip_score_prompt must equal -best_loss_prompt`,
      );
    }

    if (point.coarse_point_id !== undefined) {
      const coarsePoint = manifestPoints.get(point.coarse_point_id);
      if (!coarsePoint) {
        issues.push(
          `${point.id} references unknown canonical point ${point.coarse_point_id}`,
        );
      } else if (!coordinatesEqual(point.coordinates, coarsePoint.coordinates)) {
        issues.push(
          `${point.id} coordinates do not match canonical center ${point.coarse_point_id}`,
        );
      }
      if (coarsePointIds.has(point.coarse_point_id)) {
        issues.push(
          `duplicate featured canonical center ${point.coarse_point_id}`,
        );
      }
      coarsePointIds.add(point.coarse_point_id);
    }
  }

  for (const neighborhood of catalog.neighborhoods) {
    if (neighborhoodIds.has(neighborhood.id)) {
      issues.push(`duplicate featured neighborhood ${neighborhood.id}`);
    }
    neighborhoodIds.add(neighborhood.id);
    if (centerFeaturedIds.has(neighborhood.center_featured_id)) {
      issues.push(
        `duplicate featured neighborhood center ${neighborhood.center_featured_id}`,
      );
    }
    centerFeaturedIds.add(neighborhood.center_featured_id);

    const center = pointsById.get(neighborhood.center_featured_id);
    if (!center) {
      issues.push(
        `featured neighborhood ${neighborhood.id} has an unknown center`,
      );
    } else {
      if (center.refinement_neighborhood_id !== neighborhood.id) {
        issues.push(
          `featured neighborhood ${neighborhood.id} does not resolve back from ${center.id}`,
        );
      }
    }

    if (neighborhood.shared_media) {
      collectAssetIssues(
        neighborhood.shared_media,
        `featured neighborhood ${neighborhood.id} shared media`,
        issues,
        manifest.search_configuration.field_size,
      );
    }

    const axes = neighborhood.axes;
    for (const name of ["m_local", "m_cross", "alpha"] as const) {
      const values = axes[name];
      if (!isStrictlyIncreasing(values)) {
        issues.push(
          `featured neighborhood ${neighborhood.id} axis ${name} must be finite and strictly increasing`,
        );
      }
      const manifestValues = manifest.axes[name].values;
      const lower = manifestValues[0];
      const upper = manifestValues[manifestValues.length - 1];
      if (
        values.some(
          (value) =>
            !Number.isFinite(value) || value < lower || value > upper,
        )
      ) {
        issues.push(
          `featured neighborhood ${neighborhood.id} axis ${name} is outside displayed bounds`,
        );
      }
    }

    const sampleIndices = new Set<string>();
    const scanIndices = new Set<number>();
    let centerSampleCount = 0;
    for (const sample of neighborhood.samples) {
      const [i, j, k] = sample.grid_index;
      const key = `${i},${j},${k}`;
      if (
        i < 0 ||
        j < 0 ||
        k < 0 ||
        i >= axes.m_local.length ||
        j >= axes.m_cross.length ||
        k >= axes.alpha.length
      ) {
        issues.push(
          `featured neighborhood ${neighborhood.id} sample ${key} is outside its axes`,
        );
      } else if (
        sample.coordinates.m_local !== axes.m_local[i] ||
        sample.coordinates.m_cross !== axes.m_cross[j] ||
        sample.coordinates.alpha !== axes.alpha[k]
      ) {
        issues.push(
          `featured neighborhood ${neighborhood.id} sample ${key} coordinates do not match its indices`,
        );
      }
      if (
        !coordinatesWithinManifestBounds(sample.coordinates, manifest)
      ) {
        issues.push(
          `featured neighborhood ${neighborhood.id} sample ${key} is outside displayed bounds`,
        );
      }
      if (sampleIndices.has(key)) {
        issues.push(
          `featured neighborhood ${neighborhood.id} has duplicate sample ${key}`,
        );
      }
      sampleIndices.add(key);
      if (sample.scan_index !== undefined) {
        if (scanIndices.has(sample.scan_index)) {
          issues.push(
            `featured neighborhood ${neighborhood.id} has duplicate scan index ${sample.scan_index}`,
          );
        }
        scanIndices.add(sample.scan_index);
      }
      if (sample.media) {
        collectAssetIssues(
          sample.media,
          `featured neighborhood ${neighborhood.id} sample ${key}`,
          issues,
          manifest.search_configuration.field_size,
        );
      }
      if (center && coordinatesEqual(sample.coordinates, center.coordinates)) {
        centerSampleCount += 1;
        if (sample.status !== "self_replicator") {
          issues.push(
            `featured neighborhood ${neighborhood.id} center sample must be self_replicator`,
          );
        }
        if (sample.variation_label !== undefined) {
          issues.push(
            `featured neighborhood ${neighborhood.id} center sample must not have a variation label`,
          );
        }
      }
    }
    if (center && centerSampleCount !== 1) {
      issues.push(
        `featured neighborhood ${neighborhood.id} must contain exactly one center sample`,
      );
    }
  }

  for (const point of catalog.featured_points) {
    const neighborhood = catalog.neighborhoods.find(
      (candidate) => candidate.id === point.refinement_neighborhood_id,
    );
    if (!neighborhood) {
      issues.push(
        `${point.id} references unknown featured neighborhood ${point.refinement_neighborhood_id}`,
      );
    } else if (neighborhood.center_featured_id !== point.id) {
      issues.push(
        `${point.id} refinement neighborhood resolves to a different center`,
      );
    }
  }

  if (containsForbiddenPublicText(catalog)) {
    issues.push(
      "featured catalog contains a forbidden private-path or secret pattern",
    );
  }
  return issues;
}

export function assertFeaturedCatalogSemantics(
  catalog: FeaturedCatalog,
  manifest: SiteManifest,
): void {
  const issues = getFeaturedCatalogSemanticIssues(catalog, manifest);
  if (issues.length > 0) {
    throw new SemanticValidationError("Featured catalog", issues);
  }
}
