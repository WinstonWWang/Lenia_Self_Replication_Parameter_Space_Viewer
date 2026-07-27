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
  RefinementCatalog,
  RefinementNeighborhood,
  RefinementSample,
  ReviewOverlay,
  SiteManifest,
} from "../data";
import {
  buildAxisCells,
  buildRefinementBoundarySegments,
  buildRefinementCells,
  makePointRenderData,
  nearestAxisIndex,
  normalizeAxisValue,
  REFINEMENT_NEGATIVE_COLOR,
  refinementContainsAlpha,
  refinementToGlobalTransform,
  splitPointDataByAlpha,
  STATUS_COLORS,
  type PointRenderDatum,
  type RefinementCell,
  type WorldPosition,
} from "../visualization/geometry";

export interface CubeViewerProps {
  manifest: SiteManifest;
  reviewOverlay?: ReviewOverlay | null;
  refinementCatalog?: RefinementCatalog | null;
  selectedPointId: string | null;
  selectedRefinementSample?: RefinementSample | null;
  hoveredPointId: string | null;
  pinnedAlphaIndex: number | null;
  previewAlphaIndex: number | null;
  onSelectPoint: (pointId: string) => void;
  onHoverPoint: (pointId: string | null) => void;
  onPinnedAlphaChange: (alphaIndex: number | null) => void;
  onPreviewAlphaChange: (alphaIndex: number | null) => void;
  onSelectRefinementSample?: (sample: RefinementSample | null) => void;
  onHoverRefinementSample?: (sample: RefinementSample | null) => void;
  localModeEnabled?: boolean;
  visibleStatuses?: ReadonlySet<DisplayStatus>;
  className?: string;
  showLegend?: boolean;
}

interface PointCloudProps {
  data: readonly PointRenderDatum[];
  opacity: number;
  pointSize?: number;
  pickable?: boolean;
  hoveredPointId: string | null;
  onHoverPoint: (pointId: string | null) => void;
  onSelectPoint: (pointId: string) => void;
  renderOrder?: number;
  depthTest?: boolean;
  depthWrite?: boolean;
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
  hoveredPointId,
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
        onSelectPoint(datum.id);
      }}
      onPointerMove={(event) => {
        const datum = pointForEvent(event);
        if (!datum) return;
        event.stopPropagation();
        if (hoveredPointId !== datum.id) onHoverPoint(datum.id);
      }}
      onPointerOut={() => {
        if (pickable) onHoverPoint(null);
      }}
    />
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
  const desiredPosition = useRef(new THREE.Vector3(3.4, 3, 3.4));
  const desiredTarget = useRef(new THREE.Vector3());
  const savedPosition = useRef(new THREE.Vector3(3.4, 3, 3.4));
  const savedTarget = useRef(new THREE.Vector3());
  const previousMode = useRef<CameraRigProps["mode"]>("cube");
  const animating = useRef(false);
  const initialized = useRef(false);
  const cameraSliceZ =
    mode === "slice" || mode === "local-slice" ? sliceZ : 0;
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
      const direction = cameraSliceZ >= 0 ? 1 : -1;
      desiredPosition.current.set(
        0,
        0,
        cameraSliceZ + direction * 3.25,
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
  }, [camera, cameraSliceZ, focusKey, invalidate, mode]);

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
}: {
  position: WorldPosition;
}): React.JSX.Element {
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
  const { coordinates } = datum.point;
  return (
    <Html
      center
      position={datum.position}
      style={{ pointerEvents: "none" }}
      zIndexRange={[4, 0]}
    >
      <div className="cube-viewer__tooltip" style={tooltipStyle}>
        (m<sub>ℓ</sub> = {coordinates.m_local.toFixed(4)}, m<sub>c</sub> ={" "}
        {coordinates.m_cross.toFixed(4)}, α = {coordinates.alpha.toFixed(4)})
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
  showFaded = true,
  onHoverSample,
  onSelectSample,
}: {
  neighborhood: RefinementNeighborhood;
  activeAlphaIndex: number | null;
  selectedSample: RefinementSample | null;
  showFaded?: boolean;
  onHoverSample: (sample: RefinementSample | null) => void;
  onSelectSample: (sample: RefinementSample) => void;
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
  const selectedCell = selectedSample
    ? [
        ...cells.positive,
        ...cells.negative,
        ...cells.fadedPositive,
        ...cells.fadedNegative,
      ].find(
        (cell) =>
          cell.sample.grid_index[0] === selectedSample.grid_index[0] &&
          cell.sample.grid_index[1] === selectedSample.grid_index[1] &&
          cell.sample.grid_index[2] === selectedSample.grid_index[2],
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
          <VoxelInstances
            cells={cells.fadedNegative}
            color={REFINEMENT_NEGATIVE_COLOR}
            opacity={0.045}
            pickable={false}
            renderOrder={1}
            onHover={handleHover}
            onSelect={(cell) => onSelectSample(cell.sample)}
          />
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
      <VoxelInstances
        cells={cells.negative}
        color={REFINEMENT_NEGATIVE_COLOR}
        opacity={0.24}
        pickable
        renderOrder={2}
        onHover={handleHover}
        onSelect={(cell) => onSelectSample(cell.sample)}
      />
      <LineGeometry
        color="#ffffff"
        opacity={1}
        positions={boundaryPositions}
        renderOrder={4}
      />
      {selectedCell && <SelectionMarker position={selectedCell.position} />}
      {hoveredCell && (
        <Html
          center
          position={hoveredCell.position}
          style={{ pointerEvents: "none" }}
          zIndexRange={[4, 0]}
        >
          <div className="cube-viewer__tooltip" style={tooltipStyle}>
            (m<sub>ℓ</sub> ={" "}
            {hoveredCell.sample.coordinates.m_local.toFixed(5)}, m
            <sub>c</sub> ={" "}
            {hoveredCell.sample.coordinates.m_cross.toFixed(5)}, α ={" "}
            {hoveredCell.sample.coordinates.alpha.toFixed(5)})
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
  selectedPointId,
  selectedRefinementSample = null,
  hoveredPointId,
  pinnedAlphaIndex,
  previewAlphaIndex,
  onSelectPoint,
  onHoverPoint,
  onPinnedAlphaChange,
  onPreviewAlphaChange,
  onSelectRefinementSample,
  onHoverRefinementSample,
  localModeEnabled = true,
  visibleStatuses,
}: Omit<CubeViewerProps, "className" | "showLegend">): React.JSX.Element {
  const pointData = useMemo(
    () => makePointRenderData(manifest, reviewOverlay),
    [manifest, reviewOverlay],
  );
  const pointById = useMemo(
    () => new Map(pointData.map((datum) => [datum.id, datum])),
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
    selectedPointId === null ? null : (pointById.get(selectedPointId) ?? null);
  const selectedStatusVisible =
    selectedDatum === null ||
    visibleStatuses === undefined ||
    visibleStatuses.has(selectedDatum.status);
  const hoveredDatum =
    hoveredPointId === null ? null : (pointById.get(hoveredPointId) ?? null);
  const effectiveAlphaIndex = pinnedAlphaIndex ?? previewAlphaIndex;
  const validAlphaIndex =
    effectiveAlphaIndex !== null &&
    effectiveAlphaIndex >= 0 &&
    effectiveAlphaIndex < manifest.axes.alpha.values.length
      ? effectiveAlphaIndex
      : null;
  const splitData = useMemo(
    () => splitPointDataByAlpha(visiblePointData, validAlphaIndex),
    [validAlphaIndex, visiblePointData],
  );
  const neighborhood =
    selectedStatusVisible && selectedDatum?.status === "self_replicator"
      ? (refinementCatalog?.neighborhoods.find(
          (candidate) => candidate.center_point_id === selectedDatum.id,
        ) ?? null)
      : null;
  const targetAlpha =
    validAlphaIndex === null
      ? null
      : manifest.axes.alpha.values[validAlphaIndex] ?? null;
  const localAlphaIndex =
    neighborhood &&
    targetAlpha !== null &&
    refinementContainsAlpha(
      neighborhood,
      targetAlpha,
      manifest.axes.alpha.values,
    )
      ? nearestAxisIndex(neighborhood.axes.alpha, targetAlpha)
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
  const globalRefinementTransform =
    neighborhood && !localMode && localAlphaIndex !== null
      ? refinementToGlobalTransform(neighborhood, manifest.axes)
      : null;
  const cameraMode: CameraRigProps["mode"] = localMode
    ? pinnedAlphaIndex !== null
      ? "local-slice"
      : "local"
    : pinnedAlphaIndex !== null
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
          <CubeFrame local />
          <RefinementView
            activeAlphaIndex={localAlphaIndex}
            neighborhood={neighborhood}
            selectedSample={selectedRefinementSample}
            onHoverSample={(sample) => onHoverRefinementSample?.(sample)}
            onSelectSample={(sample) => onSelectRefinementSample?.(sample)}
          />
          {localAlphaIndex !== null && <SlicePlane z={localSliceZ} />}
        </>
      ) : (
        <>
          <CubeFrame />
          <PointCloud
            data={splitData.faded}
            depthWrite={false}
            hoveredPointId={hoveredPointId}
            opacity={0.2}
            pickable={false}
            pointSize={20}
            renderOrder={0}
            onHoverPoint={onHoverPoint}
            onSelectPoint={onSelectPoint}
          />
          <PointCloud
            data={splitData.active}
            depthTest={validAlphaIndex === null}
            depthWrite={validAlphaIndex === null}
            hoveredPointId={hoveredPointId}
            opacity={1}
            pointSize={20}
            renderOrder={validAlphaIndex === null ? 1 : 3}
            onHoverPoint={onHoverPoint}
            onSelectPoint={onSelectPoint}
          />
          {validAlphaIndex !== null && <SlicePlane z={globalSliceZ} />}
          {neighborhood &&
            globalRefinementTransform &&
            localAlphaIndex !== null && (
              <group
                position={globalRefinementTransform.position}
                scale={globalRefinementTransform.scale}
              >
                <RefinementView
                  activeAlphaIndex={localAlphaIndex}
                  neighborhood={neighborhood}
                  selectedSample={selectedRefinementSample}
                  showFaded={false}
                  onHoverSample={(sample) =>
                    onHoverRefinementSample?.(sample)
                  }
                  onSelectSample={(sample) =>
                    onSelectRefinementSample?.(sample)
                  }
                />
              </group>
            )}
          <AlphaRails
            alphaValues={manifest.axes.alpha.values}
            pinnedAlphaIndex={pinnedAlphaIndex}
            previewAlphaIndex={previewAlphaIndex}
            onPinnedAlphaChange={onPinnedAlphaChange}
            onPreviewAlphaChange={onPreviewAlphaChange}
          />
          {selectedDatum &&
            selectedStatusVisible &&
            (pinnedAlphaIndex === null ||
              selectedDatum.point.grid_index[2] === pinnedAlphaIndex) && (
              <SelectionMarker position={selectedDatum.position} />
            )}
          {hoveredDatum && <PointTooltip datum={hoveredDatum} />}
        </>
      )}
    </>
  );
}

export function CubeViewer({
  manifest,
  reviewOverlay = null,
  refinementCatalog = null,
  selectedPointId,
  selectedRefinementSample = null,
  hoveredPointId,
  pinnedAlphaIndex,
  previewAlphaIndex,
  onSelectPoint,
  onHoverPoint,
  onPinnedAlphaChange,
  onPreviewAlphaChange,
  onSelectRefinementSample,
  onHoverRefinementSample,
  localModeEnabled = true,
  visibleStatuses,
  className,
  showLegend = false,
}: CubeViewerProps): React.JSX.Element {
  const hoveredPoint = useMemo(
    () =>
      hoveredPointId === null
        ? null
        : (manifest.points.find((point) => point.id === hoveredPointId) ?? null),
    [hoveredPointId, manifest.points],
  );
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
        {hoveredPoint
          ? `Hovered parameter point ${hoveredPoint.id}: m local ${hoveredPoint.coordinates.m_local}, m cross ${hoveredPoint.coordinates.m_cross}, alpha ${hoveredPoint.coordinates.alpha}.`
          : ""}
      </div>
      <Canvas
        aria-label="Interactive three-dimensional Lenia parameter cube. Drag to orbit, pan, or zoom. Hover or select a point for its parameter triple."
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
          onSelectRefinementSample?.(null);
        }}
      >
        <ParameterScene
          manifest={manifest}
          reviewOverlay={reviewOverlay}
          refinementCatalog={refinementCatalog}
          selectedPointId={selectedPointId}
          selectedRefinementSample={selectedRefinementSample}
          hoveredPointId={hoveredPointId}
          pinnedAlphaIndex={pinnedAlphaIndex}
          previewAlphaIndex={previewAlphaIndex}
          onSelectPoint={onSelectPoint}
          onHoverPoint={onHoverPoint}
          onPinnedAlphaChange={onPinnedAlphaChange}
          onPreviewAlphaChange={onPreviewAlphaChange}
          onSelectRefinementSample={onSelectRefinementSample}
          onHoverRefinementSample={onHoverRefinementSample}
          localModeEnabled={localModeEnabled}
          visibleStatuses={visibleStatuses}
        />
      </Canvas>
    </section>
  );
}

export default CubeViewer;
