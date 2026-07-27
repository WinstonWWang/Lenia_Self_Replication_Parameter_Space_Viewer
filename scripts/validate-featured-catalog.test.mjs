import { describe, expect, it } from "vitest";
import {
  npyDimensions,
  readLimitedResponseBody,
} from "./validate-featured-catalog.mjs";

function makeNpyPayload({
  dictionary,
  major = 1,
  dataBytes = 16,
}) {
  const lengthBytes = major === 1 ? 2 : 4;
  const prefixBytes = 8 + lengthBytes;
  const unpaddedBytes =
    prefixBytes + Buffer.byteLength(dictionary, "latin1") + 1;
  const paddingBytes = (64 - (unpaddedBytes % 64)) % 64;
  const header = Buffer.from(
    `${dictionary}${" ".repeat(paddingBytes)}\n`,
    "latin1",
  );
  const payload = Buffer.alloc(prefixBytes + header.length + dataBytes);
  Buffer.from([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]).copy(payload);
  payload[6] = major;
  payload[7] = 0;
  if (lengthBytes === 2) payload.writeUInt16LE(header.length, 8);
  else payload.writeUInt32LE(header.length, 8);
  header.copy(payload, prefixBytes);
  return payload;
}

describe("featured asset payload hardening", () => {
  it("accepts a standard finite 2D NPY and rejects pseudo-headers", () => {
    const valid = makeNpyPayload({
      dictionary:
        "{'descr': '<f4', 'fortran_order': False, 'shape': (2, 2), }",
    });
    expect(npyDimensions(valid)).toEqual([2, 2]);

    const malformedShape = makeNpyPayload({
      dictionary:
        "{'descr': '<f4', 'fortran_order': False, 'shape': (2,,2), }",
    });
    expect(() => npyDimensions(malformedShape)).toThrow(
      /shape, dtype, or memory order/,
    );

    const extraDictionaryField = makeNpyPayload({
      dictionary:
        "{'descr': '<f4', 'fortran_order': False, 'shape': (2, 2), 'unsafe': 1, }",
    });
    expect(() => npyDimensions(extraDictionaryField)).toThrow(
      /shape, dtype, or memory order/,
    );
  });

  it("streams exactly the declared public bytes without over-reading", async () => {
    const reference = {
      label: "fixture.poster",
      asset: { bytes: 2 },
    };
    await expect(
      readLimitedResponseBody(
        new Response(Uint8Array.from([1, 2])),
        reference,
      ),
    ).resolves.toEqual(Buffer.from([1, 2]));

    await expect(
      readLimitedResponseBody(
        new Response(Uint8Array.from([1, 2, 3])),
        reference,
      ),
    ).rejects.toThrow(/more than its declared 2 bytes/);

    await expect(
      readLimitedResponseBody(
        new Response(Uint8Array.from([1])),
        reference,
      ),
    ).rejects.toThrow(/response has 1/);
  });
});
