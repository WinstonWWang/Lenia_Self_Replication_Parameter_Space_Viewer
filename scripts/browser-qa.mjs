import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import * as THREE from "three";

const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:5173/";
const browserChannel = process.env.QA_BROWSER_CHANNEL ?? "msedge";
const outputDirectory = new URL("../.qa/", import.meta.url);
const featuredCatalogUrl = new URL(
  "__qa__/featured-catalog.json",
  baseUrl,
).href;
const qaManifestPointerUrl = new URL(
  "__qa__/unavailable-manifest-pointer.json",
  baseUrl,
).href;

const OFF_GRID_FEATURES = [
  {
    id: "preclassification_sobol_triple_00075",
    displayLabel: "triple_00075",
    namespace: "preclassification_sobol",
    coordinates: {
      m_local: 0.3152100145816803,
      m_cross: 0.17585211992263794,
      alpha: 0.7561357617378235,
    },
  },
  {
    id: "preclassification_sobol_triple_00891",
    displayLabel: "triple_00891",
    namespace: "preclassification_sobol",
    coordinates: {
      m_local: 0.2847903370857239,
      m_cross: 0.1466793417930603,
      alpha: 0.2798478901386261,
    },
  },
  {
    id: "reference_triple_original",
    displayLabel: "triple_original",
    namespace: "reference",
    coordinates: {
      m_local: 0.2196178287267685,
      m_cross: 0.06508693099021912,
      alpha: 0.4492952340663093,
    },
  },
];

const CANONICAL_LINKED_FEATURES = [
  {
    id: "canonical_featured_triple_01210",
    displayLabel: "triple_01210",
    namespace: "canonical_grid",
    coarsePointId: "triple_01210",
    coordinates: {
      m_local: 0.15789473056793213,
      m_cross: 0,
      alpha: 0.5263158082962036,
    },
  },
  {
    id: "canonical_featured_triple_01608",
    displayLabel: "triple_01608",
    namespace: "canonical_grid",
    coarsePointId: "triple_01608",
    coordinates: {
      m_local: 0.21052631735801697,
      m_cross: 0,
      alpha: 0.42105263471603394,
    },
  },
];

function makeAxis(center, maximum, step = 0.005) {
  if (center - step >= 0 && center + step <= maximum) {
    return [center - step, center, center + step];
  }
  if (center + step * 2 <= maximum) {
    return [center, center + step, center + step * 2];
  }
  return [center - step * 2, center - step, center];
}

function makeFeaturedCatalog() {
  const specs = [...OFF_GRID_FEATURES, ...CANONICAL_LINKED_FEATURES];
  const neighborhoods = [];
  const featuredPoints = specs.map((spec, featureIndex) => {
    const neighborhoodId = `neighborhood_${spec.id}`;
    const axes = {
      m_local: makeAxis(spec.coordinates.m_local, 1),
      m_cross: makeAxis(spec.coordinates.m_cross, 7.31913948059082),
      alpha: makeAxis(spec.coordinates.alpha, 1),
    };
    const centerIndex = [
      axes.m_local.indexOf(spec.coordinates.m_local),
      axes.m_cross.indexOf(spec.coordinates.m_cross),
      axes.alpha.indexOf(spec.coordinates.alpha),
    ];
    const samples = [];

    for (let i = 0; i < axes.m_local.length; i += 1) {
      for (let j = 0; j < axes.m_cross.length; j += 1) {
        for (let k = 0; k < axes.alpha.length; k += 1) {
          const isCenter =
            i === centerIndex[0] &&
            j === centerIndex[1] &&
            k === centerIndex[2];
          if (!isCenter && featureIndex !== 0) continue;
          samples.push({
            grid_index: [i, j, k],
            coordinates: {
              m_local: axes.m_local[i],
              m_cross: axes.m_cross[j],
              alpha: axes.alpha[k],
            },
            status: isCenter ? "self_replicator" : "nonreplicator",
            ...(isCenter
              ? {}
              : {
                  scan_index: samples.length + 1,
                  variation_label: `QA variation ${i},${j},${k}`,
                  media: { video: null },
                }),
          });
        }
      }
    }

    neighborhoods.push({
      id: neighborhoodId,
      center_featured_id: spec.id,
      axes,
      samples,
    });

    return {
      id: spec.id,
      display_label: spec.displayLabel,
      namespace: spec.namespace,
      ...(spec.coarsePointId
        ? { coarse_point_id: spec.coarsePointId }
        : {}),
      coordinates: spec.coordinates,
      source_reported_coordinates: spec.coordinates,
      coordinate_semantics: "Exact simulator-applied coordinates.",
      status: "self_replicator",
      reviewed_at: "2026-07-27T00:00:00Z",
      refinement_neighborhood_id: neighborhoodId,
      media: {
        poster: null,
        video: null,
        parameters: null,
        initial_field: null,
      },
      search_result: {
        provenance: "Synthetic browser-QA record; not scientific evidence.",
        best_loss: -0.5,
        best_loss_prompt: -0.25,
        best_clip_score_prompt: 0.25,
        best_loss_softmax: -0.25,
      },
      score_warning: "Search score, not replication verification.",
      center_video_world_pixels: 800,
      refinement_simulation_world_pixels: 256,
      world_size_comparison_note:
        "Center and variation replays use different world sizes.",
    };
  });

  return {
    schema_version: 1,
    dataset_id: "product-lenia-mlocal-mcross-alpha-v1",
    generated_at: "2026-07-27T00:00:00Z",
    featured_points: featuredPoints,
    neighborhoods,
  };
}

async function hoverCanvasForTooltip(page, textPattern) {
  const canvas = page.locator(".cube-viewer canvas");
  const box = await canvas.boundingBox();
  assert.ok(box, "The 3D canvas should have a visible bounding box.");

  for (let row = 1; row <= 15; row += 1) {
    for (let column = 1; column <= 15; column += 1) {
      const x = box.x + (box.width * column) / 16;
      const y = box.y + (box.height * row) / 16;
      await page.mouse.move(x, y);
      await page.waitForTimeout(20);
      const tooltip = page.locator(".cube-viewer__tooltip");
      if (
        (await tooltip.count()) > 0 &&
        textPattern.test((await tooltip.textContent()) ?? "")
      ) {
        return { x, y };
      }
    }
  }
  return null;
}

async function projectedCanvasPoint(page, coordinates) {
  const canvas = page.locator(".cube-viewer canvas");
  const box = await canvas.boundingBox();
  assert.ok(box, "The 3D canvas should have a visible bounding box.");
  const camera = new THREE.PerspectiveCamera(
    42,
    box.width / box.height,
    0.01,
    100,
  );
  camera.position.set(3.4, 3, 3.4);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const world = new THREE.Vector3(
    -1 + 2 * coordinates.m_local,
    -1 + (2 * coordinates.m_cross) / 7.31913948059082,
    -1 + 2 * coordinates.alpha,
  ).project(camera);
  return {
    x: box.x + ((world.x + 1) / 2) * box.width,
    y: box.y + ((1 - world.y) / 2) * box.height,
  };
}

await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({
  channel: browserChannel,
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
const pageErrors = [];

page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(error.message));

try {
  const featuredCatalog = makeFeaturedCatalog();
  await page.route(featuredCatalogUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(featuredCatalog),
    });
  });
  await page.route(qaManifestPointerUrl, async (route) => {
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "Intentionally unavailable in QA" }),
    });
  });
  await page.route(/\/site-config\.json(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    assert.ok(response.ok(), "The underlying site configuration should load.");
    const config = await response.json();
    await route.fulfill({
      response,
      json: {
        ...config,
        manifest_pointer_url: qaManifestPointerUrl,
        featured_catalog_url: featuredCatalogUrl,
      },
    });
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", {
    name: "Lenia Self-Replication Parameter Space Viewer",
  }).waitFor({ timeout: 30_000 });
  await page.locator(".cube-viewer canvas").waitFor({ timeout: 30_000 });
  await page
    .getByText("8,000 grid points + 3 exact off-grid replicators", {
      exact: true,
    })
    .waitFor({ timeout: 30_000 });

  assert.equal(
    await page.locator(".alpha-slice-button").count(),
    21,
    "The sidebar should contain full-cube plus 20 alpha choices.",
  );
  assert.equal(
    await page.getByLabel("Point status legend").count(),
    1,
    "The cube should show exactly one point-status legend.",
  );
  const unresolvedFilter = page.getByRole("button", {
    name: "Unresolved",
    exact: true,
  });
  await unresolvedFilter.click();
  assert.equal(await unresolvedFilter.getAttribute("aria-pressed"), "false");
  await unresolvedFilter.click();
  assert.equal(await unresolvedFilter.getAttribute("aria-pressed"), "true");
  await page.waitForTimeout(1_200);
  await page.screenshot({
    path: fileURLToPath(new URL("desktop-1440x900.png", outputDirectory)),
  });

  let canvas = page.locator(".cube-viewer canvas");
  const canvasBox = await canvas.boundingBox();
  assert.ok(canvasBox, "The 3D canvas should have a visible bounding box.");

  let foundPointTooltip = false;
  let hoveredPointLocation = null;
  for (let row = 2; row <= 8 && !foundPointTooltip; row += 1) {
    for (let column = 2; column <= 8 && !foundPointTooltip; column += 1) {
      const x = canvasBox.x + (canvasBox.width * column) / 10;
      const y = canvasBox.y + (canvasBox.height * row) / 10;
      await page.mouse.move(x, y);
      await page.waitForTimeout(20);
      const tooltip = page.locator(".cube-viewer__tooltip");
      foundPointTooltip =
        (await tooltip.count()) > 0 &&
        !((await tooltip.textContent()) ?? "").includes("Featured off-grid");
      if (foundPointTooltip) hoveredPointLocation = { x, y };
    }
  }
  assert.ok(foundPointTooltip, "Hovering a rendered point should show its triple.");
  assert.ok(hoveredPointLocation);
  await page.mouse.click(hoveredPointLocation.x, hoveredPointLocation.y);
  await page.locator(".detail-panel").waitFor();
  assert.match(page.url(), /\?point=triple_\d{5}$/);

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  canvas = page.locator(".cube-viewer canvas");
  await canvas.waitFor({ timeout: 30_000 });
  const interactionCanvasBox = await canvas.boundingBox();
  assert.ok(
    interactionCanvasBox,
    "The reloaded 3D canvas should have a visible bounding box.",
  );

  const beforePan = await canvas.screenshot();
  await page.mouse.move(
    interactionCanvasBox.x + interactionCanvasBox.width / 2,
    interactionCanvasBox.y + interactionCanvasBox.height / 2,
  );
  await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.move(
    interactionCanvasBox.x + interactionCanvasBox.width / 2 + 120,
    interactionCanvasBox.y + interactionCanvasBox.height / 2 - 80,
    { steps: 10 },
  );
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await page.waitForTimeout(500);
  const afterPan = await canvas.screenshot();
  assert.ok(!beforePan.equals(afterPan), "Panning should change the view.");

  await page.mouse.move(
    interactionCanvasBox.x + interactionCanvasBox.width / 2,
    interactionCanvasBox.y + interactionCanvasBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    interactionCanvasBox.x + interactionCanvasBox.width / 2 + 90,
    interactionCanvasBox.y + interactionCanvasBox.height / 2 + 45,
    { steps: 8 },
  );
  await page.mouse.up();
  await page.waitForTimeout(200);
  const afterOrbit = await canvas.screenshot();
  assert.ok(!afterPan.equals(afterOrbit), "Orbiting should change the view.");

  await page.mouse.move(
    interactionCanvasBox.x + interactionCanvasBox.width / 2,
    interactionCanvasBox.y + interactionCanvasBox.height / 2,
  );
  await page.mouse.down({ button: "right" });
  await page.mouse.move(
    interactionCanvasBox.x + interactionCanvasBox.width / 2 - 110,
    interactionCanvasBox.y + interactionCanvasBox.height / 2 + 65,
    { steps: 10 },
  );
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(500);
  const afterRightPan = await canvas.screenshot();
  assert.ok(
    !afterOrbit.equals(afterRightPan),
    "Right-drag panning should change the view after orbiting.",
  );

  await canvas.dispatchEvent("wheel", {
    bubbles: true,
    cancelable: true,
    clientX: interactionCanvasBox.x + interactionCanvasBox.width / 2,
    clientY: interactionCanvasBox.y + interactionCanvasBox.height / 2,
    deltaMode: 0,
    deltaX: 0,
    deltaY: 900,
  });
  await page.waitForTimeout(500);
  const afterZoom = await canvas.screenshot();
  assert.ok(
    !afterRightPan.equals(afterZoom),
    "Zooming should change the view.",
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".cube-viewer canvas").waitFor({ timeout: 30_000 });

  const search = page.getByRole("textbox", {
    name: "Find a parameter triple",
  });
  await search.fill("(0.0526, 1.92, 0.16)");
  await page.getByRole("button", { name: "Search" }).click();
  await page.locator(".detail-panel").waitFor();
  await page.getByText(/Snapped to tested point/).waitFor();
  assert.match(page.url(), /\?point=triple_00503$/);
  await page.getByText("CLIP score", { exact: true }).waitFor();
  assert.match(
    (await page.locator(".detail-panel__score-warning").textContent()) ?? "",
    /Search score, not replication verification.*-loss_prompt; higher is better/,
  );
  await page.getByText("ASAL search context", { exact: true }).waitFor();
  await page.getByText("900 s", { exact: true }).waitFor();
  await page
    .getByText(/Completed points may have 300-second or 900-second budgets/)
    .waitFor();
  await page
    .getByText("Static search report — video unavailable.", { exact: true })
    .waitFor();

  const alphaButton = page.getByRole("button", {
    name: "Show alpha slice 0.158",
  });
  await alphaButton.click();
  assert.equal(await alphaButton.getAttribute("aria-pressed"), "true");
  await page
    .getByLabel(
      "Interactive two-dimensional Lenia parameter grid for alpha 0.158. Drag to pan or scroll to zoom. Hover or select a point for its parameter triple.",
    )
    .waitFor();
  await page
    .getByText(
      "Drag to pan · scroll to zoom · press Esc for the full cube",
      { exact: true },
    )
    .waitFor();
  await page.waitForTimeout(1_200);
  await page.locator(".viewer-card").screenshot({
    path: fileURLToPath(new URL("alpha-slice-0.158.png", outputDirectory)),
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", {
    name: "Show the full parameter cube",
  }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Show the full parameter cube" })
      .getAttribute("aria-pressed"),
    "true",
  );

  await page.getByRole("button", { name: "Dynamics" }).click();
  await page
    .getByRole("dialog", { name: "Dynamics equations" })
    .waitFor();
  assert.equal(
    await page.locator(".dynamics-drawer__equation").count(),
    11,
    "The dynamics drawer should contain the full implemented equation set.",
  );
  await page.waitForTimeout(300);
  await page.screenshot({
    path: fileURLToPath(new URL("dynamics-drawer.png", outputDirectory)),
  });
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Dynamics equations" }).waitFor({
    state: "detached",
  });

  for (const status of [
    "Unresolved",
    "Experimentally dead",
    "Physically uninteresting",
  ]) {
    const filter = page.getByRole("button", { name: status, exact: true });
    if ((await filter.getAttribute("aria-pressed")) === "true") {
      await filter.click();
    }
  }
  const projectedFeature = await projectedCanvasPoint(
    page,
    OFF_GRID_FEATURES[0].coordinates,
  );
  await page.mouse.move(projectedFeature.x, projectedFeature.y);
  await page
    .getByText(/Featured off-grid · triple_00075/)
    .waitFor({ timeout: 5_000 });
  await page.mouse.click(projectedFeature.x, projectedFeature.y);
  await page
    .locator(
      '[data-featured-point-id="preclassification_sobol_triple_00075"]',
    )
    .waitFor();
  assert.equal(
    new URL(page.url()).searchParams.get("featured"),
    "preclassification_sobol_triple_00075",
    "Clicking the exact global off-grid marker should select its namespaced identity.",
  );
  await page.keyboard.press("Escape");
  await page
    .getByText(/Featured local neighborhood for triple_00075 is displayed/)
    .waitFor({ state: "detached" });

  await search.fill("triple_00075");
  const featuredSuggestion = page.getByRole("button", {
    name: "Select featured off-grid triple_00075",
  });
  await featuredSuggestion.waitFor();
  await featuredSuggestion.click();
  const featuredDetail = page.locator(
    '[data-featured-point-id="preclassification_sobol_triple_00075"]',
  );
  await featuredDetail.waitFor();
  let selectedUrl = new URL(page.url());
  assert.equal(
    selectedUrl.searchParams.get("featured"),
    "preclassification_sobol_triple_00075",
  );
  assert.equal(
    selectedUrl.searchParams.get("point"),
    null,
    "A featured selection must not retain the collision-prone coarse query.",
  );
  await featuredDetail
    .getByText("Featured off-grid", { exact: true })
    .waitFor();
  for (const exactValue of [
    "0.3152100145816803",
    "0.17585211992263794",
    "0.7561357617378235",
  ]) {
    await featuredDetail.getByText(exactValue, { exact: true }).first().waitFor();
  }
  await featuredDetail
    .getByText("preclassification_sobol_triple_00075", { exact: true })
    .waitFor();
  await page
    .getByText(
      /Featured local neighborhood for triple_00075 is displayed\. The white marker identifies its selected center or variation\./,
    )
    .waitFor();
  await page.waitForTimeout(500);
  await page.locator(".viewer-card").screenshot({
    path: fileURLToPath(
      new URL("featured-off-grid-selected.png", outputDirectory),
    ),
  });

  const featuredAlphaButton = page.getByRole("button", {
    name: "Show alpha slice 0.737",
  });
  await featuredAlphaButton.click();
  assert.equal(
    await featuredAlphaButton.getAttribute("aria-pressed"),
    "true",
    "The exact off-grid point should be assignable to its nearest alpha slab.",
  );
  await page
    .getByLabel(
      "Interactive two-dimensional Lenia parameter grid for alpha 0.737. Drag to pan or scroll to zoom. Hover or select a point for its parameter triple.",
    )
    .waitFor();
  await page
    .getByText(
      /Featured neighborhood plane at exact alpha 0\.7561357617378235 is displayed within coarse alpha slab 0\.736842/,
    )
    .waitFor();
  await page.waitForTimeout(500);
  await page.locator(".viewer-card").screenshot({
    path: fileURLToPath(
      new URL("featured-off-grid-alpha-slice.png", outputDirectory),
    ),
  });

  await search.fill(
    "(0.3152100145816803, 0.17585211992263794, 0.7561357617378235)",
  );
  await page.getByRole("button", { name: "Search" }).click();
  await page
    .getByText(
      /Selected Featured off-grid triple_00075 at exact coordinates/,
    )
    .waitFor();
  selectedUrl = new URL(page.url());
  assert.equal(
    selectedUrl.searchParams.get("featured"),
    "preclassification_sobol_triple_00075",
    "An exact-coordinate search should select the feature without snapping.",
  );
  assert.equal(selectedUrl.searchParams.get("point"), null);

  await page.waitForTimeout(500);
  const variationLocation = await hoverCanvasForTooltip(
    page,
    /QA variation/,
  );
  assert.ok(
    variationLocation,
    "A local featured variation should be hoverable in the focused view.",
  );
  await page.mouse.click(variationLocation.x, variationLocation.y);
  await featuredDetail.getByText("Selected variation", { exact: true }).waitFor();
  await featuredDetail.getByText(/QA variation/).waitFor();
  await featuredDetail
    .getByText("No individual variation replay was generated", {
      exact: true,
    })
    .waitFor();
  await page.screenshot({
    path: fileURLToPath(
      new URL("featured-off-grid-variation.png", outputDirectory),
    ),
  });

  await search.fill("(0.0526, 1.92, 0.16)");
  await page.getByRole("button", { name: "Search" }).click();
  await page
    .locator('.detail-panel[data-point-id="triple_00503"]')
    .waitFor();
  assert.equal(new URL(page.url()).searchParams.get("point"), "triple_00503");
  await page.goBack();
  await featuredDetail.waitFor();
  assert.equal(
    new URL(page.url()).searchParams.get("featured"),
    "preclassification_sobol_triple_00075",
    "Back navigation should restore the featured discriminated selection.",
  );
  await page.goForward();
  await page
    .locator('.detail-panel[data-point-id="triple_00503"]')
    .waitFor();
  assert.equal(
    new URL(page.url()).searchParams.get("point"),
    "triple_00503",
    "Forward navigation should restore the coarse selection.",
  );

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(1_200);
  await page.screenshot({
    path: fileURLToPath(new URL("desktop-1280x720.png", outputDirectory)),
  });
  assert.ok(
    (await page.locator(".viewer-column").boundingBox())?.width > 300,
    "The cube panel should remain usable at 1280×720.",
  );
  assert.ok(
    (await page.locator(".detail-panel").boundingBox())?.width > 300,
    "The detail panel should remain usable at 1280×720.",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({
    path: fileURLToPath(new URL("phone-390x844.png", outputDirectory)),
    fullPage: true,
  });
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert.ok(
    horizontalOverflow <= 1,
    `Phone layout has ${horizontalOverflow}px of unintended horizontal overflow.`,
  );
  const mobileSidebar = await page.locator(".alpha-sidebar").boundingBox();
  const mobileCube = await page.locator(".viewer-column").boundingBox();
  const mobileDetail = await page.locator(".detail-panel").boundingBox();
  assert.ok(mobileSidebar && mobileCube && mobileDetail);
  assert.ok(mobileSidebar.y < mobileCube.y);
  assert.ok(mobileCube.y < mobileDetail.y);

  const deepLink = new URL(baseUrl);
  deepLink.searchParams.set("point", "triple_00503");
  await page.goto(deepLink.href, { waitUntil: "domcontentloaded" });
  await page
    .locator('.detail-panel[data-point-id="triple_00503"]')
    .waitFor({ timeout: 30_000 });

  const deadLink = new URL(baseUrl);
  deadLink.searchParams.set("point", "triple_00431");
  await page.goto(deadLink.href, { waitUntil: "domcontentloaded" });
  await page
    .locator('.detail-panel[data-point-id="triple_00431"]')
    .waitFor({ timeout: 30_000 });
  await page.getByText("Experimentally dead", { exact: true }).first().waitFor();
  await page
    .getByText(
      /Tested over 20 random Voronoi polygons, 20 random 2D Gaussians, and 20 random Fourier curves/,
    )
    .waitFor();
  assert.equal(
    await page.locator(".video-panel__frame").evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
    "rgb(0, 0, 0)",
    "Experimentally dead points should retain a black replay placeholder.",
  );

  const cutoffLink = new URL(baseUrl);
  cutoffLink.searchParams.set("point", "triple_00000");
  await page.goto(cutoffLink.href, { waitUntil: "domcontentloaded" });
  await page
    .locator('.detail-panel[data-point-id="triple_00000"]')
    .waitFor({ timeout: 30_000 });
  await page
    .getByText("Physically uninteresting", { exact: true })
    .first()
    .waitFor();
  await page.getByText(/not tested/i).first().waitFor();

  for (const canonicalId of ["triple_00075", "triple_00891"]) {
    const canonicalCollisionLink = new URL(baseUrl);
    canonicalCollisionLink.searchParams.set("point", canonicalId);
    await page.goto(canonicalCollisionLink.href, {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator(`.detail-panel[data-point-id="${canonicalId}"]`)
      .waitFor({ timeout: 30_000 });
    assert.equal(
      await page.locator("[data-featured-point-id]").count(),
      0,
      `${canonicalId} must remain the canonical grid record when selected through ?point=.`,
    );
  }

  for (const feature of OFF_GRID_FEATURES) {
    const featuredDeepLink = new URL(baseUrl);
    featuredDeepLink.searchParams.set("featured", feature.id);
    await page.goto(featuredDeepLink.href, {
      waitUntil: "domcontentloaded",
    });
    await page
      .locator(`[data-featured-point-id="${feature.id}"]`)
      .waitFor({ timeout: 30_000 });
    const currentUrl = new URL(page.url());
    assert.equal(currentUrl.searchParams.get("featured"), feature.id);
    assert.equal(
      currentUrl.searchParams.get("point"),
      null,
      "A featured deep link should use only its namespaced featured ID.",
    );
  }
  const featuredMobileOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert.ok(
    featuredMobileOverflow <= 1,
    `Featured phone layout has ${featuredMobileOverflow}px of unintended horizontal overflow.`,
  );

  const ambiguousLink = new URL(baseUrl);
  ambiguousLink.searchParams.set("point", "triple_00075");
  ambiguousLink.searchParams.set(
    "featured",
    "preclassification_sobol_triple_00075",
  );
  await page.goto(ambiguousLink.href, { waitUntil: "domcontentloaded" });
  await page
    .locator(
      '[data-featured-point-id="preclassification_sobol_triple_00075"]',
    )
    .waitFor({ timeout: 30_000 });
  await page.waitForURL((url) => !url.searchParams.has("point"));
  assert.equal(
    new URL(page.url()).searchParams.get("featured"),
    "preclassification_sobol_triple_00075",
    "The featured query should win an ambiguous deep link.",
  );

  const linkedFeaturedLink = new URL(baseUrl);
  linkedFeaturedLink.searchParams.set(
    "featured",
    "canonical_featured_triple_01210",
  );
  await page.goto(linkedFeaturedLink.href, {
    waitUntil: "domcontentloaded",
  });
  await page.locator(".cube-viewer canvas").waitFor({ timeout: 30_000 });
  await page.waitForURL((url) => !url.searchParams.has("featured"));
  assert.equal(
    await page.locator("[data-featured-point-id]").count(),
    0,
    "A canonical-linked catalog record must not be selectable through the off-grid featured route.",
  );

  const relevantConsoleErrors = consoleErrors.filter(
    (message) => !message.includes("Failed to load resource"),
  );
  assert.deepEqual(pageErrors, [], "The page emitted uncaught runtime errors.");
  assert.deepEqual(
    relevantConsoleErrors,
    [],
    "The page emitted unexpected console errors.",
  );

  console.log(
    JSON.stringify(
      {
        passed: true,
        viewports: ["1440x900", "1280x720", "390x844"],
        verifiedAlphaSlice: "0.158",
        verifiedPoints: [
          "triple_00503",
          "triple_00431",
          "triple_00000",
        ],
        verifiedFeaturedPoints: OFF_GRID_FEATURES.map((point) => point.id),
        verifiedFeaturedCatalogCenters: featuredCatalog.featured_points.length,
        screenshots: ".qa/",
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
