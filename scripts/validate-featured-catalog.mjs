import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "vite";

const MAX_VALIDATED_ASSET_BYTES = 512 * 1024 * 1024;

function usage() {
  console.error(
    [
      "Usage: npm run validate:featured -- <featured-catalog.json> [site-manifest.json]",
      "       (--media-root <object-tree> | --asset-base-url <public-base>)",
      "       [--ffmpeg-command <executable>]",
      "       [--expect-prepared-first-publication]",
      "",
      "Asset verification is mandatory whenever the catalog references assets.",
      "The prepared-publication flag requires an explicit live-candidate manifest.",
      "Prepared publication also requires FFmpeg (default executable: ffmpeg).",
    ].join("\n"),
  );
}

function parseArguments(argv) {
  const positional = [];
  const options = {
    mediaRoot: null,
    assetBaseUrl: null,
    ffmpegCommand: null,
    expectPrepared: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      options.help = true;
    } else if (argument === "--expect-prepared-first-publication") {
      options.expectPrepared = true;
    } else if (
      argument === "--media-root" ||
      argument === "--asset-base-url" ||
      argument === "--ffmpeg-command"
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      if (argument === "--media-root") options.mediaRoot = value;
      else if (argument === "--asset-base-url") options.assetBaseUrl = value;
      else options.ffmpegCommand = value;
      index += 1;
    } else if (argument?.startsWith("--")) {
      throw new Error(`Unknown option ${argument}`);
    } else if (argument) {
      positional.push(argument);
    }
  }
  if (options.mediaRoot && options.assetBaseUrl) {
    throw new Error(
      "Use either --media-root or --asset-base-url, not both",
    );
  }
  if (positional.length > 2) {
    throw new Error("Too many positional arguments");
  }
  if (options.expectPrepared && positional.length < 2) {
    throw new Error(
      "--expect-prepared-first-publication requires the exact decoded live-candidate site manifest as the second positional argument",
    );
  }
  return {
    ...options,
    catalogArgument: positional[0] ?? null,
    manifestArgument: positional[1] ?? null,
  };
}

async function readJson(filePath, label) {
  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`${label} could not be read: ${error.message}`);
  }
  try {
    return { value: JSON.parse(text), text };
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function collectAssetReferences(catalog) {
  const references = [];
  const addMedia = (media, label) => {
    if (!media) return;
    for (const kind of [
      "poster",
      "video",
      "parameters",
      "initial_field",
    ]) {
      const asset = media[kind];
      if (asset) references.push({ asset, kind, label: `${label}.${kind}` });
    }
  };
  for (const point of catalog.featured_points) {
    addMedia(point.media, `featured point ${point.id}.media`);
  }
  for (const neighborhood of catalog.neighborhoods) {
    addMedia(
      neighborhood.shared_media,
      `featured neighborhood ${neighborhood.id}.shared_media`,
    );
    for (const sample of neighborhood.samples) {
      addMedia(
        sample.media,
        `featured neighborhood ${neighborhood.id} sample ${sample.grid_index.join(",")}.media`,
      );
    }
  }

  const unique = new Map();
  const canonicalDescriptor = (value) => {
    if (Array.isArray(value)) {
      return `[${value.map(canonicalDescriptor).join(",")}]`;
    }
    if (value && typeof value === "object") {
      return `{${Object.keys(value)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${canonicalDescriptor(value[key])}`,
        )
        .join(",")}}`;
    }
    return JSON.stringify(value);
  };
  for (const reference of references) {
    if (reference.asset.bytes > MAX_VALIDATED_ASSET_BYTES) {
      throw new Error(
        `${reference.label} exceeds the 512 MiB publication-preflight limit`,
      );
    }
    const existing = unique.get(reference.asset.key);
    if (
      existing &&
      (existing.kind !== reference.kind ||
        canonicalDescriptor(existing.asset) !==
          canonicalDescriptor(reference.asset))
    ) {
      throw new Error(
        `${reference.label} conflicts with another descriptor for ${reference.asset.key}`,
      );
    }
    if (!existing) unique.set(reference.asset.key, reference);
  }
  return [...unique.values()];
}

function sha256(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

function pngDimensions(payload) {
  const signature = "89504e470d0a1a0a";
  if (
    payload.length < 24 ||
    payload.subarray(0, 8).toString("hex") !== signature ||
    payload.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    throw new Error("PNG header is invalid");
  }
  return [payload.readUInt32BE(16), payload.readUInt32BE(20)];
}

function webpDimensions(payload) {
  if (
    payload.length < 30 ||
    payload.subarray(0, 4).toString("ascii") !== "RIFF" ||
    payload.subarray(8, 12).toString("ascii") !== "WEBP"
  ) {
    throw new Error("WebP header is invalid");
  }
  const chunk = payload.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X") {
    const width =
      1 + payload[24] + (payload[25] << 8) + (payload[26] << 16);
    const height =
      1 + payload[27] + (payload[28] << 8) + (payload[29] << 16);
    return [width, height];
  }
  if (chunk === "VP8L") {
    if (payload[20] !== 0x2f) throw new Error("WebP VP8L header is invalid");
    const width = 1 + payload[21] + ((payload[22] & 0x3f) << 8);
    const height =
      1 +
      (payload[22] >> 6) +
      (payload[23] << 2) +
      ((payload[24] & 0x0f) << 10);
    return [width, height];
  }
  if (
    chunk === "VP8 " &&
    payload.length >= 30 &&
    payload[23] === 0x9d &&
    payload[24] === 0x01 &&
    payload[25] === 0x2a
  ) {
    return [
      payload.readUInt16LE(26) & 0x3fff,
      payload.readUInt16LE(28) & 0x3fff,
    ];
  }
  throw new Error(`WebP chunk ${JSON.stringify(chunk)} is unsupported`);
}

function jpegDimensions(payload) {
  if (payload.length < 4 || payload[0] !== 0xff || payload[1] !== 0xd8) {
    throw new Error("JPEG header is invalid");
  }
  let offset = 2;
  while (offset + 9 < payload.length) {
    if (payload[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = payload[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = payload.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > payload.length) {
      throw new Error("JPEG segment is truncated");
    }
    if (
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
        marker,
      )
    ) {
      return [
        payload.readUInt16BE(offset + 7),
        payload.readUInt16BE(offset + 5),
      ];
    }
    offset += 2 + length;
  }
  throw new Error("JPEG dimensions are unavailable");
}

function imageDimensions(payload, extension) {
  if (extension === ".png") return pngDimensions(payload);
  if (extension === ".webp") return webpDimensions(payload);
  if (extension === ".jpg" || extension === ".jpeg") {
    return jpegDimensions(payload);
  }
  throw new Error(`image extension ${extension || "(none)"} is unsupported`);
}

function npyDimensions(payload) {
  if (
    payload.length < 10 ||
    payload.subarray(0, 6).toString("hex") !== "934e554d5059"
  ) {
    throw new Error("NPY header is invalid");
  }
  const major = payload[6];
  const minor = payload[7];
  if (![1, 2, 3].includes(major) || minor !== 0) {
    throw new Error(`NPY version ${major}.${minor} is unsupported`);
  }
  const lengthBytes = major === 1 ? 2 : 4;
  const headerLength =
    lengthBytes === 2
      ? payload.readUInt16LE(8)
      : payload.readUInt32LE(8);
  const start = 8 + lengthBytes;
  const end = start + headerLength;
  if (headerLength > 64 * 1024) {
    throw new Error("NPY header exceeds the 64 KiB supported limit");
  }
  if (end > payload.length) throw new Error("NPY header is truncated");
  const header = payload.subarray(start, end).toString("latin1");
  if (
    !header.endsWith("\n") ||
    header.includes("\r") ||
    end % 64 !== 0
  ) {
    throw new Error("NPY header padding is invalid");
  }
  const headerMatch =
    /^\{\s*['"]descr['"]\s*:\s*['"]([<>=|](?:f4|f8|u1|u2|i2|i4))['"]\s*,\s*['"]fortran_order['"]\s*:\s*(True|False)\s*,\s*['"]shape['"]\s*:\s*\(\s*(\d+)\s*,\s*(\d+)\s*,?\s*\)\s*,?\s*\}$/.exec(
      header.slice(0, -1).trim(),
    );
  if (!headerMatch || headerMatch[2] !== "False") {
    throw new Error("NPY shape, dtype, or memory order is unsupported");
  }
  const descriptor = headerMatch[1];
  const shape = [Number(headerMatch[3]), Number(headerMatch[4])];
  if (
    shape.length !== 2 ||
    !shape.every((value) => Number.isInteger(value) && value > 0)
  ) {
    throw new Error("NPY shape must have two positive dimensions");
  }
  const valueCount = shape[0] * shape[1];
  const descriptorMatch = /^([<>=|])(f4|f8|u1|u2|i2|i4)$/.exec(
    descriptor,
  );
  if (!descriptorMatch) {
    throw new Error(`NPY dtype ${descriptor} is unsupported`);
  }
  const endian = descriptorMatch[1];
  const dataType = descriptorMatch[2];
  const bytesPerValue = {
    f4: 4,
    f8: 8,
    u1: 1,
    u2: 2,
    i2: 2,
    i4: 4,
  }[dataType];
  if (!bytesPerValue) {
    throw new Error(`NPY dtype ${descriptor} is unsupported`);
  }
  if (bytesPerValue > 1 && endian === "|") {
    throw new Error(`NPY dtype ${descriptor} has an invalid endian marker`);
  }
  const expectedLength = end + valueCount * bytesPerValue;
  if (payload.length !== expectedLength) {
    throw new Error(
      payload.length < expectedLength
        ? "NPY numeric payload is truncated"
        : "NPY numeric payload has trailing bytes",
    );
  }
  if (dataType === "f4" || dataType === "f8") {
    const littleEndian = endian !== ">";
    for (let index = 0; index < valueCount; index += 1) {
      const offset = end + index * bytesPerValue;
      const value =
        dataType === "f4"
          ? littleEndian
            ? payload.readFloatLE(offset)
            : payload.readFloatBE(offset)
          : littleEndian
            ? payload.readDoubleLE(offset)
            : payload.readDoubleBE(offset);
      if (!Number.isFinite(value)) {
        throw new Error("NPY initial field contains a non-finite value");
      }
    }
  }
  return [shape[1], shape[0]];
}

function jsonFieldDimensions(payload, expectedWidth, expectedHeight) {
  let candidate = JSON.parse(payload.toString("utf8"));
  let declaredDimensions = null;
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
    if (Array.isArray(candidate.shape)) {
      if (
        candidate.shape.length !== 2 ||
        !candidate.shape.every(
          (value) => Number.isInteger(value) && value > 0,
        )
      ) {
        throw new Error(
          "initial-field JSON shape must contain two positive integers",
        );
      }
      declaredDimensions = [
        Number(candidate.shape[1]),
        Number(candidate.shape[0]),
      ];
    }
    candidate = candidate.values ?? candidate.data ?? candidate.field;
  }
  if (
    declaredDimensions &&
    (declaredDimensions[0] !== expectedWidth ||
      declaredDimensions[1] !== expectedHeight)
  ) {
    throw new Error(
      `initial-field JSON declares ${declaredDimensions[0]}x${declaredDimensions[1]}, expected ${expectedWidth}x${expectedHeight}`,
    );
  }
  if (
    Array.isArray(candidate) &&
    candidate.length === expectedHeight &&
    candidate.every(
      (row) =>
        Array.isArray(row) &&
        row.length === expectedWidth &&
        row.every(
          (value) => typeof value === "number" && Number.isFinite(value),
        ),
    )
  ) {
    return [expectedWidth, expectedHeight];
  }
  if (
    Array.isArray(candidate) &&
    candidate.length === expectedWidth * expectedHeight &&
    candidate.every((value) => typeof value === "number" && Number.isFinite(value))
  ) {
    return [expectedWidth, expectedHeight];
  }
  throw new Error("initial-field JSON dimensions or values are invalid");
}

function mp4Dimensions(payload) {
  const matches = [];
  for (let index = 4; index + 12 < payload.length; index += 1) {
    if (payload.subarray(index, index + 4).toString("ascii") !== "tkhd") {
      continue;
    }
    const start = index - 4;
    const size = payload.readUInt32BE(start);
    const end = start + size;
    if (size < 40 || end > payload.length) continue;
    const width = payload.readUInt32BE(end - 8) / 65536;
    const height = payload.readUInt32BE(end - 4) / 65536;
    if (width > 0 && height > 0) matches.push([width, height]);
  }
  if (matches.length === 0) {
    throw new Error("MP4 track dimensions are unavailable");
  }
  return matches;
}

function inspectAssetPayload(reference, payload) {
  const extension = path.posix.extname(reference.asset.key).toLowerCase();
  if (reference.kind === "poster") {
    const [width, height] = imageDimensions(payload, extension);
    if (width !== reference.asset.width || height !== reference.asset.height) {
      throw new Error(
        `${reference.label} declares ${reference.asset.width}x${reference.asset.height}, payload is ${width}x${height}`,
      );
    }
  } else if (reference.kind === "initial_field") {
    let dimensions;
    if (reference.asset.format === "npy") dimensions = npyDimensions(payload);
    else if (reference.asset.format === "json") {
      dimensions = jsonFieldDimensions(
        payload,
        reference.asset.width,
        reference.asset.height,
      );
    } else {
      dimensions = imageDimensions(payload, `.${reference.asset.format}`);
    }
    if (
      dimensions[0] !== reference.asset.width ||
      dimensions[1] !== reference.asset.height
    ) {
      throw new Error(
        `${reference.label} declares ${reference.asset.width}x${reference.asset.height}, payload is ${dimensions[0]}x${dimensions[1]}`,
      );
    }
  } else if (reference.kind === "video") {
    if (extension !== ".mp4") {
      throw new Error(`${reference.label} must use an .mp4 object key`);
    }
    const dimensions = mp4Dimensions(payload);
    if (
      !dimensions.some(
        ([width, height]) =>
          Math.round(width) === reference.asset.width &&
          Math.round(height) === reference.asset.height,
      )
    ) {
      throw new Error(
        `${reference.label} has no track matching declared ${reference.asset.width}x${reference.asset.height}`,
      );
    }
  } else if (
    reference.kind === "parameters" &&
    extension === ".json"
  ) {
    JSON.parse(payload.toString("utf8"));
  }
}

function requiresTrustedDecode(reference) {
  return (
    reference.kind === "poster" ||
    reference.kind === "video" ||
    (reference.kind === "initial_field" &&
      ["png", "webp"].includes(reference.asset.format))
  );
}

async function assertTrustedMediaDecode(
  reference,
  payload,
  ffmpegCommand,
) {
  if (!ffmpegCommand || !requiresTrustedDecode(reference)) return;
  await new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegCommand,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-xerror",
        "-i",
        "pipe:0",
        "-map",
        "0:v:0",
        "-f",
        "null",
        "-",
      ],
      {
        stdio: ["pipe", "ignore", "pipe"],
        windowsHide: true,
      },
    );
    let settled = false;
    let standardError = "";
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(
        new Error(
          `${reference.label} exceeded the five-minute trusted decode limit`,
        ),
      );
    }, 5 * 60 * 1000);
    child.stderr.on("data", (chunk) => {
      if (standardError.length < 8_000) {
        standardError += chunk.toString("utf8").slice(
          0,
          8_000 - standardError.length,
        );
      }
    });
    child.once("error", (error) => {
      finish(
        new Error(
          `${reference.label} could not run FFmpeg (${error.message})`,
        ),
      );
    });
    child.once("close", (exitCode, signal) => {
      if (exitCode === 0) {
        finish();
        return;
      }
      const detail = standardError.trim() || `signal ${signal ?? "unknown"}`;
      finish(
        new Error(
          `${reference.label} failed trusted FFmpeg decode: ${detail}`,
        ),
      );
    });
    child.stdin.on("error", () => {
      // FFmpeg's close/error event provides the actionable decoder result.
    });
    child.stdin.end(payload);
  });
}

async function validatePayload(
  reference,
  payload,
  ffmpegCommand = null,
) {
  if (payload.length !== reference.asset.bytes) {
    throw new Error(
      `${reference.label} declares ${reference.asset.bytes} bytes, payload has ${payload.length}`,
    );
  }
  const digest = sha256(payload);
  if (digest !== reference.asset.sha256) {
    throw new Error(`${reference.label} SHA-256 does not match its payload`);
  }
  inspectAssetPayload(reference, payload);
  await assertTrustedMediaDecode(reference, payload, ffmpegCommand);
}

async function verifyLocalAssets(
  references,
  mediaRoot,
  ffmpegCommand = null,
) {
  const root = path.resolve(mediaRoot);
  const rootStats = await stat(root).catch(() => null);
  if (!rootStats?.isDirectory()) {
    throw new Error(`Media root is not a directory: ${root}`);
  }
  const resolvedRoot = await realpath(root);
  for (const reference of references) {
    const candidate = path.resolve(
      root,
      ...reference.asset.key.split("/"),
    );
    const relative = path.relative(root, candidate);
    if (
      relative === "" ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error(`${reference.label} escapes the media root`);
    }
    const resolvedCandidate = await realpath(candidate).catch((error) => {
      throw new Error(
        `${reference.label} could not read ${candidate}: ${error.message}`,
      );
    });
    const resolvedRelative = path.relative(resolvedRoot, resolvedCandidate);
    if (
      resolvedRelative === "" ||
      resolvedRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(resolvedRelative)
    ) {
      throw new Error(
        `${reference.label} resolves outside the media root`,
      );
    }
    const candidateStats = await stat(resolvedCandidate);
    if (!candidateStats.isFile()) {
      throw new Error(`${reference.label} is not a regular file`);
    }
    if (candidateStats.size > MAX_VALIDATED_ASSET_BYTES) {
      throw new Error(
        `${reference.label} exceeds the 512 MiB publication-preflight limit`,
      );
    }
    if (candidateStats.size !== reference.asset.bytes) {
      throw new Error(
        `${reference.label} declares ${reference.asset.bytes} bytes, staged file has ${candidateStats.size}`,
      );
    }
    const payload = await readFile(resolvedCandidate);
    await validatePayload(reference, payload, ffmpegCommand);
  }
}

function normalizePublicAssetBase(rawValue) {
  let base;
  try {
    base = new URL(rawValue);
  } catch {
    throw new Error("--asset-base-url is not a valid absolute URL");
  }
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    throw new Error(
      "--asset-base-url must be a clean credential-free HTTPS directory URL",
    );
  }
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return base;
}

async function readLimitedResponseBody(response, reference) {
  const { label, asset } = reference;
  if (!response.body) {
    throw new Error(`${label} returned no response body`);
  }
  const reader = response.body.getReader();
  const payload = Buffer.allocUnsafe(asset.bytes);
  let byteCount = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (byteCount + value.byteLength > asset.bytes) {
        await reader.cancel();
        throw new Error(
          `${label} returned more than its declared ${asset.bytes} bytes`,
        );
      }
      Buffer.from(
        value.buffer,
        value.byteOffset,
        value.byteLength,
      ).copy(payload, byteCount);
      byteCount += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (byteCount !== asset.bytes) {
    throw new Error(
      `${label} declares ${asset.bytes} bytes, response has ${byteCount}`,
    );
  }
  return payload;
}

async function verifyPublicAssets(
  references,
  base,
  ffmpegCommand = null,
) {
  for (const reference of references) {
    const url = new URL(reference.asset.key, base);
    if (
      url.origin !== base.origin ||
      !url.pathname.startsWith(base.pathname)
    ) {
      throw new Error(`${reference.label} escapes the public asset base`);
    }
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(2 * 60 * 1000),
    });
    if (!response.ok) {
      throw new Error(
        `${reference.label} returned HTTP ${response.status} from ${url}`,
      );
    }
    const finalUrl = new URL(response.url);
    if (
      finalUrl.origin !== base.origin ||
      !finalUrl.pathname.startsWith(base.pathname)
    ) {
      throw new Error(
        `${reference.label} redirected outside the public asset base`,
      );
    }
    const contentLengthHeader = response.headers.get("content-length");
    const contentLength =
      contentLengthHeader === null ? null : Number(contentLengthHeader);
    if (
      contentLength !== null &&
      (!Number.isSafeInteger(contentLength) || contentLength < 0)
    ) {
      throw new Error(
        `${reference.label} returned an invalid HTTP Content-Length`,
      );
    }
    const contentEncoding = response.headers.get("content-encoding");
    if (contentEncoding && contentEncoding.toLowerCase() !== "identity") {
      throw new Error(
        `${reference.label} must not use HTTP content encoding during byte-for-byte verification`,
      );
    }
    if (
      contentLength !== null &&
      contentLength > MAX_VALIDATED_ASSET_BYTES
    ) {
      throw new Error(`${reference.label} exceeds the 512 MiB download limit`);
    }
    if (
      contentLength !== null &&
      contentLength !== reference.asset.bytes
    ) {
      throw new Error(
        `${reference.label} declares ${reference.asset.bytes} bytes, HTTP Content-Length is ${contentLength}`,
      );
    }
    const payload = await readLimitedResponseBody(response, reference);
    await validatePayload(reference, payload, ffmpegCommand);
  }
}

export { npyDimensions, readLimitedResponseBody };

const isMainModule =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
let parsedArguments;
try {
  parsedArguments = parseArguments(process.argv.slice(2));
} catch (error) {
  console.error(`Featured catalog FAIL: ${error.message}`);
  process.exitCode = 2;
}

if (parsedArguments?.help || !parsedArguments?.catalogArgument) {
  usage();
  if (!parsedArguments?.help) process.exitCode = 2;
} else {
  const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
  const catalogPath = path.resolve(parsedArguments.catalogArgument);
  const manifestPath = path.resolve(
    parsedArguments.manifestArgument ??
      path.join(repositoryRoot, "public/data/site-manifest.json"),
  );
  const server = await createServer({
    appType: "custom",
    configFile: path.join(repositoryRoot, "vite.config.ts"),
    logLevel: "error",
    server: { middlewareMode: true },
  });

  try {
    const [
      {
        assertValidDocument,
        validateFeaturedCatalog,
        validateSiteManifest,
      },
      semantics,
      publication,
      manifestIntegrity,
    ] =
      await Promise.all([
        server.ssrLoadModule("/src/data/validators.ts"),
        server.ssrLoadModule("/src/data/semantics.ts"),
        server.ssrLoadModule("/src/data/preparedFeatured.ts"),
        server.ssrLoadModule("/src/data/manifest-integrity.ts"),
      ]);
    const [catalogDocument, manifestDocument] = await Promise.all([
      readJson(catalogPath, "Featured catalog"),
      readJson(manifestPath, "Site manifest"),
    ]);
    const catalog = catalogDocument.value;
    const manifest = manifestDocument.value;

    assertValidDocument(
      validateSiteManifest,
      manifest,
      "Site manifest",
    );
    semantics.assertManifestSemantics(manifest);
    assertValidDocument(
      validateFeaturedCatalog,
      catalog,
      "Featured catalog",
    );
    semantics.assertFeaturedCatalogSemantics(catalog, manifest);
    if (parsedArguments.expectPrepared) {
      await manifestIntegrity.assertCanonicalManifestIntegrity(
        manifestDocument.text,
        manifest.manifest_sha256,
        manifest.manifest_sha256,
      );
      publication.assertPreparedFirstPublication(catalog, manifest);
    }
    const assetReferences = collectAssetReferences(catalog);
    if (
      assetReferences.length > 0 &&
      !parsedArguments.mediaRoot &&
      !parsedArguments.assetBaseUrl
    ) {
      throw new Error(
        `${assetReferences.length} referenced assets require --media-root or --asset-base-url verification`,
      );
    }
    const ffmpegCommand =
      parsedArguments.ffmpegCommand ??
      (parsedArguments.expectPrepared ? "ffmpeg" : null);
    if (parsedArguments.mediaRoot) {
      await verifyLocalAssets(
        assetReferences,
        parsedArguments.mediaRoot,
        ffmpegCommand,
      );
    } else if (parsedArguments.assetBaseUrl) {
      const suppliedBase = normalizePublicAssetBase(
        parsedArguments.assetBaseUrl,
      );
      const effectiveBaseValue =
        catalog.asset_base_url || manifest.asset_base_url;
      if (!effectiveBaseValue) {
        throw new Error(
          "Public verification requires an explicit catalog or manifest asset_base_url so it can match the browser",
        );
      }
      const effectiveBase = normalizePublicAssetBase(effectiveBaseValue);
      if (suppliedBase.href !== effectiveBase.href) {
        throw new Error(
          `--asset-base-url resolves to ${suppliedBase.href}, but the browser will use ${effectiveBase.href}`,
        );
      }
      await verifyPublicAssets(
        assetReferences,
        suppliedBase,
        ffmpegCommand,
      );
    }

    const offGridCount = catalog.featured_points.filter(
      (point) => point.coarse_point_id === undefined,
    ).length;
    const sampleCount = catalog.neighborhoods.reduce(
      (total, neighborhood) => total + neighborhood.samples.length,
      0,
    );
    console.log(
      `Featured catalog PASS: ${catalog.featured_points.length} centers, ${offGridCount} off-grid, ${catalog.neighborhoods.length} neighborhoods, ${sampleCount.toLocaleString()} samples.`,
    );
    console.log(
      `Assets verified: ${assetReferences.length}${
        parsedArguments.mediaRoot
          ? ` from ${pathToFileURL(path.resolve(parsedArguments.mediaRoot)).href}`
          : parsedArguments.assetBaseUrl
            ? ` from ${parsedArguments.assetBaseUrl}`
            : " (catalog references none)"
      }.`,
    );
    if (parsedArguments.expectPrepared) {
      console.log("Prepared first-publication invariants: PASS.");
      console.log(
        `Trusted poster/video/image decode: PASS (${ffmpegCommand}).`,
      );
    }
    console.log(`Catalog: ${pathToFileURL(catalogPath).href}`);
    console.log(`Manifest: ${pathToFileURL(manifestPath).href}`);
  } catch (error) {
    console.error(
      error instanceof Error
        ? `Featured catalog FAIL: ${error.message}`
        : "Featured catalog FAIL",
    );
    process.exitCode = 1;
  } finally {
    await server.close();
  }
}
}
