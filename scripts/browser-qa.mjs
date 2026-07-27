import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const baseUrl = process.env.QA_BASE_URL ?? "http://127.0.0.1:5173/";
const browserChannel = process.env.QA_BROWSER_CHANNEL ?? "msedge";
const outputDirectory = new URL("../.qa/", import.meta.url);

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
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", {
    name: "Lenia Self-Replication Parameter Space Viewer",
  }).waitFor({ timeout: 30_000 });
  await page.locator(".cube-viewer canvas").waitFor({ timeout: 30_000 });

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
      foundPointTooltip =
        (await page.locator(".cube-viewer__tooltip").count()) > 0;
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
        screenshots: ".qa/",
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
