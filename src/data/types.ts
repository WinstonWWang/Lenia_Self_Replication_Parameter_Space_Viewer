export type Sha256 = string;
export type GridIndex = [number, number, number];
export type ParameterTriple = [number, number, number];

export interface ParameterCoordinates {
  m_local: number;
  m_cross: number;
  alpha: number;
}

export interface AxisDefinition {
  values: number[];
  count: 20;
}

export interface ManifestAxes {
  m_local: AxisDefinition;
  m_cross: AxisDefinition;
  alpha: AxisDefinition;
}

export interface FixedLaw {
  R1: number;
  T: number;
  r2: number;
  sigma2: number;
  sigma_local: number;
  sigma_cross: number;
  lambda_strength: number;
  phi: number;
  cross_potential_scale: number;
  vacuum_gate_a0: number;
  local_profile: "gaussian_mid";
  h_local: "1 - alpha";
  h_cross: "alpha";
}

export interface SearchConfiguration {
  grid_size: 800;
  field_size: 256;
  patch_grid: 32;
  population_size: 20;
  scored_rollout_updates: 800;
  time_samples: 8;
  prompt_schedule: string[];
  foundation_model: "clip";
  video_replay_updates: 1000;
}

export interface ScoreSemantics {
  combined_loss: "lower is better";
  clip_score_prompt: "-loss_prompt; higher is better";
  warning: "Search score, not replication verification";
  mixed_budget_warning: string;
}

export type BaseClassification =
  | "excluded_by_m_local_cutoff"
  | "experimentally_dead"
  | "dynamics_unresolved";

export interface ClassificationDefinitions {
  excluded_by_m_local_cutoff: string;
  experimentally_dead: string;
  dynamics_unresolved: string;
}

export interface EnsembleEvidence {
  classification: "experimentally_dead" | "dynamics_unresolved";
  confirmed_vacuum_count: number;
}

export interface ExcludedEvidence {
  exclusion_reason: string;
  vacuum_behavior_note: string;
  sampled_initial_fields: 0;
}

export interface SampledEvidence {
  confirmed_vacuum_count: number;
  sampled_initial_fields: 60;
  voronoi: EnsembleEvidence;
  fourier_curve: EnsembleEvidence;
  gaussian_mixture: EnsembleEvidence;
}

export interface NotApplicableAsal {
  status: "not_applicable";
}

export interface SobolFields {
  sequence_index: number;
  sobol_draw_index: number;
  sobol_unit_point: ParameterTriple;
}

export interface NotStartedAsal extends SobolFields {
  status: "not_started";
}

export interface SegmentationSummary {
  split_events: number;
  components_start: number | null;
  components_end: number | null;
}

export interface TopCandidate {
  rank: number;
  loss: number;
  loss_prompt: number;
  clip_score_prompt: number;
  loss_softmax: number;
  iteration: number;
  candidate_index: number;
  segmentation: SegmentationSummary;
}

export interface CompletedAsal extends SobolFields {
  status: "completed";
  completed_at: string;
  budget_seconds: 300 | 900;
  elapsed_seconds: number;
  iterations: number;
  simulations: number;
  best_loss: number;
  best_loss_prompt: number;
  best_clip_score_prompt: number;
  best_loss_softmax: number;
  report_available: boolean;
  top: TopCandidate[];
}

export type AsalStatus =
  | NotApplicableAsal
  | NotStartedAsal
  | CompletedAsal;

export interface BaseAsset {
  key: string;
  sha256: Sha256;
  bytes: number;
  source?: string;
}

export interface PosterAsset extends BaseAsset {
  width: number;
  height: number;
}

export interface VideoAsset extends BaseAsset {
  width: number;
  height: number;
  frames: number;
  fps: number;
  scored_updates: 800;
  replay_updates: 1000;
}

export interface ParameterAsset extends BaseAsset {
  format?: string;
}

export interface InitialFieldAsset extends BaseAsset {
  format: "json" | "npy" | "png" | "webp";
  width: number;
  height: number;
  value_min?: number;
  value_max?: number;
}

export type AssetDescriptor =
  | PosterAsset
  | VideoAsset
  | ParameterAsset
  | InitialFieldAsset;

export interface PointMedia {
  poster: PosterAsset | null;
  video: VideoAsset | null;
  parameters: ParameterAsset | null;
}

export interface SitePoint {
  id: string;
  global_index: number;
  grid_index: GridIndex;
  coordinates: ParameterCoordinates;
  classification: BaseClassification;
  evidence: ExcludedEvidence | SampledEvidence;
  asal: AsalStatus;
  media: PointMedia;
}

export interface ManifestSummary {
  total_grid_points: 8000;
  excluded_by_m_local_cutoff: 400;
  experimentally_dead: 6412;
  dynamics_unresolved: 1188;
  asal_completed: number;
  asal_reports_available: number;
  asal_not_started: number;
  asal_budget_seconds_histogram: Partial<Record<"300" | "900", number>>;
  media: {
    poster: number;
    video: number;
    parameters: number;
  };
  source_progress_status: string;
}

export interface ManifestProvenance {
  combined_config_digest: Sha256;
  sobol_plan_digest: Sha256;
  source_sha256: {
    grid_plan: Sha256;
    combined_results: Sha256;
    combined_progress: Sha256;
    combined_config: Sha256;
    sobol_plan: Sha256;
    experiment_config: Sha256;
    actual_parameters: Sha256;
  };
}

export interface SiteManifest {
  schema_version: 1;
  dataset_id: "product-lenia-mlocal-mcross-alpha-v1";
  generated_at: string;
  manifest_sha256: Sha256;
  asset_base_url: string;
  axes: ManifestAxes;
  fixed_law: FixedLaw;
  search_configuration: SearchConfiguration;
  score_semantics: ScoreSemantics;
  classification_definitions: ClassificationDefinitions;
  summary: ManifestSummary;
  provenance: ManifestProvenance;
  points: SitePoint[];
}

export interface LatestPointer {
  schema_version: 1;
  published_at: string;
  manifest_key: string;
  manifest_sha256: Sha256;
  manifest_bytes: number;
  manifest_content_encoding: "gzip" | "identity";
  manifest_object_sha256: Sha256;
  manifest_object_bytes: number;
}

export interface RuntimeConfig {
  schema_version: 1;
  manifest_pointer_url: string;
  fallback_manifest_url: string;
  fallback_asset_base_url: string;
  review_overlay_url?: string;
  refinement_catalog_url?: string;
  refresh_interval_seconds: number;
}

export type ManualReviewStatus = "self_replicator" | "nonreplicator";

export interface OverlayMedia {
  poster?: PosterAsset | null;
  video?: VideoAsset | null;
  parameters?: ParameterAsset | null;
  initial_field?: InitialFieldAsset | null;
}

export interface PointReview {
  point_id: string;
  status: ManualReviewStatus;
  reviewed_at?: string;
  notes?: string;
  media?: OverlayMedia;
}

export interface ReviewOverlay {
  schema_version: 1;
  dataset_id: string;
  asset_base_url?: string;
  based_on_manifest_sha256?: Sha256;
  reviews: PointReview[];
}

export interface RefinementAxes {
  m_local: number[];
  m_cross: number[];
  alpha: number[];
}

export interface RefinementSample {
  grid_index: GridIndex;
  coordinates: ParameterCoordinates;
  status: ManualReviewStatus;
  media?: OverlayMedia;
}

export interface RefinementNeighborhood {
  id: string;
  center_point_id: string;
  axes: RefinementAxes;
  replay_source_point_id?: string;
  shared_media?: OverlayMedia;
  samples: RefinementSample[];
}

export interface RefinementCatalog {
  schema_version: 1;
  dataset_id: string;
  asset_base_url?: string;
  based_on_manifest_sha256?: Sha256;
  neighborhoods: RefinementNeighborhood[];
}

export type DisplayStatus =
  | "physically_uninteresting"
  | "experimentally_dead"
  | "unresolved"
  | "self_replicator";

export interface SnapResult {
  input: ParameterTriple;
  coordinates: ParameterCoordinates;
  indices: GridIndex;
  deltas: ParameterCoordinates;
  point: SitePoint;
  wasSnapped: boolean;
}

export type DataSource = "remote" | "fallback";

export interface LoadedSiteData {
  config: RuntimeConfig;
  configUrl: string;
  manifest: SiteManifest;
  manifestUrl: string;
  source: DataSource;
  assetBaseUrl: string;
  assetUrl: (key: string) => string;
  reviewOverlay: ReviewOverlay;
  reviewAssetBaseUrl: string;
  reviewAssetUrl: (key: string) => string;
  refinementCatalog: RefinementCatalog;
  refinementAssetBaseUrl: string;
  refinementAssetUrl: (key: string) => string;
  warnings: string[];
}

export interface LoadSiteDataOptions {
  configUrl?: string | URL;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}
