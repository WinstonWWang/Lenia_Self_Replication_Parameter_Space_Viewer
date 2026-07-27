const ASSET_PREFIX = /^(?:media|repro)\/v1\//;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

function assertHttpProtocol(url: URL, label: string): void {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UnsafeUrlError(`${label} must use HTTP or HTTPS`);
  }
}

export function resolveConfiguredUrl(
  value: string,
  configUrl: string | URL,
  label = "Configured URL",
): URL {
  let result: URL;
  try {
    result = new URL(value, configUrl);
  } catch {
    throw new UnsafeUrlError(`${label} is not a valid URL`);
  }
  assertHttpProtocol(result, label);
  return result;
}

export function isSafeAssetKey(key: string): boolean {
  if (!ASSET_PREFIX.test(key)) return false;
  if (
    key.startsWith("/") ||
    key.includes("\\") ||
    key.includes("?") ||
    key.includes("#") ||
    key.includes("%") ||
    CONTROL_CHARACTER.test(key)
  ) {
    return false;
  }

  const segments = key.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
}

export function assertSafeAssetKey(key: string): void {
  if (!isSafeAssetKey(key)) {
    throw new UnsafeUrlError("Asset key is not a safe relative object key");
  }
}

export function normalizeAssetBaseUrl(
  assetBaseUrl: string | URL,
): URL {
  let result: URL;
  try {
    result = new URL(assetBaseUrl);
  } catch {
    throw new UnsafeUrlError("Asset base is not an absolute URL");
  }

  assertHttpProtocol(result, "Asset base");
  if (result.search || result.hash) {
    throw new UnsafeUrlError(
      "Asset base must be a clean directory URL without a query or fragment",
    );
  }
  if (!result.pathname.endsWith("/")) {
    result.pathname = `${result.pathname}/`;
  }
  return result;
}

export function resolveAssetUrl(
  key: string,
  assetBaseUrl: string | URL,
): string {
  assertSafeAssetKey(key);
  const base = normalizeAssetBaseUrl(assetBaseUrl);
  const resolved = new URL(key, base);

  if (
    resolved.origin !== base.origin ||
    !resolved.pathname.startsWith(base.pathname)
  ) {
    throw new UnsafeUrlError("Resolved asset escaped its configured base");
  }

  return resolved.href;
}

export function createAssetResolver(
  assetBaseUrl: string | URL,
): (key: string) => string {
  const base = normalizeAssetBaseUrl(assetBaseUrl);
  return (key: string) => resolveAssetUrl(key, base);
}

export function resolveSnapshotUrl(
  pointerUrl: string | URL,
  manifestKey: string,
): URL {
  const pointer = new URL(pointerUrl);
  assertHttpProtocol(pointer, "Manifest pointer URL");
  if (!pointer.pathname.endsWith("/manifests/latest.json")) {
    throw new UnsafeUrlError(
      "Manifest pointer URL must end with /manifests/latest.json",
    );
  }
  if (
    !/^manifests\/snapshots\/[a-f0-9]{64}\.json$/.test(manifestKey)
  ) {
    throw new UnsafeUrlError("Manifest snapshot key is invalid");
  }

  const objectRoot = new URL("../", pointer);
  const snapshot = new URL(manifestKey, objectRoot);
  if (
    snapshot.origin !== objectRoot.origin ||
    !snapshot.pathname.startsWith(objectRoot.pathname)
  ) {
    throw new UnsafeUrlError("Manifest snapshot escaped its object-store root");
  }
  return snapshot;
}
