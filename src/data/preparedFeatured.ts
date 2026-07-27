import type {
  FeaturedCatalog,
  FeaturedPoint,
  FeaturedSample,
  ParameterCoordinates,
  SiteManifest,
} from "./types";

interface PreparedCenterSpecification {
  displayLabel: string;
  namespace: string;
  coordinates?: readonly [number, number, number];
  sourceReportedCoordinates?: readonly [number, number, number];
  maximumScanIndex: number;
  nonreplicatorRanges: readonly (readonly [number, number])[];
}

export interface PreparedVariationExpectation {
  scanIndex: number;
  coordinates: ParameterCoordinates;
  variationLabel: number;
}

const OFFSET_INDICES = [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5] as const;

const PREPARED_CENTER_SPECIFICATIONS: ReadonlyMap<
  string,
  PreparedCenterSpecification
> = new Map([
  [
    "preclassification_sobol_triple_00075",
    {
      displayLabel: "triple_00075",
      namespace: "preclassification_sobol",
      coordinates: [
        0.3152100145816803,
        0.17585211992263794,
        0.7561357617378235,
      ],
      sourceReportedCoordinates: [
        0.315210017375648,
        0.17585212592700294,
        0.7561357384547591,
      ],
      maximumScanIndex: 700,
      nonreplicatorRanges: [
        [1, 10],
        [21, 80],
        [91, 150],
        [161, 220],
        [230, 290],
        [300, 700],
      ],
    },
  ],
  [
    "preclassification_sobol_triple_00891",
    {
      displayLabel: "triple_00891",
      namespace: "preclassification_sobol",
      coordinates: [
        0.2847903370857239,
        0.1466793417930603,
        0.2798478901386261,
      ],
      sourceReportedCoordinates: [
        0.2847903463989496,
        0.146679344111174,
        0.2798478798940778,
      ],
      maximumScanIndex: 700,
      nonreplicatorRanges: [
        [1, 8],
        [11, 158],
        [161, 225],
        [231, 296],
        [301, 700],
      ],
    },
  ],
  [
    "reference_triple_original",
    {
      displayLabel: "triple_original",
      namespace: "reference",
      coordinates: [
        0.2196178287267685,
        0.06508693099021912,
        0.4492952340663093,
      ],
      sourceReportedCoordinates: [
        0.2196178287267685,
        0.06508693099021912,
        0.4492952340663093,
      ],
      maximumScanIndex: 500,
      nonreplicatorRanges: [[1, 500]],
    },
  ],
  [
    "triple_01210",
    {
      displayLabel: "triple_01210",
      namespace: "frozen_337_grid",
      maximumScanIndex: 500,
      nonreplicatorRanges: [
        [1, 352],
        [357, 400],
        [411, 450],
        [455, 500],
      ],
    },
  ],
  [
    "triple_01608",
    {
      displayLabel: "triple_01608",
      namespace: "frozen_337_grid",
      maximumScanIndex: 500,
      nonreplicatorRanges: [
        [1, 158],
        [161, 206],
        [211, 253],
        [261, 302],
        [311, 350],
        [361, 400],
        [411, 450],
        [471, 500],
      ],
    },
  ],
]);

function coordinateValues(
  coordinates: ParameterCoordinates,
): readonly [number, number, number] {
  return [
    coordinates.m_local,
    coordinates.m_cross,
    coordinates.alpha,
  ];
}

function isCenterSample(
  sample: FeaturedSample,
  point: FeaturedPoint,
): boolean {
  const center = coordinateValues(point.coordinates);
  return coordinateValues(sample.coordinates).every(
    (value, index) => value === center[index],
  );
}

function expectedStatus(
  scanIndex: number,
  ranges: PreparedCenterSpecification["nonreplicatorRanges"],
): FeaturedSample["status"] {
  return ranges.some(
    ([minimum, maximum]) =>
      scanIndex >= minimum && scanIndex <= maximum,
  )
    ? "nonreplicator"
    : "self_replicator";
}

export function getPreparedVariationExpectations(
  point: FeaturedPoint,
  manifest: SiteManifest,
): PreparedVariationExpectation[] {
  const mLocalBounds = manifest.axes.m_local.values;
  const mCrossBounds = manifest.axes.m_cross.values;
  const alphaBounds = manifest.axes.alpha.values;
  const minimum = {
    m_local: mLocalBounds[0],
    m_cross: mCrossBounds[0],
    alpha: alphaBounds[0],
  };
  const maximum = {
    m_local: mLocalBounds.at(-1),
    m_cross: mCrossBounds.at(-1),
    alpha: alphaBounds.at(-1),
  };
  if (
    Object.values(minimum).some((value) => value === undefined) ||
    Object.values(maximum).some((value) => value === undefined)
  ) {
    throw new Error("Prepared variation bounds are unavailable");
  }
  const delta = {
    m_local: (maximum.m_local! - minimum.m_local!) * 0.01,
    m_cross: (maximum.m_cross! - minimum.m_cross!) * 0.01,
    alpha: (maximum.alpha! - minimum.alpha!) * 0.01,
  };
  const result: PreparedVariationExpectation[] = [];
  for (
    let localPosition = 0;
    localPosition < OFFSET_INDICES.length;
    localPosition += 1
  ) {
    for (
      let crossPosition = 0;
      crossPosition < OFFSET_INDICES.length;
      crossPosition += 1
    ) {
      for (
        let alphaPosition = 0;
        alphaPosition < OFFSET_INDICES.length;
        alphaPosition += 1
      ) {
        const coordinates = {
          m_local:
            point.coordinates.m_local +
            OFFSET_INDICES[localPosition] * delta.m_local,
          m_cross:
            point.coordinates.m_cross +
            OFFSET_INDICES[crossPosition] * delta.m_cross,
          alpha:
            point.coordinates.alpha +
            OFFSET_INDICES[alphaPosition] * delta.alpha,
        };
        if (
          coordinates.m_local < minimum.m_local! ||
          coordinates.m_local > maximum.m_local! ||
          coordinates.m_cross < minimum.m_cross! ||
          coordinates.m_cross > maximum.m_cross! ||
          coordinates.alpha < minimum.alpha! ||
          coordinates.alpha > maximum.alpha!
        ) {
          continue;
        }
        result.push({
          scanIndex: result.length + 1,
          coordinates,
          variationLabel:
            1 +
            localPosition * 100 +
            crossPosition * 10 +
            alphaPosition,
        });
      }
    }
  }
  return result;
}

function trailingVariationNumber(value: string | undefined): number | null {
  const match = value?.trim().match(/(\d+)$/);
  return match ? Number(match[1]) : null;
}

export function assertPreparedFirstPublication(
  catalog: FeaturedCatalog,
  manifest: SiteManifest,
): void {
  if (!catalog.asset_base_url) {
    throw new Error(
      "Prepared first publication requires an explicit featured catalog asset_base_url",
    );
  }
  if (catalog.based_on_manifest_sha256 !== manifest.manifest_sha256) {
    throw new Error(
      "Prepared first publication must pin based_on_manifest_sha256 to the validated manifest",
    );
  }

  const offGrid = catalog.featured_points.filter(
    (point) => point.coarse_point_id === undefined,
  );
  if (
    catalog.featured_points.length !== 5 ||
    offGrid.length !== 3 ||
    catalog.neighborhoods.length !== 5
  ) {
    throw new Error(
      "Prepared first publication requires 5 centers, 3 off-grid centers, and 5 neighborhoods",
    );
  }
  const coarseIds = catalog.featured_points
    .map((point) => point.coarse_point_id)
    .filter((pointId): pointId is string => Boolean(pointId))
    .sort();
  if (coarseIds.join(",") !== "triple_01210,triple_01608") {
    throw new Error(
      "Prepared first publication requires canonical centers triple_01210 and triple_01608",
    );
  }

  const seenSpecifications = new Set<string>();
  let positiveCount = 0;
  let negativeCount = 0;
  for (const point of catalog.featured_points) {
    const specificationKey = point.coarse_point_id ?? point.id;
    const specification =
      PREPARED_CENTER_SPECIFICATIONS.get(specificationKey);
    if (!specification || seenSpecifications.has(specificationKey)) {
      throw new Error(
        `Unexpected or duplicate prepared center ${specificationKey}`,
      );
    }
    seenSpecifications.add(specificationKey);

    if (point.display_label !== specification.displayLabel) {
      throw new Error(
        `${point.id} must use display label ${specification.displayLabel}`,
      );
    }
    if (point.namespace !== specification.namespace) {
      throw new Error(
        `${point.id} must use namespace ${specification.namespace}`,
      );
    }
    if (!point.coordinate_semantics.toLowerCase().includes("applied")) {
      throw new Error(
        `${point.id} must describe its simulator-applied coordinates`,
      );
    }
    if (point.coarse_point_id === undefined) {
      const searchResult = point.search_result;
      const bestLoss = searchResult?.best_loss;
      const bestLossPrompt = searchResult?.best_loss_prompt;
      const bestClipScorePrompt =
        searchResult?.best_clip_score_prompt;
      const bestLossSoftmax = searchResult?.best_loss_softmax;
      if (
        !searchResult ||
        !searchResult.provenance.trim() ||
        !point.score_warning?.trim() ||
        typeof bestLoss !== "number" ||
        !Number.isFinite(bestLoss) ||
        typeof bestLossPrompt !== "number" ||
        !Number.isFinite(bestLossPrompt) ||
        typeof bestClipScorePrompt !== "number" ||
        !Number.isFinite(bestClipScorePrompt) ||
        typeof bestLossSoftmax !== "number" ||
        !Number.isFinite(bestLossSoftmax)
      ) {
        throw new Error(
          `${point.display_label} requires all CLIP/loss values, search provenance, and a score warning`,
        );
      }
      if (
        Math.abs(bestClipScorePrompt + bestLossPrompt) > 1e-9
      ) {
        throw new Error(
          `${point.display_label} must define best_clip_score_prompt as -best_loss_prompt`,
        );
      }
    }
    if (
      !point.media.poster ||
      !point.media.video ||
      !point.media.parameters ||
      !point.media.initial_field
    ) {
      throw new Error(
        `${point.display_label} requires poster, video, parameters, and initial-field assets`,
      );
    }
    const centerPoster = point.media.poster;
    const centerVideo = point.media.video;
    const centerInitialField = point.media.initial_field;
    if (
      specification.coordinates &&
      coordinateValues(point.coordinates).some(
        (value, index) => value !== specification.coordinates?.[index],
      )
    ) {
      throw new Error(
        `${point.id} does not use its exact applied coordinates`,
      );
    }
    if (
      specification.sourceReportedCoordinates &&
      coordinateValues(point.source_reported_coordinates).some(
        (value, index) =>
          value !== specification.sourceReportedCoordinates?.[index],
      )
    ) {
      throw new Error(
        `${point.id} does not preserve its exact source-reported coordinates`,
      );
    }
    if (
      point.coarse_point_id !== undefined &&
      coordinateValues(point.source_reported_coordinates).some(
        (value, index) =>
          value !== coordinateValues(point.coordinates)[index],
      )
    ) {
      throw new Error(
        `${point.id} canonical source-reported coordinates must match its applied coordinates`,
      );
    }

    const neighborhood = catalog.neighborhoods.find(
      (candidate) =>
        candidate.id === point.refinement_neighborhood_id &&
        candidate.center_featured_id === point.id,
    );
    if (!neighborhood) {
      throw new Error(
        `${point.display_label} is missing its referenced neighborhood`,
      );
    }
    if (neighborhood.shared_media) {
      if (
        Object.prototype.hasOwnProperty.call(
          neighborhood.shared_media,
          "video",
        ) &&
        neighborhood.shared_media.video?.sha256 !== centerVideo.sha256
      ) {
        throw new Error(
          `${point.display_label} shared media must reuse its center video`,
        );
      }
      if (
        Object.prototype.hasOwnProperty.call(
          neighborhood.shared_media,
          "poster",
        ) &&
        neighborhood.shared_media.poster?.sha256 !== centerPoster.sha256
      ) {
        throw new Error(
          `${point.display_label} shared media must reuse its center poster`,
        );
      }
    }
    let inheritedInitialField = centerInitialField;
    if (
      neighborhood.shared_media &&
      Object.prototype.hasOwnProperty.call(
        neighborhood.shared_media,
        "initial_field",
      )
    ) {
      const sharedInitialField = neighborhood.shared_media.initial_field;
      if (!sharedInitialField) {
        throw new Error(
          `${point.display_label} shared media must not suppress its selected initial field`,
        );
      }
      if (sharedInitialField.sha256 !== centerInitialField.sha256) {
        throw new Error(
          `${point.display_label} shared media must reuse its center initial field`,
        );
      }
      inheritedInitialField = sharedInitialField;
    }
    const expectedSampleCount = specification.maximumScanIndex + 1;
    if (neighborhood.samples.length !== expectedSampleCount) {
      throw new Error(
        `${point.display_label} requires exactly ${expectedSampleCount} neighborhood samples`,
      );
    }
    const expectedVariations = new Map(
      getPreparedVariationExpectations(point, manifest).map(
        (variation) => [variation.scanIndex, variation] as const,
      ),
    );
    if (expectedVariations.size !== specification.maximumScanIndex) {
      throw new Error(
        `${point.display_label} deterministic scan mapping produced ${expectedVariations.size} variations instead of ${specification.maximumScanIndex}`,
      );
    }
    const expectedAxes = {
      m_local: [
        ...new Set([
          point.coordinates.m_local,
          ...[...expectedVariations.values()].map(
            ({ coordinates }) => coordinates.m_local,
          ),
        ]),
      ].sort((left, right) => left - right),
      m_cross: [
        ...new Set([
          point.coordinates.m_cross,
          ...[...expectedVariations.values()].map(
            ({ coordinates }) => coordinates.m_cross,
          ),
        ]),
      ].sort((left, right) => left - right),
      alpha: [
        ...new Set([
          point.coordinates.alpha,
          ...[...expectedVariations.values()].map(
            ({ coordinates }) => coordinates.alpha,
          ),
        ]),
      ].sort((left, right) => left - right),
    };
    for (const axisName of [
      "m_local",
      "m_cross",
      "alpha",
    ] as const) {
      const actualAxis = neighborhood.axes[axisName];
      const expectedAxis = expectedAxes[axisName];
      if (
        actualAxis.length !== expectedAxis.length ||
        actualAxis.some(
          (value, index) => value !== expectedAxis[index],
        )
      ) {
        throw new Error(
          `${point.display_label} ${axisName} axis does not match the authoritative sampled coordinates`,
        );
      }
    }

    const scans = new Map<number, FeaturedSample>();
    let centerCount = 0;
    for (const sample of neighborhood.samples) {
      if (
        sample.media &&
        Object.prototype.hasOwnProperty.call(sample.media, "poster") &&
        sample.media.poster?.sha256 !== centerPoster.sha256
      ) {
        throw new Error(
          `${point.display_label} samples must reuse the center poster`,
        );
      }
      if (
        sample.media &&
        Object.prototype.hasOwnProperty.call(sample.media, "initial_field")
      ) {
        const sampleInitialField = sample.media.initial_field;
        if (!sampleInitialField) {
          throw new Error(
            `${point.display_label} samples must not suppress the selected initial field`,
          );
        }
        if (sampleInitialField.sha256 !== inheritedInitialField.sha256) {
          throw new Error(
            `${point.display_label} samples must reuse the selected initial field`,
          );
        }
      }
      if (isCenterSample(sample, point)) {
        centerCount += 1;
        if (
          sample.status !== "self_replicator" ||
          sample.scan_index !== undefined
        ) {
          throw new Error(
            `${point.display_label} center must be an unnumbered self-replicator`,
          );
        }
        if (
          sample.media &&
          Object.prototype.hasOwnProperty.call(sample.media, "video") &&
          sample.media.video?.sha256 !== centerVideo.sha256
        ) {
          throw new Error(
            `${point.display_label} center sample must reuse its center video`,
          );
        }
        positiveCount += 1;
        continue;
      }

      const scanIndex = sample.scan_index;
      if (
        typeof scanIndex !== "number" ||
        !Number.isInteger(scanIndex) ||
        scanIndex < 1 ||
        scanIndex > specification.maximumScanIndex ||
        scans.has(scanIndex)
      ) {
        throw new Error(
          `${point.display_label} has an invalid or duplicate non-center scan_index`,
        );
      }
      if (
        !sample.media ||
        !Object.prototype.hasOwnProperty.call(sample.media, "video") ||
        sample.media.video !== null
      ) {
        throw new Error(
          `${point.display_label} scan ${scanIndex} must explicitly set media.video to null`,
        );
      }
      const requiredStatus = expectedStatus(
        scanIndex,
        specification.nonreplicatorRanges,
      );
      if (sample.status !== requiredStatus) {
        throw new Error(
          `${point.display_label} scan ${scanIndex} must be ${requiredStatus}`,
        );
      }
      const expectedVariation = expectedVariations.get(scanIndex);
      if (
        !expectedVariation ||
        coordinateValues(sample.coordinates).some(
          (value, index) =>
            value !== coordinateValues(expectedVariation.coordinates)[index],
        )
      ) {
        throw new Error(
          `${point.display_label} scan ${scanIndex} does not match the authoritative variation coordinates`,
        );
      }
      const expectedGridIndex: readonly [number, number, number] = [
        neighborhood.axes.m_local.indexOf(
          expectedVariation.coordinates.m_local,
        ),
        neighborhood.axes.m_cross.indexOf(
          expectedVariation.coordinates.m_cross,
        ),
        neighborhood.axes.alpha.indexOf(
          expectedVariation.coordinates.alpha,
        ),
      ];
      if (
        sample.grid_index.some(
          (value, index) => value !== expectedGridIndex[index],
        )
      ) {
        throw new Error(
          `${point.display_label} scan ${scanIndex} does not match the authoritative grid index`,
        );
      }
      if (
        trailingVariationNumber(sample.variation_label) !==
        expectedVariation.variationLabel
      ) {
        throw new Error(
          `${point.display_label} scan ${scanIndex} does not match variation label ${expectedVariation.variationLabel}`,
        );
      }
      scans.set(scanIndex, sample);
      if (sample.status === "self_replicator") positiveCount += 1;
      else negativeCount += 1;
    }
    if (centerCount !== 1) {
      throw new Error(
        `${point.display_label} requires exactly one center sample`,
      );
    }
    for (
      let scanIndex = 1;
      scanIndex <= specification.maximumScanIndex;
      scanIndex += 1
    ) {
      if (!scans.has(scanIndex)) {
        throw new Error(
          `${point.display_label} is missing scan_index ${scanIndex}`,
        );
      }
    }
  }

  if (seenSpecifications.size !== PREPARED_CENTER_SPECIFICATIONS.size) {
    throw new Error(
      "Prepared first publication is missing one or more required centers",
    );
  }
  if (positiveCount !== 145 || negativeCount !== 2760) {
    throw new Error(
      `Prepared first publication requires 145 replicator and 2,760 nonreplicator samples; found ${positiveCount} and ${negativeCount}`,
    );
  }
}
