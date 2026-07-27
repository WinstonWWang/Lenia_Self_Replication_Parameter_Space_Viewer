const SHA256_HEX = /^[0-9a-f]{64}$/;

export class ManifestIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestIntegrityError";
  }
}

function requireSha256(value: string, label: string): void {
  if (!SHA256_HEX.test(value)) {
    throw new ManifestIntegrityError(
      `${label} is not a lowercase SHA-256 digest`,
    );
  }
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new ManifestIntegrityError(
      "Web Crypto is unavailable, so the live manifest cannot be verified",
    );
  }
  return bytesToHex(
    await subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
}

/**
 * Verifies the publisher's content digest without reserializing the manifest.
 *
 * The publisher hashes canonical JSON before adding `manifest_sha256`, then
 * writes the final canonical JSON followed by one LF. Removing the exact
 * canonical field token reconstructs the bytes that were originally hashed.
 */
export async function assertCanonicalManifestIntegrity(
  fetchedText: string,
  manifestDigest: string,
  pointerDigest: string,
): Promise<void> {
  requireSha256(manifestDigest, "Manifest digest");
  requireSha256(pointerDigest, "Pointer digest");

  if (manifestDigest !== pointerDigest) {
    throw new ManifestIntegrityError(
      "Live site manifest digest does not match its pointer",
    );
  }
  if (!fetchedText.endsWith("\n") || fetchedText.endsWith("\n\n")) {
    throw new ManifestIntegrityError(
      "Live site manifest is not canonical JSON followed by one terminal LF",
    );
  }

  const canonicalWithDigest = fetchedText.slice(0, -1);
  if (canonicalWithDigest.endsWith("\r")) {
    throw new ManifestIntegrityError(
      "Live site manifest must use a terminal LF, not CRLF",
    );
  }

  const digestField = `"manifest_sha256":"${manifestDigest}",`;
  const fieldIndex = canonicalWithDigest.indexOf(digestField);
  if (
    fieldIndex < 0 ||
    canonicalWithDigest.indexOf(digestField, fieldIndex + 1) >= 0
  ) {
    throw new ManifestIntegrityError(
      "Live site manifest does not contain exactly one canonical digest field",
    );
  }

  const canonicalPayload =
    canonicalWithDigest.slice(0, fieldIndex) +
    canonicalWithDigest.slice(fieldIndex + digestField.length);
  const computedDigest = await sha256Hex(canonicalPayload);
  if (computedDigest !== manifestDigest) {
    throw new ManifestIntegrityError(
      "Live site manifest content does not match its declared digest",
    );
  }
}
