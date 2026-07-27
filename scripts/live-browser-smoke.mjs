import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const baseUrl =
  process.env.SMOKE_BASE_URL ??
  "https://winstonwwang.github.io/Lenia_Self_Replication_Parameter_Space_Viewer/";
const browserChannel = process.env.QA_BROWSER_CHANNEL ?? "msedge";
const outputDirectory = new URL("../.qa/", import.meta.url);
const featuredIds = [
  "preclassification_sobol_triple_00075",
  "preclassification_sobol_triple_00891",
  "reference_triple_original",
];

await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({
  channel: browserChannel,
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
const pageErrors = [];
const errorResponses = [];

page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("response", (response) => {
  if (response.status() >= 400) {
    errorResponses.push({
      status: response.status(),
      url: response.url(),
    });
  }
});

try {
  for (const featuredId of featuredIds) {
    const url = new URL(baseUrl);
    url.searchParams.set("featured", featuredId);
    await page.goto(url.href, { waitUntil: "domcontentloaded" });
    const detail = page.locator(
      `[data-featured-point-id="${featuredId}"]`,
    );
    await detail.waitFor({ timeout: 60_000 });
    assert.equal(
      new URL(page.url()).searchParams.get("featured"),
      featuredId,
    );
    assert.match(
      (await detail.locator(".detail-panel__status").textContent()) ?? "",
      /self-replicator/i,
    );
    assert.match(
      (await page
        .locator(".cube-viewer__refinement-status")
        .textContent()) ?? "",
      /Featured local neighborhood/,
    );
  }

  const canonicalUrl = new URL(baseUrl);
  canonicalUrl.searchParams.set("point", "triple_01608");
  await page.goto(canonicalUrl.href, { waitUntil: "domcontentloaded" });
  const canonicalDetail = page.locator(
    '.detail-panel[data-point-id="triple_01608"]',
  );
  await canonicalDetail.waitFor({ timeout: 60_000 });
  assert.equal(
    await canonicalDetail.locator(".detail-panel__status").textContent(),
    "Self-replicator",
  );
  assert.match(
    (await page
      .locator(".cube-viewer__refinement-status")
      .textContent()) ?? "",
    /Featured local neighborhood for triple_01608 is displayed/,
  );

  const video = canonicalDetail.locator(".video-panel__video");
  await video.waitFor({ timeout: 60_000 });
  await video.evaluate(
    (element) =>
      new Promise((resolve, reject) => {
        if (element.readyState >= 1) {
          resolve();
          return;
        }
        const timeout = window.setTimeout(() => {
          reject(new Error("Timed out waiting for video metadata."));
        }, 60_000);
        element.addEventListener(
          "loadedmetadata",
          () => {
            window.clearTimeout(timeout);
            resolve();
          },
          { once: true },
        );
        element.addEventListener(
          "error",
          () => {
            window.clearTimeout(timeout);
            reject(new Error("The dynamics replay failed to load."));
          },
          { once: true },
        );
      }),
  );
  const videoState = await video.evaluate((element) => ({
    readyState: element.readyState,
    width: element.videoWidth,
    height: element.videoHeight,
  }));
  assert.ok(videoState.readyState >= 1);
  assert.equal(videoState.width, 800);
  assert.equal(videoState.height, 800);
  assert.equal(
    await canonicalDetail.locator(".video-panel__placeholder").count(),
    0,
    "The loaded replay must not fall back to an error placeholder.",
  );
  assert.equal(
    await video.evaluate((element) => getComputedStyle(element).objectFit),
    "contain",
  );
  const frame = canonicalDetail.locator(".video-panel__frame");
  const frameBox = await frame.boundingBox();
  assert.ok(frameBox);
  assert.ok(
    Math.abs(frameBox.width / frameBox.height - 1) < 0.02,
    `Expected a square replay frame, found ${frameBox.width} x ${frameBox.height}.`,
  );

  await page.screenshot({
    path: fileURLToPath(
      new URL("live-triple-01608.png", outputDirectory),
    ),
    fullPage: true,
  });

  assert.deepEqual(pageErrors, [], "The page emitted runtime errors.");
  assert.deepEqual(
    errorResponses.filter(
      ({ url }) => !new URL(url).pathname.endsWith("/favicon.ico"),
    ),
    [],
    "The page received unexpected HTTP error responses.",
  );
  assert.deepEqual(
    consoleErrors.filter(
      (message) => !message.startsWith("Failed to load resource:"),
    ),
    [],
    "The page emitted unexpected console errors.",
  );

  console.log(
    JSON.stringify(
      {
        passed: true,
        baseUrl,
        verifiedFeaturedPoints: featuredIds,
        verifiedCanonicalLinkedPoint: "triple_01608",
        verifiedVideoLayout: "square, centered, contain",
        screenshot: ".qa/live-triple-01608.png",
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
