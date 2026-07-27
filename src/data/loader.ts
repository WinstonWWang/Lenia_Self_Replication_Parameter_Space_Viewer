import {
  assertFeaturedCatalogSemantics,
  assertManifestSemantics,
  assertRefinementCatalogSemantics,
  assertReviewOverlaySemantics,
} from "./semantics";
import { emptyFeaturedCatalog } from "./featured";
import { assertCanonicalManifestIntegrity } from "./manifest-integrity";
import type {
  FeaturedCatalog,
  LatestPointer,
  LoadedSiteData,
  LoadSiteDataOptions,
  RefinementCatalog,
  ReviewOverlay,
  RuntimeConfig,
  SiteManifest,
} from "./types";
import {
  createAssetResolver,
  normalizeAssetBaseUrl,
  resolveConfiguredUrl,
  resolveSnapshotUrl,
} from "./urls";
import {
  assertValidDocument,
  validateFeaturedCatalog,
  validateLatestPointer,
  validateRefinementCatalog,
  validateReviewOverlay,
  validateRuntimeConfig,
  validateSiteManifest,
} from "./validators";

interface JsonDocument {
  value: unknown;
  text: string;
}

interface LoadedManifest {
  manifest: SiteManifest;
  manifestUrl: URL;
}

export class SiteDataLoadError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "SiteDataLoadError";
    this.cause = cause;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown data error";
}

function defaultConfigUrl(): URL {
  const pageUrl =
    typeof document !== "undefined"
      ? document.baseURI
      : typeof location !== "undefined"
        ? location.href
        : "http://localhost/";
  return new URL(
    `${import.meta.env.BASE_URL}site-config.json`,
    pageUrl,
  );
}

async function fetchJsonDocument(
  url: URL,
  fetcher: typeof fetch,
  label: string,
  init: RequestInit,
): Promise<JsonDocument> {
  let response: Response;
  try {
    response = await fetcher(url, init);
  } catch (error) {
    throw new SiteDataLoadError(`${label} could not be fetched`, error);
  }
  if (!response.ok) {
    throw new SiteDataLoadError(
      `${label} request returned HTTP ${response.status}`,
    );
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw new SiteDataLoadError(`${label} response could not be read`, error);
  }

  try {
    return { value: JSON.parse(text) as unknown, text };
  } catch (error) {
    throw new SiteDataLoadError(`${label} is not valid JSON`, error);
  }
}

async function loadRuntimeConfig(
  configUrl: URL,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<RuntimeConfig> {
  const document = await fetchJsonDocument(
    configUrl,
    fetcher,
    "Runtime configuration",
    { cache: "no-store", signal },
  );
  assertValidDocument(
    validateRuntimeConfig,
    document.value,
    "Runtime configuration",
  );
  return document.value;
}

function validateManifest(
  value: unknown,
  documentName: string,
): SiteManifest {
  assertValidDocument(validateSiteManifest, value, documentName);
  assertManifestSemantics(value);
  return value;
}

async function loadRemoteManifest(
  config: RuntimeConfig,
  configUrl: URL,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<LoadedManifest> {
  const pointerUrl = resolveConfiguredUrl(
    config.manifest_pointer_url,
    configUrl,
    "Manifest pointer URL",
  );
  const pointerDocument = await fetchJsonDocument(
    pointerUrl,
    fetcher,
    "Manifest pointer",
    { cache: "no-store", signal },
  );
  assertValidDocument(
    validateLatestPointer,
    pointerDocument.value,
    "Manifest pointer",
  );
  const pointer: LatestPointer = pointerDocument.value;
  const expectedKey = `manifests/snapshots/${pointer.manifest_sha256}.json`;
  if (pointer.manifest_key !== expectedKey) {
    throw new SiteDataLoadError(
      "Manifest pointer key does not match its declared digest",
    );
  }

  const manifestUrl = resolveSnapshotUrl(
    pointerUrl,
    pointer.manifest_key,
  );
  const manifestDocument = await fetchJsonDocument(
    manifestUrl,
    fetcher,
    "Live site manifest",
    { cache: "force-cache", signal },
  );
  const decodedBytes = new TextEncoder().encode(manifestDocument.text).length;
  if (decodedBytes !== pointer.manifest_bytes) {
    throw new SiteDataLoadError(
      "Live site manifest byte count does not match its pointer",
    );
  }

  const manifest = validateManifest(
    manifestDocument.value,
    "Live site manifest",
  );
  if (manifest.manifest_sha256 !== pointer.manifest_sha256) {
    throw new SiteDataLoadError(
      "Live site manifest digest does not match its pointer",
    );
  }
  await assertCanonicalManifestIntegrity(
    manifestDocument.text,
    manifest.manifest_sha256,
    pointer.manifest_sha256,
  );
  return { manifest, manifestUrl };
}

async function loadFallbackManifest(
  config: RuntimeConfig,
  configUrl: URL,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<LoadedManifest> {
  const manifestUrl = resolveConfiguredUrl(
    config.fallback_manifest_url,
    configUrl,
    "Fallback manifest URL",
  );
  const document = await fetchJsonDocument(
    manifestUrl,
    fetcher,
    "Bundled site manifest",
    { cache: "no-cache", signal },
  );
  return {
    manifest: validateManifest(document.value, "Bundled site manifest"),
    manifestUrl,
  };
}

function emptyReviewOverlay(datasetId: string): ReviewOverlay {
  return {
    schema_version: 1,
    dataset_id: datasetId,
    reviews: [],
  };
}

function emptyRefinementCatalog(datasetId: string): RefinementCatalog {
  return {
    schema_version: 1,
    dataset_id: datasetId,
    neighborhoods: [],
  };
}

async function loadReviewOverlay(
  config: RuntimeConfig,
  configUrl: URL,
  manifest: SiteManifest,
  fetcher: typeof fetch,
  warnings: string[],
  signal?: AbortSignal,
): Promise<ReviewOverlay> {
  if (!config.review_overlay_url) {
    return emptyReviewOverlay(manifest.dataset_id);
  }
  try {
    const url = resolveConfiguredUrl(
      config.review_overlay_url,
      configUrl,
      "Review overlay URL",
    );
    const document = await fetchJsonDocument(
      url,
      fetcher,
      "Review overlay",
      { cache: "no-store", signal },
    );
    assertValidDocument(
      validateReviewOverlay,
      document.value,
      "Review overlay",
    );
    assertReviewOverlaySemantics(document.value, manifest);
    if (document.value.asset_base_url) {
      normalizeAssetBaseUrl(document.value.asset_base_url);
    }
    return document.value;
  } catch (error) {
    warnings.push(
      `Manual review data is unavailable; base classifications remain visible (${errorMessage(
        error,
      )})`,
    );
    return emptyReviewOverlay(manifest.dataset_id);
  }
}

async function loadRefinementCatalog(
  config: RuntimeConfig,
  configUrl: URL,
  manifest: SiteManifest,
  fetcher: typeof fetch,
  warnings: string[],
  signal?: AbortSignal,
): Promise<RefinementCatalog> {
  if (!config.refinement_catalog_url) {
    return emptyRefinementCatalog(manifest.dataset_id);
  }
  try {
    const url = resolveConfiguredUrl(
      config.refinement_catalog_url,
      configUrl,
      "Refinement catalog URL",
    );
    const document = await fetchJsonDocument(
      url,
      fetcher,
      "Refinement catalog",
      { cache: "no-store", signal },
    );
    assertValidDocument(
      validateRefinementCatalog,
      document.value,
      "Refinement catalog",
    );
    assertRefinementCatalogSemantics(document.value, manifest);
    if (document.value.asset_base_url) {
      normalizeAssetBaseUrl(document.value.asset_base_url);
    }
    return document.value;
  } catch (error) {
    warnings.push(
      `Refined-neighborhood data is unavailable (${errorMessage(error)})`,
    );
    return emptyRefinementCatalog(manifest.dataset_id);
  }
}

async function loadFeaturedCatalog(
  config: RuntimeConfig,
  configUrl: URL,
  manifest: SiteManifest,
  fetcher: typeof fetch,
  warnings: string[],
  signal?: AbortSignal,
): Promise<FeaturedCatalog> {
  if (!config.featured_catalog_url) {
    return emptyFeaturedCatalog(manifest.dataset_id);
  }
  try {
    const url = resolveConfiguredUrl(
      config.featured_catalog_url,
      configUrl,
      "Featured catalog URL",
    );
    const document = await fetchJsonDocument(
      url,
      fetcher,
      "Featured catalog",
      { cache: "no-store", signal },
    );
    assertValidDocument(
      validateFeaturedCatalog,
      document.value,
      "Featured catalog",
    );
    assertFeaturedCatalogSemantics(document.value, manifest);
    if (document.value.asset_base_url) {
      normalizeAssetBaseUrl(document.value.asset_base_url);
    }
    return document.value;
  } catch (error) {
    warnings.push(
      `Featured off-grid data is unavailable (${errorMessage(error)})`,
    );
    return emptyFeaturedCatalog(manifest.dataset_id);
  }
}

function documentAssetBase(
  explicitBase: string | undefined,
  fallbackBase: URL,
): URL {
  return explicitBase
    ? normalizeAssetBaseUrl(explicitBase)
    : normalizeAssetBaseUrl(fallbackBase);
}

export async function loadSiteData(
  options: LoadSiteDataOptions = {},
): Promise<LoadedSiteData> {
  const configUrl = options.configUrl
    ? resolveConfiguredUrl(
        String(options.configUrl),
        defaultConfigUrl(),
        "Runtime configuration URL",
      )
    : defaultConfigUrl();
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const warnings: string[] = [];
  const config = await loadRuntimeConfig(
    configUrl,
    fetcher,
    options.signal,
  );

  let loadedManifest: LoadedManifest;
  let source: LoadedSiteData["source"];
  try {
    loadedManifest = await loadRemoteManifest(
      config,
      configUrl,
      fetcher,
      options.signal,
    );
    source = "remote";
  } catch (primaryError) {
    warnings.push(
      `Live data is unavailable; using the bundled snapshot (${errorMessage(
        primaryError,
      )})`,
    );
    try {
      loadedManifest = await loadFallbackManifest(
        config,
        configUrl,
        fetcher,
        options.signal,
      );
      source = "fallback";
    } catch (fallbackError) {
      throw new SiteDataLoadError(
        `Neither live nor bundled site data could be loaded. Live: ${errorMessage(
          primaryError,
        )}. Bundled: ${errorMessage(fallbackError)}`,
        fallbackError,
      );
    }
  }

  const fallbackAssetBase = resolveConfiguredUrl(
    config.fallback_asset_base_url,
    configUrl,
    "Fallback asset base URL",
  );
  const assetBase = documentAssetBase(
    loadedManifest.manifest.asset_base_url || undefined,
    fallbackAssetBase,
  );

  const reviewOverlay = await loadReviewOverlay(
    config,
    configUrl,
    loadedManifest.manifest,
    fetcher,
    warnings,
    options.signal,
  );
  const refinementCatalog = await loadRefinementCatalog(
    config,
    configUrl,
    loadedManifest.manifest,
    fetcher,
    warnings,
    options.signal,
  );
  const featuredCatalog = await loadFeaturedCatalog(
    config,
    configUrl,
    loadedManifest.manifest,
    fetcher,
    warnings,
    options.signal,
  );
  const reviewAssetBase = documentAssetBase(
    reviewOverlay.asset_base_url,
    assetBase,
  );
  const refinementAssetBase = documentAssetBase(
    refinementCatalog.asset_base_url,
    assetBase,
  );
  const featuredAssetBase = documentAssetBase(
    featuredCatalog.asset_base_url,
    assetBase,
  );

  return {
    config,
    configUrl: configUrl.href,
    manifest: loadedManifest.manifest,
    manifestUrl: loadedManifest.manifestUrl.href,
    source,
    assetBaseUrl: assetBase.href,
    assetUrl: createAssetResolver(assetBase),
    reviewOverlay,
    reviewAssetBaseUrl: reviewAssetBase.href,
    reviewAssetUrl: createAssetResolver(reviewAssetBase),
    refinementCatalog,
    refinementAssetBaseUrl: refinementAssetBase.href,
    refinementAssetUrl: createAssetResolver(refinementAssetBase),
    featuredCatalog,
    featuredAssetBaseUrl: featuredAssetBase.href,
    featuredAssetUrl: createAssetResolver(featuredAssetBase),
    warnings,
  };
}

export const loadRuntimeData = loadSiteData;
