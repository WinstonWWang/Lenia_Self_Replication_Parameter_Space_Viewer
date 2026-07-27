import Ajv2020, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import featuredCatalogSchema from "../../schemas/featured-catalog.schema.json";
import latestPointerSchema from "../../schemas/latest-pointer.schema.json";
import siteManifestSchema from "../../schemas/site-manifest.schema.json";
import type {
  FeaturedCatalog,
  LatestPointer,
  RefinementCatalog,
  ReviewOverlay,
  RuntimeConfig,
  SiteManifest,
} from "./types";

const SHA256_PATTERN = "^[a-f0-9]{64}$";
const POINT_ID_PATTERN = "^triple_[0-9]{5}$";
const ASSET_KEY_PATTERN = "^(media|repro)/v1/";

const runtimeConfigSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: [
    "schema_version",
    "manifest_pointer_url",
    "fallback_manifest_url",
    "fallback_asset_base_url",
    "refresh_interval_seconds",
  ],
  properties: {
    schema_version: { const: 1 },
    manifest_pointer_url: { type: "string", minLength: 1 },
    fallback_manifest_url: { type: "string", minLength: 1 },
    fallback_asset_base_url: { type: "string", minLength: 1 },
    review_overlay_url: { type: "string", minLength: 1 },
    refinement_catalog_url: { type: "string", minLength: 1 },
    featured_catalog_url: { type: "string", minLength: 1 },
    refresh_interval_seconds: {
      type: "number",
      minimum: 1,
      maximum: 86400,
    },
  },
  additionalProperties: false,
} as const;

const assetDefinitions = {
  baseProperties: {
    key: { type: "string", pattern: ASSET_KEY_PATTERN },
    sha256: { type: "string", pattern: SHA256_PATTERN },
    bytes: { type: "integer", minimum: 1 },
    source: { type: "string", minLength: 1 },
  },
  poster: {
    type: "object",
    required: ["key", "sha256", "bytes", "width", "height"],
    properties: {
      key: { type: "string", pattern: ASSET_KEY_PATTERN },
      sha256: { type: "string", pattern: SHA256_PATTERN },
      bytes: { type: "integer", minimum: 1 },
      source: { type: "string", minLength: 1 },
      width: { type: "integer", minimum: 1 },
      height: { type: "integer", minimum: 1 },
    },
    additionalProperties: false,
  },
  video: {
    type: "object",
    required: [
      "key",
      "sha256",
      "bytes",
      "width",
      "height",
      "frames",
      "fps",
      "scored_updates",
      "replay_updates",
    ],
    properties: {
      key: { type: "string", pattern: ASSET_KEY_PATTERN },
      sha256: { type: "string", pattern: SHA256_PATTERN },
      bytes: { type: "integer", minimum: 1 },
      source: { type: "string", minLength: 1 },
      width: { type: "integer", minimum: 1 },
      height: { type: "integer", minimum: 1 },
      frames: { type: "integer", minimum: 1 },
      fps: { type: "number", exclusiveMinimum: 0 },
      scored_updates: { const: 800 },
      replay_updates: { const: 1000 },
    },
    additionalProperties: false,
  },
  parameters: {
    type: "object",
    required: ["key", "sha256", "bytes"],
    properties: {
      key: { type: "string", pattern: ASSET_KEY_PATTERN },
      sha256: { type: "string", pattern: SHA256_PATTERN },
      bytes: { type: "integer", minimum: 1 },
      source: { type: "string", minLength: 1 },
      format: { type: "string", minLength: 1 },
    },
    additionalProperties: false,
  },
  initialField: {
    type: "object",
    required: [
      "key",
      "sha256",
      "bytes",
      "format",
      "width",
      "height",
    ],
    properties: {
      key: { type: "string", pattern: ASSET_KEY_PATTERN },
      sha256: { type: "string", pattern: SHA256_PATTERN },
      bytes: { type: "integer", minimum: 1 },
      source: { type: "string", minLength: 1 },
      format: { enum: ["json", "npy", "png", "webp"] },
      width: { type: "integer", minimum: 1 },
      height: { type: "integer", minimum: 1 },
      value_min: { type: "number" },
      value_max: { type: "number" },
    },
    additionalProperties: false,
  },
} as const;

const overlayMediaSchema = {
  type: "object",
  properties: {
    poster: {
      anyOf: [{ type: "null" }, assetDefinitions.poster],
    },
    video: {
      anyOf: [{ type: "null" }, assetDefinitions.video],
    },
    parameters: {
      anyOf: [{ type: "null" }, assetDefinitions.parameters],
    },
    initial_field: {
      anyOf: [{ type: "null" }, assetDefinitions.initialField],
    },
  },
  additionalProperties: false,
} as const;

function isValidPublishedAssetBaseUrl(value: string): boolean {
  if (value === "") return true;
  if (
    value !== value.trim() ||
    !value.startsWith("https://") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    !/^https:\/\/[^/?#]+(?:\/|$)/.test(value) ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.length > 0 &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.search === "" &&
      parsed.hash === ""
    );
  } catch {
    return false;
  }
}

const assetBaseUrlSchema = {
  type: "string",
  format: "published-asset-base-url",
} as const;

const reviewOverlaySchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: ["schema_version", "dataset_id", "reviews"],
  properties: {
    schema_version: { const: 1 },
    dataset_id: { type: "string", minLength: 1 },
    asset_base_url: assetBaseUrlSchema,
    based_on_manifest_sha256: {
      type: "string",
      pattern: SHA256_PATTERN,
    },
    reviews: {
      type: "array",
      items: {
        type: "object",
        required: ["point_id", "status"],
        properties: {
          point_id: { type: "string", pattern: POINT_ID_PATTERN },
          status: {
            enum: ["self_replicator", "nonreplicator"],
          },
          reviewed_at: { type: "string", minLength: 1 },
          notes: { type: "string" },
          media: overlayMediaSchema,
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
} as const;

const coordinatesSchema = {
  type: "object",
  required: ["m_local", "m_cross", "alpha"],
  properties: {
    m_local: { type: "number" },
    m_cross: { type: "number" },
    alpha: { type: "number" },
  },
  additionalProperties: false,
} as const;

const refinementCatalogSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: ["schema_version", "dataset_id", "neighborhoods"],
  properties: {
    schema_version: { const: 1 },
    dataset_id: { type: "string", minLength: 1 },
    asset_base_url: assetBaseUrlSchema,
    based_on_manifest_sha256: {
      type: "string",
      pattern: SHA256_PATTERN,
    },
    neighborhoods: {
      type: "array",
      items: {
        type: "object",
        required: [
          "id",
          "center_point_id",
          "axes",
          "samples",
        ],
        properties: {
          id: { type: "string", minLength: 1 },
          center_point_id: {
            type: "string",
            pattern: POINT_ID_PATTERN,
          },
          replay_source_point_id: {
            type: "string",
            pattern: POINT_ID_PATTERN,
          },
          shared_media: overlayMediaSchema,
          axes: {
            type: "object",
            required: ["m_local", "m_cross", "alpha"],
            properties: {
              m_local: {
                type: "array",
                minItems: 1,
                uniqueItems: true,
                items: { type: "number" },
              },
              m_cross: {
                type: "array",
                minItems: 1,
                uniqueItems: true,
                items: { type: "number" },
              },
              alpha: {
                type: "array",
                minItems: 1,
                uniqueItems: true,
                items: { type: "number" },
              },
            },
            additionalProperties: false,
          },
          samples: {
            type: "array",
            items: {
              type: "object",
              required: ["grid_index", "coordinates", "status"],
              properties: {
                grid_index: {
                  type: "array",
                  prefixItems: [
                    { type: "integer", minimum: 0 },
                    { type: "integer", minimum: 0 },
                    { type: "integer", minimum: 0 },
                  ],
                  minItems: 3,
                  maxItems: 3,
                },
                coordinates: coordinatesSchema,
                status: {
                  enum: ["self_replicator", "nonreplicator"],
                },
                media: overlayMediaSchema,
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
} as const;

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  // The supplied schema deliberately applies unevaluatedProperties beside
  // allOf without repeating a sibling `type`; that is valid draft 2020-12.
  strictTypes: false,
  removeAdditional: false,
  coerceTypes: false,
  useDefaults: false,
});
addFormats(ajv);
ajv.addFormat("published-asset-base-url", {
  type: "string",
  validate: isValidPublishedAssetBaseUrl,
});

export const validateSiteManifest = ajv.compile<SiteManifest>(
  siteManifestSchema,
);
export const validateLatestPointer = ajv.compile<LatestPointer>(
  latestPointerSchema,
);
export const validateRuntimeConfig = ajv.compile<RuntimeConfig>(
  runtimeConfigSchema,
);
export const validateReviewOverlay = ajv.compile<ReviewOverlay>(
  reviewOverlaySchema,
);
export const validateRefinementCatalog = ajv.compile<RefinementCatalog>(
  refinementCatalogSchema,
);
export const validateFeaturedCatalog = ajv.compile<FeaturedCatalog>(
  featuredCatalogSchema,
);

function describeError(error: ErrorObject): string {
  const location = error.instancePath || "/";
  return `${location} ${error.message ?? "is invalid"}`;
}

export class DocumentValidationError extends Error {
  readonly issues: string[];

  constructor(documentName: string, errors: ErrorObject[] | null | undefined) {
    const issues = (errors ?? []).map(describeError);
    const suffix = issues.length > 0 ? `: ${issues.join("; ")}` : "";
    super(`${documentName} failed schema validation${suffix}`);
    this.name = "DocumentValidationError";
    this.issues = issues;
  }
}

export function assertValidDocument<T>(
  validator: ValidateFunction<T>,
  value: unknown,
  documentName: string,
): asserts value is T {
  if (!validator(value)) {
    throw new DocumentValidationError(documentName, validator.errors);
  }
}
