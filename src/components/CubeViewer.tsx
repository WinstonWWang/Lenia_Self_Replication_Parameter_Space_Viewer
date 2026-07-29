import {
  Html,
  OrbitControls,
  useCursor,
} from "@react-three/drei";
import {
  Canvas,
  useFrame,
  useThree,
} from "@react-three/fiber";
import {
  type ComponentRef,
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";

import type {
  DisplayStatus,
  FeaturedCatalog,
  FeaturedPoint,
  ParameterCoordinates,
  RefinementCatalog,
  ReviewOverlay,
  SelectedParameterPoint,
  SiteManifest,
} from "../data";
import {
  findFeaturedNeighborhood,
  findFeaturedPointForCoarsePoint,
  sameSelection,
  selectionKey,
} from "../data";
import {
  buildAxisCells,
  buildRefinementBoundarySegments,
  buildRefinementCells,
  makeFeaturedPointRenderData,
  makePointRenderData,
  nearestAxisIndex,
  normalizeAxisValue,
  REFINEMENT_NEGATIVE_COLOR,
  refinementAlphaIndexForSlab,
  refinementToGlobalTransform,
  renderDatumSelection,
  selfReplicatorGlowRadius,
  splitPointDataByAlpha,
  STATUS_COLORS,
  type LocalNeighborhood,
  type LocalSample,
  type PointRenderDatum,
  type RefinementCell,
  type WorldPosition,
} from "../visualization/geometry";

export interface CubeViewerProps {
  manifest: SiteManifest;
  reviewOverlay?: ReviewOverlay | null;
  refinementCatalog?: RefinementCatalog | null;
  featuredCatalog?: FeaturedCatalog | null;
  selectedPoint: SelectedParameterPoint | null;
  selectedLocalSample?: LocalSample | null;
  hoveredPoint: SelectedParameterPoint | null;
  pinnedAlphaIndex: number | null;
  previewAlphaIndex: number | null;
  onSelectPoint: (point: SelectedParameterPoint) => void;
  onHoverPoint: (point: SelectedParameterPoint | null) => void;
  onPinnedAlphaChange: (alphaIndex: number | null) => void;
  onPreviewAlphaChange: (alphaIndex: number | null) => void;
  onSelectLocalSample?: (sample: LocalSample | null) => void;
  onHoverLocalSample?: (sample: LocalSample | null) => void;
  localModeEnabled?: boolean;
  replicatorVariationsOnly?: boolean;
  visibleStatuses?: ReadonlySet<DisplayStatus>;
  className?: string;
  showLegend?: boolean;
}

interface PointCloudProps {
  data: readonly PointRenderDatum[];
  opacity: number;
  pointSize?: number;
  pickable?: boolean;
  hoveredPoint: SelectedParameterPoint | null;
  onHoverPoint: (point: SelectedParameterPoint | null) => void;
  onSelectPoint: (point: SelectedParameterPoint) => void;
  renderOrder?: number;
  depthTest?: boolean;
  depthWrite?: boolean;
}

interface SelfReplicatorGlowProps {
  data: readonly PointRenderDatum[];
  radius: number;
  opacity: number;
  renderOrder?: number;
  depthTest?: boolean;
}

interface CameraRigProps {
  mode: "cube" | "slice" | "local" | "local-slice" | "focus";
  sliceZ: number;
  focusPosition: WorldPosition | null;
}

const POINT_VERTEX_SHADER = `
  attribute vec3 color;
  varying vec3 vColor;
  uniform float uPointSize;

  void main() {
    vColor = color;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(uPointSize / max(0.2, -viewPosition.z), 3.0, 12.0);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const POINT_FRAGMENT_SHADER = `
  varying vec3 vColor;
  uniform float uOpacity;

  void main() {
    float radius = distance(gl_PointCoord, vec2(0.5));
    if (radius > 0.5) discard;
    float edgeAlpha = 1.0 - smoothstep(0.40, 0.5, radius);
    gl_FragColor = vec4(vColor, uOpacity * edgeAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const CLICK_DRAG_THRESHOLD_PX = 4;
const IGNORE_RAYCAST: THREE.Mesh["raycast"] = () => {};

const labelStyle: CSSProperties = {
  color: "#ffffff",
  fontSize: "0.82rem",
  fontWeight: 650,
  lineHeight: 1,
  pointerEvents: "none",
  textShadow: "0 1px 3px #000000, 0 0 4px #000000",
  userSelect: "none",
  whiteSpace: "nowrap",
};

const tooltipStyle: CSSProperties = {
  background: "#050505",
  border: "1px solid rgba(255,255,255,0.28)",
  borderRadius: "4px",
  color: "#ffffff",
  fontSize: "0.72rem",
  lineHeight: 1.35,
  padding: "0.3rem 0.42rem",
  pointerEvents: "none",
  userSelect: "none",
  whiteSpace: "nowrap",
};

const screenReaderOnlyStyle: CSSProperties = {
  border: 0,
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  height: "1px",
  margin: "-1px",
  overflow: "hidden",
  padding: 0,
  position: "absolute",
  whiteSpace: "nowrap",
  width: "1px",
};

const LEGEND_ITEMS = [
  ["Self-replicator", STATUS_COLORS.self_replicator],
  ["Unresolved", STATUS_COLORS.unresolved],
  ["Experimentally dead", STATUS_COLORS.experimentally_dead],
  ["Physically uninteresting", STATUS_COLORS.physically_uninteresting],
] as const;

export function CubeLegend(): React.JSX.Element {
  return (
    <section
      aria-label="Point classification legend"
      className="cube-viewer__legend"
      style={{
        background: "rgba(24, 25, 28, 0.9)",
        border: "1px solid rgba(255,255,255,0.2)",
        borderRadius: "6px",
        color: "#ffffff",
        padding: "0.55rem 0.62rem",
        pointerEvents: "none",
        position: "absolute",
        right: "0.75rem",
        top: "0.75rem",
        zIndex: 3,
      }}
    >
      <ul
        style={{
          display: "grid",
          gap: "0.36rem",
          listStyle: "none",
          margin: 0,
          padding: 0,
        }}
      >
        {LEGEND_ITEMS.map(([label, color]) => (
          <li
            key={label}
            style={{
              alignItems: "center",
              display: "grid",
              fontSize: "0.72rem",
              gap: "0.42rem",
              gridTemplateColumns: "0.62rem auto",
              whiteSpace: "nowrap",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                background: color,
                border:
                  label === "Experimentally dead"
                    ? "1px solid rgba(255,255,255,0.22)"
                    : undefined,
                borderRadius: "50%",
                boxShadow:
                  label === "Self-replicator"
                    ? "0 0 0 4px rgba(57,255,20,0.16)"
                    : undefined,
                display: "block",
                height: "0.54rem",
                width: "0.54rem",
              }}
            />
            <span>{label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PointCloud({
  data,
  opacity,
  pointSize = 20,
  pickable = true,
  hoveredPoint,
  onHoverPoint,
  onSelectPoint,
  renderOrder = 0,
  depthTest = true,
  depthWrite = true,
}: PointCloudProps): React.JSX.Element | null {
  const pixelRatio = useThree((state) => state.gl.getPixelRatio());
  const geometry = useMemo(() => {
    const nextGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(data.length * 3);
    const colors = new Float32Array(data.length * 3);
    const color = new THREE.Color();
    data.forEach((datum, index) => {
      positions.set(datum.position, index * 3);
      color.set(datum.color).toArray(colors, index * 3);
    });
    nextGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );
    nextGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    nextGeometry.computeBoundingSphere();
    return nextGeometry;
  }, [data]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        depthTest,
        depthWrite,
        fragmentShader: POINT_FRAGMENT_SHADER,
        transparent: true,
        uniforms: {
          uOpacity: { value: opacity },
          uPointSize: { value: pointSize * pixelRatio },
        },
        vertexShader: POINT_VERTEX_SHADER,
      }),
    [depthTest, depthWrite, opacity, pixelRatio, pointSize],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  if (data.length === 0) return null;

  const pointForEvent = (event: { index?: number }) => {
    if (!pickable || event.index === undefined) return null;
    return data[event.index] ?? null;
  };

  return (
    <points
      geometry={geometry}
      material={material}
      renderOrder={renderOrder}
      onClick={(event) => {
        if (event.delta > CLICK_DRAG_THRESHOLD_PX) return;
        const datum = pointForEvent(event);
        if (!datum) return;
        event.stopPropagation();
        onSelectPoint(renderDatumSelection(datum));
      }}
      onPointerMove={(event) => {
        const datum = pointForEvent(event);
        if (!datum) return;
        event.stopPropagation();
        const selection = renderDatumSelection(datum);
        if (!sameSelection(hoveredPoint, selection)) {
          onHoverPoint(selection);
        }
      }}
      onPointerOut={() => {
        if (pickable) onHoverPoint(null);
      }}
    />
  );
}

function SelfReplicatorGlow({
  data,
  radius,
  opacity,
  renderOrder = 0,
  depthTest = true,
}: SelfReplicatorGlowProps): React.JSX.Element | null {
  const selfReplicators = useMemo(
    () => data.filter((datum) => datum.status === "self_replicator"),
    [data],
  );
  const geometry = useMemo(
    () => new THREE.SphereGeometry(1, 20, 14),
    [],
  );
  const material = useMemo(() => {
    const nextMaterial = new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: STATUS_COLORS.self_replicator,
      depthTest,
      depthWrite: false,
      opacity,
      transparent: true,
    });
    nextMaterial.toneMapped = false;
    return nextMaterial;
  }, [depthTest, opacity]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  if (selfReplicators.length === 0 || radius <= 0) return null;

  return (
    <group>
      {selfReplicators.map((datum) => (
        <mesh
          key={`${datum.kind}:${datum.id}`}
          geometry={geometry}
          material={material}
          position={datum.position}
          raycast={IGNORE_RAYCAST}
          renderOrder={renderOrder}
          scale={radius}
        />
      ))}
    </group>
  );
}

function makeCubeGridPositions(): Float32Array {
  const positions: number[] = [];
  for (let index = 0; index < 20; index += 1) {
    const value = -1 + (2 * index) / 19;
    positions.push(
      -1,
      -1,
      value,
      1,
      -1,
      value,
      value,
      -1,
      -1,
      value,
      -1,
      1,
      -1,
      -1,
      value,
      1,
      -1,
      value,
      value,
      -1,
      -1,
      value,
      1,
      -1,
      1,
      value,
      -1,
      -1,
      value,
      1,
    );
  }
  return new Float32Array(positions);
}

function makeSliceGridPositions(z: number): Float32Array {
  const positions: number[] = [];
  for (let index = 0; index < 20; index += 1) {
    const value = -1 + (2 * index) / 19;
    positions.push(-1, value, z, 1, value, z, value, -1, z, value, 1, z);
  }
  return new Float32Array(positions);
}

function LineGeometry({
  positions,
  color,
  opacity,
  renderOrder = 0,
}: {
  positions: Float32Array;
  color: string;
  opacity: number;
  renderOrder?: number;
}): React.JSX.Element {
  const geometry = useMemo(() => {
    const nextGeometry = new THREE.BufferGeometry();
    nextGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3),
    );
    return nextGeometry;
  }, [positions]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <lineSegments geometry={geometry} renderOrder={renderOrder}>
      <lineBasicMaterial
        color={color}
        depthWrite={false}
        opacity={opacity}
        transparent={opacity < 1}
      />
    </lineSegments>
  );
}

function CubeFrame({
  local = false,
}: {
  local?: boolean;
}): React.JSX.Element {
  const edges = useMemo(() => {
    const box = new THREE.BoxGeometry(2, 2, 2);
    const nextEdges = new THREE.EdgesGeometry(box);
    box.dispose();
    return nextEdges;
  }, []);
  const gridPositions = useMemo(makeCubeGridPositions, []);
  useEffect(() => () => edges.dispose(), [edges]);

  return (
    <group>
      <lineSegments geometry={edges}>
        <lineBasicMaterial
          color="#f4f5f7"
          opacity={local ? 0.72 : 0.58}
          transparent
        />
      </lineSegments>
      <LineGeometry
        color="#ffffff"
        opacity={local ? 0.12 : 0.08}
        positions={gridPositions}
      />
      <Html
        center
        position={[0, -1.18, -1.07]}
        style={labelStyle}
        zIndexRange={[4, 0]}
      >
        <span aria-label="m local">
          m<sub>ℓ</sub>
        </span>
      </Html>
      <Html
        center
        position={[-1.18, 0, -1.07]}
        style={labelStyle}
        zIndexRange={[4, 0]}
      >
        <span>
          m<sub>c</sub>
        </span>
      </Html>
      <Html
        center
        position={[-1.16, -1.16, 0]}
        style={labelStyle}
        zIndexRange={[4, 0]}
      >
        <span>
          α = w<sub>c</sub>/(w<sub>c</sub> + w<sub>ℓ</sub>)
        </span>
      </Html>
    </group>
  );
}

function SlicePlane({ z }: { z: number }): React.JSX.Element {
  const positions = useMemo(() => makeSliceGridPositions(z), [z]);
  return (
    <group>
      <mesh position={[0, 0, z]} renderOrder={-1}>
        <planeGeometry args={[2.02, 2.02]} />
        <meshBasicMaterial
          color="#dfe8f4"
          depthWrite={false}
          opacity={0.035}
          side={THREE.DoubleSide}
          transparent
        />
      </mesh>
      <LineGeometry
        color="#ffffff"
        opacity={0.22}
        positions={positions}
        renderOrder={2}
      />
    </group>
  );
}

function FlatSliceFrame({
  alpha,
  z,
}: {
  alpha: number;
  z: number;
}): React.JSX.Element {
  const outlinePositions = useMemo(
    () =>
      new Float32Array([
        -1,
        -1,
        z,
        1,
        -1,
        z,
        1,
        -1,
        z,
        1,
        1,
        z,
        1,
        1,
        z,
        -1,
        1,
        z,
        -1,
        1,
        z,
        -1,
        -1,
        z,
      ]),
    [z],
  );

  return (
    <group>
      <LineGeometry
        color="#ffffff"
        opacity={0.36}
        positions={outlinePositions}
        renderOrder={2}
      />
      <Html
        center
        position={[0, -1.14, z]}
        style={labelStyle}
        zIndexRange={[4, 0]}
      >
        <span aria-label="m local">
          m<sub>{"\u2113"}</sub>
        </span>
      </Html>
      <Html
        center
        position={[-1.14, 0, z]}
        style={labelStyle}
        zIndexRange={[4, 0]}
      >
        <span>
          m<sub>c</sub>
        </span>
      </Html>
      <Html
        center
        position={[0, 1.14, z]}
        style={labelStyle}
        zIndexRange={[4, 0]}
      >
        <span>
          {"\u03b1"} = {alpha.toFixed(3)}
        </span>
      </Html>
    </group>
  );
}

function makeRailTickPositions(alphaValues: readonly number[]): Float32Array {
  const positions: number[] = [];
  const corners: ReadonlyArray<readonly [number, number]> = [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ];
  for (const [x, y] of corners) {
    const length = Math.hypot(x, y);
    const outwardX = x / length;
    const outwardY = y / length;
    for (const alpha of alphaValues) {
      const z = normalizeAxisValue(alpha, alphaValues);
      positions.push(
        x,
        y,
        z,
        x + outwardX * 0.065,
        y + outwardY * 0.065,
        z,
      );
    }
  }
  return new Float32Array(positions);
}

function AlphaRails({
  alphaValues,
  pinnedAlphaIndex,
  previewAlphaIndex,
  onPinnedAlphaChange,
  onPreviewAlphaChange,
}: {
  alphaValues: readonly number[];
  pinnedAlphaIndex: number | null;
  previewAlphaIndex: number | null;
  onPinnedAlphaChange: (index: number | null) => void;
  onPreviewAlphaChange: (index: number | null) => void;
}): React.JSX.Element {
  const hitRef = useRef<THREE.InstancedMesh>(null);
  const [hoveringRail, setHoveringRail] = useState(false);
  const count = alphaValues.length;
  const tickPositions = useMemo(
    () => makeRailTickPositions(alphaValues),
    [alphaValues],
  );
  const activeIndex = pinnedAlphaIndex ?? previewAlphaIndex;
  const activeZ =
    activeIndex === null || alphaValues[activeIndex] === undefined
      ? null
      : normalizeAxisValue(alphaValues[activeIndex], alphaValues);
  useCursor(hoveringRail, "pointer", "auto");

  useLayoutEffect(() => {
    if (!hitRef.current) return;
    const matrix = new THREE.Matrix4();
    const corners: ReadonlyArray<readonly [number, number]> = [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ];
    let instance = 0;
    for (const [x, y] of corners) {
      for (const alpha of alphaValues) {
        matrix.makeTranslation(x, y, normalizeAxisValue(alpha, alphaValues));
        hitRef.current.setMatrixAt(instance, matrix);
        instance += 1;
      }
    }
    hitRef.current.instanceMatrix.needsUpdate = true;
  }, [alphaValues]);

  const indexForEvent = (
    event: { instanceId?: number },
  ): number | null => {
    if (event.instanceId === undefined || count === 0) return null;
    return event.instanceId % count;
  };

  return (
    <group>
      <LineGeometry
        color="#f7f7f7"
        opacity={0.36}
        positions={tickPositions}
      />
      {activeZ !== null && (
        <>
          {(
            [
              [-1, -1],
              [-1, 1],
              [1, -1],
              [1, 1],
            ] as const
          ).map(([x, y]) => (
            <mesh key={`${x}:${y}`} position={[x, y, activeZ]}>
              <sphereGeometry args={[0.035, 8, 6]} />
              <meshBasicMaterial color="#ffffff" depthTest={false} />
            </mesh>
          ))}
        </>
      )}
      <instancedMesh
        ref={hitRef}
        args={[undefined, undefined, count * 4]}
        onClick={(event) => {
          if (event.delta > CLICK_DRAG_THRESHOLD_PX) return;
          const index = indexForEvent(event);
          if (index === null) return;
          event.stopPropagation();
          onPinnedAlphaChange(
            pinnedAlphaIndex === index ? null : index,
          );
        }}
        onPointerMove={(event) => {
          const index = indexForEvent(event);
          if (index === null) return;
          event.stopPropagation();
          setHoveringRail(true);
          if (previewAlphaIndex !== index) onPreviewAlphaChange(index);
        }}
        onPointerOut={() => {
          setHoveringRail(false);
          onPreviewAlphaChange(null);
        }}
      >
        <sphereGeometry args={[0.064, 6, 4]} />
        <meshBasicMaterial
          color="#ffffff"
          depthTest={false}
          depthWrite={false}
          opacity={0.001}
          transparent
        />
      </instancedMesh>
    </group>
  );
}

function CameraRig({
  mode,
  sliceZ,
  focusPosition,
}: CameraRigProps): React.JSX.Element {
  const controlsRef =
    useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const viewportSize = useThree((state) => state.size);
  const desiredPosition = useRef(new THREE.Vector3(3.4, 3, 3.4));
  const desiredTarget = useRef(new THREE.Vector3());
  const savedPosition = useRef(new THREE.Vector3(3.4, 3, 3.4));
  const savedTarget = useRef(new THREE.Vector3());
  const previousMode = useRef<CameraRigProps["mode"]>("cube");
  const animating = useRef(false);
  const initialized = useRef(false);
  const cameraSliceZ =
    mode === "slice" || mode === "local-slice" ? sliceZ : 0;
  const sliceCameraDistance =
    camera instanceof THREE.PerspectiveCamera
      ? Math.max(
          3.25,
          1.24 /
            Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)),
          1.24 /
            (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) *
              (Math.max(viewportSize.width, 1) /
                Math.max(viewportSize.height, 1))),
        )
      : 3.25;
  const focusKey =
    mode === "focus" && focusPosition
      ? focusPosition.join(",")
      : "";

  useEffect(() => {
    const controls = controlsRef.current;
    const element = controls?.domElement;
    if (!element) return;

    const ensurePointerCapture = (event: PointerEvent) => {
      if (!element.hasPointerCapture(event.pointerId)) {
        element.setPointerCapture(event.pointerId);
      }
    };
    element.addEventListener("pointerdown", ensurePointerCapture);
    return () => {
      element.removeEventListener("pointerdown", ensurePointerCapture);
    };
  }, []);

  useLayoutEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const wasCube = previousMode.current === "cube";
    const becomesCube = mode === "cube";
    if (wasCube && !becomesCube) {
      savedPosition.current.copy(camera.position);
      savedTarget.current.copy(controls.target);
    }

    if (mode === "cube") {
      desiredPosition.current.copy(savedPosition.current);
      desiredTarget.current.copy(savedTarget.current);
    } else if (mode === "slice" || mode === "local-slice") {
      desiredPosition.current.set(
        0,
        0,
        cameraSliceZ + sliceCameraDistance,
      );
      desiredTarget.current.set(0, 0, cameraSliceZ);
    } else if (mode === "local") {
      desiredPosition.current.set(2.55, 2.2, 2.55);
      desiredTarget.current.set(0, 0, 0);
    } else if (focusPosition) {
      const direction = camera.position
        .clone()
        .sub(controls.target)
        .normalize();
      desiredTarget.current.fromArray(focusPosition);
      desiredPosition.current
        .fromArray(focusPosition)
        .addScaledVector(direction, 1.35);
    }

    previousMode.current = mode;
    animating.current = true;
    controls.enabled = false;
    invalidate();
  }, [
    camera,
    cameraSliceZ,
    focusKey,
    invalidate,
    mode,
    sliceCameraDistance,
  ]);

  useFrame((_, delta) => {
    if (!controlsRef.current) return;
    if (!initialized.current) {
      camera.position.copy(savedPosition.current);
      controlsRef.current.target.copy(savedTarget.current);
      camera.up.set(0, 1, 0);
      camera.lookAt(controlsRef.current.target);
      controlsRef.current.update();
      initialized.current = true;
      if (mode === "cube") {
        controlsRef.current.enabled = true;
        animating.current = false;
        return;
      }
    }
    if (!animating.current) return;
    const factor = 1 - Math.exp(-delta * 7.5);
    camera.position.lerp(desiredPosition.current, factor);
    controlsRef.current.target.lerp(desiredTarget.current, factor);
    camera.up.set(0, 1, 0);
    camera.lookAt(controlsRef.current.target);
    controlsRef.current.update();
    const isSettled =
      camera.position.distanceToSquared(desiredPosition.current) < 0.000002 &&
      controlsRef.current.target.distanceToSquared(desiredTarget.current) <
        0.000002;
    if (isSettled) {
      camera.position.copy(desiredPosition.current);
      controlsRef.current.target.copy(desiredTarget.current);
      controlsRef.current.enabled = true;
      animating.current = false;
    } else {
      invalidate();
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.08}
      enablePan
      enableRotate={mode !== "slice" && mode !== "local-slice"}
      enableZoom
      makeDefault
      maxDistance={12}
      minDistance={0.32}
      onChange={() => invalidate()}
      screenSpacePanning
    />
  );
}

function SelectionMarker({
  position,
  flat = false,
}: {
  position: WorldPosition;
  flat?: boolean;
}): React.JSX.Element {
  if (flat) {
    return (
      <mesh position={position} renderOrder={5}>
        <ringGeometry args={[0.039, 0.052, 32]} />
        <meshBasicMaterial
          color="#ffffff"
          depthTest={false}
          opacity={0.95}
          side={THREE.DoubleSide}
          transparent
        />
      </mesh>
    );
  }
  return (
    <mesh position={position} renderOrder={5}>
      <sphereGeometry args={[0.052, 12, 8]} />
      <meshBasicMaterial
        color="#ffffff"
        depthTest={false}
        opacity={0.95}
        transparent
        wireframe
      />
    </mesh>
  );
}

function PointTooltip({
  datum,
}: {
  datum: PointRenderDatum;
}): React.JSX.Element {
  const { coordinates } = datum;
  const formatCoordinate = (value: number) =>
    datum.kind === "featured" ? value.toString() : value.toFixed(4);
  return (
    <Html
      center
      position={datum.position}
      style={{ pointerEvents: "none" }}
      zIndexRange={[4, 0]}
    >
      <div className="cube-viewer__tooltip" style={tooltipStyle}>
        {datum.kind === "featured" && (
          <div>Featured off-grid · {datum.point.display_label}</div>
        )}
        (m<sub>ℓ</sub> = {formatCoordinate(coordinates.m_local)}, m
        <sub>c</sub> = {formatCoordinate(coordinates.m_cross)}, α ={" "}
        {formatCoordinate(coordinates.alpha)})
      </div>
    </Html>
  );
}

function VoxelInstances({
  cells,
  color,
  opacity,
  pickable,
  onHover,
  onSelect,
  renderOrder,
}: {
  cells: readonly RefinementCell[];
  color: string;
  opacity: number;
  pickable: boolean;
  onHover: (cell: RefinementCell | null) => void;
  onSelect: (cell: RefinementCell) => void;
  renderOrder: number;
}): React.JSX.Element | null {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color,
        depthWrite: false,
        opacity,
        transparent: true,
      }),
    [color, opacity],
  );

  useLayoutEffect(() => {
    if (!meshRef.current) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    cells.forEach((cell, index) => {
      position.fromArray(cell.position);
      scale.fromArray(cell.scale);
      matrix.compose(position, quaternion, scale);
      meshRef.current?.setMatrixAt(index, matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [cells]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  if (cells.length === 0) return null;
  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, cells.length]}
      renderOrder={renderOrder}
      onClick={(event) => {
        if (event.delta > CLICK_DRAG_THRESHOLD_PX) return;
        if (!pickable || event.instanceId === undefined) return;
        const cell = cells[event.instanceId];
        if (!cell) return;
        event.stopPropagation();
        onSelect(cell);
      }}
      onPointerMove={(event) => {
        if (!pickable || event.instanceId === undefined) return;
        const cell = cells[event.instanceId];
        if (!cell) return;
        event.stopPropagation();
        onHover(cell);
      }}
      onPointerOut={() => {
        if (pickable) onHover(null);
      }}
    />
  );
}

function RefinementView({
  neighborhood,
  activeAlphaIndex,
  selectedSample,
  centerCoordinates,
  exactCoordinateLabels = false,
  showFaded = true,
  showNonReplicating = true,
  onHoverSample,
  onSelectSample,
}: {
  neighborhood: LocalNeighborhood;
  activeAlphaIndex: number | null;
  selectedSample: LocalSample | null;
  centerCoordinates?: ParameterCoordinates;
  exactCoordinateLabels?: boolean;
  showFaded?: boolean;
  showNonReplicating?: boolean;
  onHoverSample: (sample: LocalSample | null) => void;
  onSelectSample: (sample: LocalSample) => void;
}): React.JSX.Element {
  const [hoveredCell, setHoveredCell] = useState<RefinementCell | null>(null);
  const cells = useMemo(
    () => buildRefinementCells(neighborhood, activeAlphaIndex),
    [activeAlphaIndex, neighborhood],
  );
  const boundaryPositions = useMemo(
    () => buildRefinementBoundarySegments(neighborhood, activeAlphaIndex),
    [activeAlphaIndex, neighborhood],
  );

  const handleHover = (cell: RefinementCell | null) => {
    setHoveredCell(cell);
    onHoverSample(cell?.sample ?? null);
  };
  const visibleCells = showFaded
    ? [
        ...cells.positive,
        ...(showNonReplicating ? cells.negative : []),
        ...cells.fadedPositive,
        ...(showNonReplicating ? cells.fadedNegative : []),
      ]
    : [
        ...cells.positive,
        ...(showNonReplicating ? cells.negative : []),
      ];
  const selectedCell = selectedSample
    ? visibleCells.find(
        (cell) =>
          cell.sample.grid_index[0] === selectedSample.grid_index[0] &&
          cell.sample.grid_index[1] === selectedSample.grid_index[1] &&
          cell.sample.grid_index[2] === selectedSample.grid_index[2],
      )
    : centerCoordinates
      ? visibleCells.find(
          (cell) =>
            cell.sample.coordinates.m_local ===
              centerCoordinates.m_local &&
            cell.sample.coordinates.m_cross ===
              centerCoordinates.m_cross &&
            cell.sample.coordinates.alpha === centerCoordinates.alpha,
        )
      : null;
  const visibleHoveredCell = hoveredCell
    ? visibleCells.find(
        (cell) =>
          cell.sample.grid_index[0] === hoveredCell.sample.grid_index[0] &&
          cell.sample.grid_index[1] === hoveredCell.sample.grid_index[1] &&
          cell.sample.grid_index[2] === hoveredCell.sample.grid_index[2],
      )
    : null;

  return (
    <group>
      {showFaded && (
        <>
          <VoxelInstances
            cells={cells.fadedPositive}
            color={STATUS_COLORS.self_replicator}
            opacity={0.07}
            pickable={false}
            renderOrder={1}
            onHover={handleHover}
            onSelect={(cell) => onSelectSample(cell.sample)}
          />
          {showNonReplicating && (
            <VoxelInstances
              cells={cells.fadedNegative}
              color={REFINEMENT_NEGATIVE_COLOR}
              opacity={0.045}
              pickable={false}
              renderOrder={1}
              onHover={handleHover}
              onSelect={(cell) => onSelectSample(cell.sample)}
            />
          )}
        </>
      )}
      <VoxelInstances
        cells={cells.positive}
        color={STATUS_COLORS.self_replicator}
        opacity={0.38}
        pickable
        renderOrder={2}
        onHover={handleHover}
        onSelect={(cell) => onSelectSample(cell.sample)}
      />
      {showNonReplicating && (
        <VoxelInstances
          cells={cells.negative}
          color={REFINEMENT_NEGATIVE_COLOR}
          opacity={0.24}
          pickable
          renderOrder={2}
          onHover={handleHover}
          onSelect={(cell) => onSelectSample(cell.sample)}
        />
      )}
      <LineGeometry
        color="#ffffff"
        opacity={1}
        positions={boundaryPositions}
        renderOrder={4}
      />
      {selectedCell && <SelectionMarker position={selectedCell.position} />}
      {visibleHoveredCell && (
        <Html
          center
          position={visibleHoveredCell.position}
          style={{ pointerEvents: "none" }}
          zIndexRange={[4, 0]}
        >
          <div className="cube-viewer__tooltip" style={tooltipStyle}>
            {"variation_label" in visibleHoveredCell.sample &&
              visibleHoveredCell.sample.variation_label && (
                <div>{visibleHoveredCell.sample.variation_label}</div>
            )}
            (m<sub>ℓ</sub> ={" "}
            {exactCoordinateLabels
              ? visibleHoveredCell.sample.coordinates.m_local.toString()
              : visibleHoveredCell.sample.coordinates.m_local.toFixed(5)}
            , m
            <sub>c</sub> ={" "}
            {exactCoordinateLabels
              ? visibleHoveredCell.sample.coordinates.m_cross.toString()
              : visibleHoveredCell.sample.coordinates.m_cross.toFixed(5)}
            , α ={" "}
            {exactCoordinateLabels
              ? visibleHoveredCell.sample.coordinates.alpha.toString()
              : visibleHoveredCell.sample.coordinates.alpha.toFixed(5)}
            )
          </div>
        </Html>
      )}
    </group>
  );
}

function ParameterScene({
  manifest,
  reviewOverlay,
  refinementCatalog,
  featuredCatalog,
  selectedPoint,
  selectedLocalSample = null,
  hoveredPoint,
  pinnedAlphaIndex,
  previewAlphaIndex,
  onSelectPoint,
  onHoverPoint,
  onPinnedAlphaChange,
  onPreviewAlphaChange,
  onSelectLocalSample,
  onHoverLocalSample,
  localModeEnabled = true,
  replicatorVariationsOnly = false,
  visibleStatuses,
}: Omit<CubeViewerProps, "className" | "showLegend">): React.JSX.Element {
  const glowRadius = useMemo(
    () => selfReplicatorGlowRadius(manifest.axes),
    [manifest.axes],
  );
  const pointData = useMemo(
    () => [
      ...makePointRenderData(manifest, reviewOverlay, featuredCatalog),
      ...makeFeaturedPointRenderData(manifest, featuredCatalog),
    ],
    [featuredCatalog, manifest, reviewOverlay],
  );
  const pointBySelection = useMemo(
    () =>
      new Map(
        pointData.map((datum) => [
          selectionKey(renderDatumSelection(datum)),
          datum,
        ]),
      ),
    [pointData],
  );
  const visiblePointData = useMemo(
    () =>
      visibleStatuses
        ? pointData.filter((datum) => visibleStatuses.has(datum.status))
        : pointData,
    [pointData, visibleStatuses],
  );
  const selectedDatum =
    selectedPoint === null
      ? null
      : (pointBySelection.get(selectionKey(selectedPoint)) ?? null);
  const selectedFeaturedPoint =
    selectedPoint?.kind === "featured"
      ? (featuredCatalog?.featured_points.find(
          (point) => point.id === selectedPoint.id,
        ) ?? null)
      : null;
  const selectedLinkedFeaturedPoint =
    selectedPoint?.kind === "coarse"
      ? (findFeaturedPointForCoarsePoint(
          featuredCatalog,
          selectedPoint.id,
        ) ?? null)
      : null;
  const selectedCatalogPoint =
    selectedFeaturedPoint ?? selectedLinkedFeaturedPoint;
  const selectedStatusVisible =
    selectedDatum === null ||
    visibleStatuses === undefined ||
    visibleStatuses.has(selectedDatum.status);
  const hoveredDatum =
    hoveredPoint === null
      ? null
      : (pointBySelection.get(selectionKey(hoveredPoint)) ?? null);
  const effectiveAlphaIndex = pinnedAlphaIndex ?? previewAlphaIndex;
  const validAlphaIndex =
    effectiveAlphaIndex !== null &&
    effectiveAlphaIndex >= 0 &&
    effectiveAlphaIndex < manifest.axes.alpha.values.length
      ? effectiveAlphaIndex
      : null;
  const isPinnedAlphaSlice =
    pinnedAlphaIndex !== null && validAlphaIndex !== null;
  const splitData = useMemo(
    () =>
      splitPointDataByAlpha(
        visiblePointData,
        validAlphaIndex,
        !isPinnedAlphaSlice,
      ),
    [isPinnedAlphaSlice, validAlphaIndex, visiblePointData],
  );
  const selectedCatalogNeighborhood = selectedCatalogPoint
    ? (findFeaturedNeighborhood(
        featuredCatalog,
        selectedCatalogPoint,
      ) ?? null)
    : null;
  const neighborhood =
    !selectedStatusVisible
      ? null
      : selectedPoint?.kind === "featured"
        ? selectedCatalogNeighborhood
        : selectedPoint?.kind === "coarse" &&
            selectedDatum?.status === "self_replicator"
          ? (refinementCatalog?.neighborhoods.find(
              (candidate) =>
                candidate.center_point_id === selectedPoint.id,
            ) ??
            selectedCatalogNeighborhood)
          : null;
  const targetAlpha =
    validAlphaIndex === null
      ? null
      : manifest.axes.alpha.values[validAlphaIndex] ?? null;
  const localAlphaIndex =
    neighborhood && validAlphaIndex !== null
      ? refinementAlphaIndexForSlab(
          neighborhood,
          manifest.axes.alpha.values,
          validAlphaIndex,
          selectedCatalogPoint?.coordinates.alpha,
        )
      : null;
  const globalSliceZ =
    validAlphaIndex === null
      ? 0
      : normalizeAxisValue(
          manifest.axes.alpha.values[validAlphaIndex] ?? 0,
          manifest.axes.alpha.values,
        );
  const localZCells = neighborhood
    ? buildAxisCells(neighborhood.axes.alpha)
    : [];
  const localSliceZ =
    localAlphaIndex === null
      ? 0
      : (localZCells[localAlphaIndex]?.center ?? 0);
  const localMode = localModeEnabled && neighborhood !== null;
  const isPinnedLocalSlice =
    localMode && isPinnedAlphaSlice && localAlphaIndex !== null;
  const globalRefinementTransform =
    neighborhood && !localMode && localAlphaIndex !== null
      ? refinementToGlobalTransform(
          neighborhood,
          manifest.axes,
          selectedCatalogPoint?.coordinates,
        )
      : null;
  const visibleHoveredDatum =
    hoveredDatum &&
    (!isPinnedAlphaSlice ||
      hoveredDatum.alphaIndex === validAlphaIndex)
      ? hoveredDatum
      : null;
  const cameraMode: CameraRigProps["mode"] = localMode
    ? isPinnedLocalSlice
      ? "local-slice"
      : "local"
    : isPinnedAlphaSlice
      ? "slice"
      : selectedStatusVisible && selectedDatum?.status === "self_replicator"
        ? "focus"
        : "cube";

  return (
    <>
      <color attach="background" args={["#313338"]} />
      <CameraRig
        focusPosition={selectedDatum?.position ?? null}
        mode={cameraMode}
        sliceZ={localMode ? localSliceZ : globalSliceZ}
      />
      {localMode && neighborhood ? (
        <>
          {isPinnedLocalSlice && targetAlpha !== null ? (
            <FlatSliceFrame alpha={targetAlpha} z={localSliceZ} />
          ) : (
            <CubeFrame local />
          )}
          <RefinementView
            activeAlphaIndex={localAlphaIndex}
            centerCoordinates={
              selectedCatalogPoint?.coordinates ??
              selectedDatum?.coordinates
            }
            exactCoordinateLabels={selectedPoint?.kind === "featured"}
            neighborhood={neighborhood}
            selectedSample={selectedLocalSample}
            showFaded={!isPinnedLocalSlice}
            showNonReplicating={!replicatorVariationsOnly}
            onHoverSample={(sample) => onHoverLocalSample?.(sample)}
            onSelectSample={(sample) => onSelectLocalSample?.(sample)}
          />
          {localAlphaIndex !== null && !isPinnedLocalSlice && (
            <SlicePlane z={localSliceZ} />
          )}
        </>
      ) : (
        <>
          {!isPinnedAlphaSlice && <CubeFrame />}
          {!isPinnedAlphaSlice && (
            <>
              <SelfReplicatorGlow
                data={splitData.faded}
                depthTest
                opacity={0.035}
                radius={glowRadius}
                renderOrder={-1}
              />
              <PointCloud
                data={splitData.faded}
                depthWrite={false}
                hoveredPoint={hoveredPoint}
                opacity={0.2}
                pickable={false}
                pointSize={20}
                renderOrder={0}
                onHoverPoint={onHoverPoint}
                onSelectPoint={onSelectPoint}
              />
            </>
          )}
          <SelfReplicatorGlow
            data={splitData.active}
            depthTest={validAlphaIndex === null}
            opacity={0.18}
            radius={glowRadius}
            renderOrder={validAlphaIndex === null ? 0 : 2}
          />
          <PointCloud
            data={splitData.active}
            depthTest={validAlphaIndex === null}
            depthWrite={validAlphaIndex === null}
            hoveredPoint={hoveredPoint}
            opacity={1}
            pointSize={20}
            renderOrder={validAlphaIndex === null ? 1 : 3}
            onHoverPoint={onHoverPoint}
            onSelectPoint={onSelectPoint}
          />
          {isPinnedAlphaSlice && targetAlpha !== null ? (
            <FlatSliceFrame alpha={targetAlpha} z={globalSliceZ} />
          ) : (
            validAlphaIndex !== null && <SlicePlane z={globalSliceZ} />
          )}
          {neighborhood &&
            globalRefinementTransform &&
            localAlphaIndex !== null && (
              <group
                position={globalRefinementTransform.position}
                scale={globalRefinementTransform.scale}
              >
                <RefinementView
                  activeAlphaIndex={localAlphaIndex}
                  centerCoordinates={
                    selectedCatalogPoint?.coordinates ??
                    selectedDatum?.coordinates
                  }
                  exactCoordinateLabels={
                    selectedPoint?.kind === "featured"
                  }
                  neighborhood={neighborhood}
                  selectedSample={selectedLocalSample}
                  showFaded={false}
                  onHoverSample={(sample) => onHoverLocalSample?.(sample)}
                  onSelectSample={(sample) => onSelectLocalSample?.(sample)}
                />
              </group>
            )}
          {!isPinnedAlphaSlice && (
            <AlphaRails
              alphaValues={manifest.axes.alpha.values}
              pinnedAlphaIndex={pinnedAlphaIndex}
              previewAlphaIndex={previewAlphaIndex}
              onPinnedAlphaChange={onPinnedAlphaChange}
              onPreviewAlphaChange={onPreviewAlphaChange}
            />
          )}
          {selectedDatum &&
            selectedStatusVisible &&
            (!isPinnedAlphaSlice ||
              selectedDatum.alphaIndex === validAlphaIndex) && (
              <SelectionMarker
                flat={isPinnedAlphaSlice}
                position={selectedDatum.position}
              />
            )}
          {visibleHoveredDatum && <PointTooltip datum={visibleHoveredDatum} />}
        </>
      )}
    </>
  );
}

export function CubeViewer({
  manifest,
  reviewOverlay = null,
  refinementCatalog = null,
  featuredCatalog = null,
  selectedPoint,
  selectedLocalSample = null,
  hoveredPoint,
  pinnedAlphaIndex,
  previewAlphaIndex,
  onSelectPoint,
  onHoverPoint,
  onPinnedAlphaChange,
  onPreviewAlphaChange,
  onSelectLocalSample,
  onHoverLocalSample,
  localModeEnabled = true,
  replicatorVariationsOnly = false,
  visibleStatuses,
  className,
  showLegend = false,
}: CubeViewerProps): React.JSX.Element {
  const hoveredPointDetails = useMemo(
    () => {
      if (hoveredPoint === null) return null;
      if (hoveredPoint.kind === "coarse") {
        const point =
          manifest.points.find((candidate) => candidate.id === hoveredPoint.id) ??
          null;
        return point
          ? {
              id: point.id,
              label: point.id,
              coordinates: point.coordinates,
              alphaIndex: point.grid_index[2],
            }
          : null;
      }
      const point =
        featuredCatalog?.featured_points.find(
          (candidate) => candidate.id === hoveredPoint.id,
        ) ?? null;
      return point
        ? {
            id: point.id,
            label: `Featured off-grid ${point.display_label}`,
            coordinates: point.coordinates,
            alphaIndex: nearestAxisIndex(
              manifest.axes.alpha.values,
              point.coordinates.alpha,
            ),
          }
        : null;
    },
    [
      featuredCatalog?.featured_points,
      hoveredPoint,
      manifest.axes.alpha.values,
      manifest.points,
    ],
  );
  const pinnedAlphaValue =
    pinnedAlphaIndex !== null &&
    pinnedAlphaIndex >= 0 &&
    pinnedAlphaIndex < manifest.axes.alpha.values.length
      ? (manifest.axes.alpha.values[pinnedAlphaIndex] ?? null)
      : null;
  const visibleHoveredPoint =
    hoveredPointDetails &&
    (pinnedAlphaValue === null ||
      hoveredPointDetails.alphaIndex === pinnedAlphaIndex)
      ? hoveredPointDetails
      : null;
  const selectedFeaturedPoint =
    selectedPoint?.kind === "featured"
      ? (featuredCatalog?.featured_points.find(
          (point) => point.id === selectedPoint.id,
        ) ?? null)
      : null;
  const selectedLinkedFeaturedPoint =
    selectedPoint?.kind === "coarse"
      ? (findFeaturedPointForCoarsePoint(
          featuredCatalog,
          selectedPoint.id,
        ) ?? null)
      : null;
  const selectedCatalogPoint =
    selectedFeaturedPoint ?? selectedLinkedFeaturedPoint;
  const selectedCatalogNeighborhood = selectedCatalogPoint
    ? (featuredCatalog?.neighborhoods.find(
        (neighborhood) =>
          neighborhood.center_featured_id === selectedCatalogPoint.id,
      ) ?? null)
    : null;
  const selectedFeaturedFineAlphaIndex =
    selectedCatalogNeighborhood && pinnedAlphaIndex !== null
      ? refinementAlphaIndexForSlab(
          selectedCatalogNeighborhood,
          manifest.axes.alpha.values,
          pinnedAlphaIndex,
          selectedCatalogPoint?.coordinates.alpha,
        )
      : null;
  const selectedFeaturedFineAlpha =
    selectedFeaturedFineAlphaIndex === null
      ? null
      : (selectedCatalogNeighborhood?.axes.alpha[
          selectedFeaturedFineAlphaIndex
        ] ?? null);
  return (
    <section
      className={["cube-viewer", className].filter(Boolean).join(" ")}
      style={{
        background: "#313338",
        height: "100%",
        minHeight: "24rem",
        overflow: "hidden",
        position: "relative",
        width: "100%",
      }}
    >
      {showLegend && <CubeLegend />}
      <div aria-live="polite" style={screenReaderOnlyStyle}>
        {visibleHoveredPoint
          ? `Hovered parameter point ${visibleHoveredPoint.label}: m local ${visibleHoveredPoint.coordinates.m_local}, m cross ${visibleHoveredPoint.coordinates.m_cross}, alpha ${visibleHoveredPoint.coordinates.alpha}.`
          : ""}
      </div>
      <div
        className="cube-viewer__refinement-status"
        style={screenReaderOnlyStyle}
      >
        {selectedCatalogPoint && localModeEnabled
          ? `Featured local neighborhood for ${selectedCatalogPoint.display_label} is displayed. The white marker identifies its selected center or variation. White lines mark the boundary between manually classified sampled outcomes.${replicatorVariationsOnly ? " Only self-replicating variation cells are visible." : ""}`
          : selectedCatalogPoint &&
              pinnedAlphaValue !== null &&
              selectedFeaturedFineAlpha !== null
            ? selectedFeaturedPoint
              ? `Featured neighborhood plane at exact alpha ${selectedFeaturedFineAlpha.toString()} is displayed within coarse alpha slab ${pinnedAlphaValue.toString()}. White lines mark the boundary between manually classified sampled outcomes.`
              : `Featured neighborhood plane for ${selectedCatalogPoint.display_label} at exact alpha ${selectedFeaturedFineAlpha.toString()} is displayed within coarse alpha slab ${pinnedAlphaValue.toString()}. White lines mark the boundary between manually classified sampled outcomes.`
            : ""}
      </div>
      <Canvas
        aria-label={
          pinnedAlphaValue === null
            ? "Interactive three-dimensional Lenia parameter cube. Drag to orbit, pan, or zoom. Hover or select a point for its parameter triple."
            : `Interactive two-dimensional Lenia parameter grid for alpha ${pinnedAlphaValue.toFixed(3)}. Drag to pan or scroll to zoom. Hover or select a point for its parameter triple.`
        }
        camera={{
          far: 100,
          fov: 42,
          near: 0.01,
          position: [3.4, 3, 3.4],
        }}
        className="cube-viewer__canvas"
        dpr={[1, 1.75]}
        frameloop="demand"
        gl={{
          alpha: false,
          antialias: true,
          powerPreference: "high-performance",
        }}
        onCreated={({ camera, raycaster }) => {
          camera.lookAt(0, 0, 0);
          camera.updateProjectionMatrix();
          raycaster.params.Points.threshold = 0.04;
        }}
        onPointerMissed={() => {
          onHoverPoint(null);
          onSelectLocalSample?.(null);
        }}
      >
        <ParameterScene
          manifest={manifest}
          reviewOverlay={reviewOverlay}
          refinementCatalog={refinementCatalog}
          featuredCatalog={featuredCatalog}
          selectedPoint={selectedPoint}
          selectedLocalSample={selectedLocalSample}
          hoveredPoint={hoveredPoint}
          pinnedAlphaIndex={pinnedAlphaIndex}
          previewAlphaIndex={previewAlphaIndex}
          onSelectPoint={onSelectPoint}
          onHoverPoint={onHoverPoint}
          onPinnedAlphaChange={onPinnedAlphaChange}
          onPreviewAlphaChange={onPreviewAlphaChange}
          onSelectLocalSample={onSelectLocalSample}
          onHoverLocalSample={onHoverLocalSample}
          localModeEnabled={localModeEnabled}
          replicatorVariationsOnly={replicatorVariationsOnly}
          visibleStatuses={visibleStatuses}
        />
      </Canvas>
    </section>
  );
}

export default CubeViewer;
