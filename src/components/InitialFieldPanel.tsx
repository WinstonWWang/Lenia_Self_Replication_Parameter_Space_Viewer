import { useEffect, useRef, useState } from "react";

import type { InitialFieldAsset } from "../data";

const FIELD_SIDE = 256;
const FIELD_VALUE_COUNT = FIELD_SIDE * FIELD_SIDE;

export interface InitialFieldPanelProps {
  asset?: InitialFieldAsset | null;
  src?: string | null;
  unavailableMessage?: string;
}

type FieldState =
  | { status: "idle" | "loading" }
  | { status: "ready"; values: Float32Array }
  | { status: "error"; message: string };

function flattenJsonField(value: unknown): Float32Array {
  let candidate = value;

  if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
    const record = candidate as Record<string, unknown>;
    candidate = record.values ?? record.data ?? record.field;

    if (
      Array.isArray(record.shape) &&
      (record.shape.length !== 2 ||
        record.shape[0] !== FIELD_SIDE ||
        record.shape[1] !== FIELD_SIDE)
    ) {
      throw new Error("Initial-field JSON is not 256 × 256.");
    }
  }

  if (
    Array.isArray(candidate) &&
    candidate.length === FIELD_SIDE &&
    candidate.every(
      (row) => Array.isArray(row) && row.length === FIELD_SIDE,
    )
  ) {
    candidate = candidate.flat();
  }

  if (!Array.isArray(candidate) || candidate.length !== FIELD_VALUE_COUNT) {
    throw new Error("Initial-field JSON must contain exactly 65,536 values.");
  }

  const values = new Float32Array(FIELD_VALUE_COUNT);
  for (let index = 0; index < candidate.length; index += 1) {
    const number = candidate[index];
    if (typeof number !== "number" || !Number.isFinite(number)) {
      throw new Error("Initial-field JSON contains a non-finite value.");
    }
    values[index] = number;
  }
  return values;
}

function parseNpyHeader(
  buffer: ArrayBuffer,
): { dataOffset: number; descriptor: string; shape: number[] } {
  const bytes = new Uint8Array(buffer);
  const expectedMagic = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59];
  if (
    bytes.length < 10 ||
    expectedMagic.some((byte, index) => bytes[index] !== byte)
  ) {
    throw new Error("Initial-field NPY has an invalid header.");
  }

  const major = bytes[6];
  const view = new DataView(buffer);
  const lengthBytes = major === 1 ? 2 : 4;
  const headerLength =
    lengthBytes === 2 ? view.getUint16(8, true) : view.getUint32(8, true);
  const headerStart = 8 + lengthBytes;
  const headerEnd = headerStart + headerLength;
  if (headerEnd > bytes.length) {
    throw new Error("Initial-field NPY header is truncated.");
  }

  const header = new TextDecoder("latin1").decode(
    bytes.subarray(headerStart, headerEnd),
  );
  const descriptor = /['"]descr['"]\s*:\s*['"]([^'"]+)['"]/.exec(header)?.[1];
  const fortranOrder =
    /['"]fortran_order['"]\s*:\s*(True|False)/.exec(header)?.[1];
  const shapeText = /['"]shape['"]\s*:\s*\(([^)]*)\)/.exec(header)?.[1];

  if (!descriptor || !shapeText || fortranOrder !== "False") {
    throw new Error("Initial-field NPY layout is unsupported.");
  }

  const shape = shapeText
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(Number);
  if (
    shape.length !== 2 ||
    shape[0] !== FIELD_SIDE ||
    shape[1] !== FIELD_SIDE
  ) {
    throw new Error("Initial-field NPY is not 256 × 256.");
  }

  return { dataOffset: headerEnd, descriptor, shape };
}

function parseNpyField(buffer: ArrayBuffer): Float32Array {
  const { dataOffset, descriptor } = parseNpyHeader(buffer);
  const view = new DataView(buffer, dataOffset);
  const values = new Float32Array(FIELD_VALUE_COUNT);
  const littleEndian = descriptor[0] !== ">";
  const dataType = descriptor.slice(1);

  let bytesPerValue: number;
  let readValue: (offset: number) => number;

  switch (dataType) {
    case "f4":
      bytesPerValue = 4;
      readValue = (offset) => view.getFloat32(offset, littleEndian);
      break;
    case "f8":
      bytesPerValue = 8;
      readValue = (offset) => view.getFloat64(offset, littleEndian);
      break;
    case "u1":
      bytesPerValue = 1;
      readValue = (offset) => view.getUint8(offset);
      break;
    case "u2":
      bytesPerValue = 2;
      readValue = (offset) => view.getUint16(offset, littleEndian);
      break;
    case "i2":
      bytesPerValue = 2;
      readValue = (offset) => view.getInt16(offset, littleEndian);
      break;
    case "i4":
      bytesPerValue = 4;
      readValue = (offset) => view.getInt32(offset, littleEndian);
      break;
    default:
      throw new Error(`Initial-field NPY dtype ${descriptor} is unsupported.`);
  }

  if (view.byteLength < FIELD_VALUE_COUNT * bytesPerValue) {
    throw new Error("Initial-field NPY data is truncated.");
  }
  for (let index = 0; index < FIELD_VALUE_COUNT; index += 1) {
    const number = readValue(index * bytesPerValue);
    if (!Number.isFinite(number)) {
      throw new Error("Initial-field NPY contains a non-finite value.");
    }
    values[index] = number;
  }
  return values;
}

async function fetchField(
  src: string,
  format: InitialFieldAsset["format"],
  signal: AbortSignal,
): Promise<Float32Array> {
  const response = await fetch(src, { signal, cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`Initial field could not be loaded (${response.status}).`);
  }

  if (format === "json") {
    return flattenJsonField(await response.json());
  }
  if (format === "npy") {
    return parseNpyField(await response.arrayBuffer());
  }
  throw new Error(`Initial-field format ${format} is not numeric.`);
}

function heatColor(value: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, value));
  const stops: Array<[number, number, number, number]> = [
    [0, 5, 7, 18],
    [0.22, 31, 37, 96],
    [0.48, 38, 121, 142],
    [0.73, 85, 201, 129],
    [1, 247, 224, 92],
  ];

  const upperIndex = stops.findIndex(([position]) => position >= t);
  if (upperIndex <= 0) {
    return stops[0].slice(1) as [number, number, number];
  }
  const lower = stops[upperIndex - 1];
  const upper = stops[upperIndex];
  const fraction = (t - lower[0]) / (upper[0] - lower[0]);
  return [
    Math.round(lower[1] + (upper[1] - lower[1]) * fraction),
    Math.round(lower[2] + (upper[2] - lower[2]) * fraction),
    Math.round(lower[3] + (upper[3] - lower[3]) * fraction),
  ];
}

function HeatmapCanvas({
  values,
  valueMin,
  valueMax,
}: {
  values: Float32Array;
  valueMin: number;
  valueMax: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const image = context.createImageData(FIELD_SIDE, FIELD_SIDE);
    const span = valueMax - valueMin || 1;
    for (let index = 0; index < values.length; index += 1) {
      const [red, green, blue] = heatColor(
        (values[index] - valueMin) / span,
      );
      const pixelOffset = index * 4;
      image.data[pixelOffset] = red;
      image.data[pixelOffset + 1] = green;
      image.data[pixelOffset + 2] = blue;
      image.data[pixelOffset + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  }, [valueMax, valueMin, values]);

  return (
    <canvas
      ref={canvasRef}
      className="initial-field__canvas"
      width={FIELD_SIDE}
      height={FIELD_SIDE}
      role="img"
      aria-label="256 by 256 initial-field heatmap"
    />
  );
}

export function InitialFieldPanel({
  asset,
  src,
  unavailableMessage = "The 256 × 256 initial field is unavailable.",
}: InitialFieldPanelProps) {
  const [fieldState, setFieldState] = useState<FieldState>({ status: "idle" });
  const [rasterFailed, setRasterFailed] = useState(false);
  const isRaster = asset?.format === "png" || asset?.format === "webp";
  const dimensionsAreValid =
    asset?.width === FIELD_SIDE && asset?.height === FIELD_SIDE;

  useEffect(() => {
    setRasterFailed(false);
  }, [src]);

  useEffect(() => {
    if (!asset || !src || isRaster || !dimensionsAreValid) {
      setFieldState({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    setFieldState({ status: "loading" });
    void fetchField(src, asset.format, controller.signal)
      .then((values) => setFieldState({ status: "ready", values }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setFieldState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "The initial field could not be decoded.",
        });
      });
    return () => controller.abort();
  }, [asset, dimensionsAreValid, isRaster, src]);

  let content;
  if (!asset || !src) {
    content = (
      <div className="initial-field__placeholder" role="status">
        {unavailableMessage}
      </div>
    );
  } else if (!dimensionsAreValid) {
    content = (
      <div className="initial-field__placeholder" role="alert">
        Published initial field is {asset.width} × {asset.height}; only the
        required 256 × 256 field can be displayed.
      </div>
    );
  } else if (isRaster && !rasterFailed) {
    content = (
      <img
        className="initial-field__image"
        src={src}
        width={FIELD_SIDE}
        height={FIELD_SIDE}
        alt="256 by 256 initial-field heatmap"
        loading="lazy"
        decoding="async"
        onError={() => setRasterFailed(true)}
      />
    );
  } else if (isRaster) {
    content = (
      <div className="initial-field__placeholder" role="alert">
        The published initial-field image could not be loaded.
      </div>
    );
  } else if (fieldState.status === "ready") {
    content = (
      <HeatmapCanvas
        values={fieldState.values}
        valueMin={asset.value_min ?? 0}
        valueMax={asset.value_max ?? 1}
      />
    );
  } else if (fieldState.status === "error") {
    content = (
      <div className="initial-field__placeholder" role="alert">
        {fieldState.message}
      </div>
    );
  } else {
    content = (
      <div className="initial-field__placeholder" role="status">
        Loading initial field…
      </div>
    );
  }

  return (
    <section className="initial-field" aria-labelledby="initial-field-heading">
      <div className="initial-field__heading-row">
        <h3 id="initial-field-heading">Initial field</h3>
        <span>256 × 256 pixels</span>
      </div>
      <div className="initial-field__plot">
        {content}
        <div className="initial-field__x-axis" aria-hidden="true">
          <span>−128</span>
          <span>0</span>
          <span>127</span>
        </div>
        <div className="initial-field__y-axis" aria-hidden="true">
          <span>−128</span>
          <span>0</span>
          <span>127</span>
        </div>
      </div>
    </section>
  );
}
