"use client";

import { RoundedBox } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Component,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";

interface Full3DWatchCanvasProps {
  readonly definitionOpen: boolean;
  readonly reducedMotion: boolean;
}

interface BoundaryProps {
  readonly children: ReactNode;
  readonly fallback: ReactNode;
}

class WebGLBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function StaticMovementFallback({ softened }: { softened: boolean }) {
  return (
    <div className={`watch-static-fallback${softened ? " is-softened" : ""}`} aria-hidden="true">
      <span className="static-case" />
      <span className="static-gear static-gear--one" />
      <span className="static-gear static-gear--two" />
      <span className="static-gear static-gear--three" />
      <span className="static-gear static-gear--four" />
      <span className="static-bridge static-bridge--one" />
      <span className="static-bridge static-bridge--two" />
      <span className="static-balance" />
      <span className="static-jewel static-jewel--one" />
      <span className="static-jewel static-jewel--two" />
      <span className="static-jewel static-jewel--three" />
    </div>
  );
}

function createMetalMaterial(color: string, roughness: number, clearcoat = 0.7) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.96,
    roughness,
    clearcoat,
    clearcoatRoughness: 0.16,
    envMapIntensity: 1.8,
  });
}

interface GearProps {
  readonly gearRef: React.RefObject<THREE.Group | null>;
  readonly position: readonly [number, number, number];
  readonly radius: number;
  readonly teeth: number;
  readonly color: string;
  readonly roughness?: number;
  readonly jewelColor?: string;
}

function Gear({
  gearRef,
  position,
  radius,
  teeth,
  color,
  roughness = 0.2,
  jewelColor = "#8d0b25",
}: GearProps) {
  const material = useMemo(() => createMetalMaterial(color, roughness), [color, roughness]);
  const bevelMaterial = useMemo(() => createMetalMaterial("#e8edef", 0.12, 0.9), []);
  const angles = useMemo(
    () => Array.from({ length: teeth }, (_, index) => (index / teeth) * Math.PI * 2),
    [teeth],
  );
  const spokeAngles = useMemo(
    () => Array.from({ length: 7 }, (_, index) => (index / 7) * Math.PI * 2),
    [],
  );

  useEffect(() => () => {
    material.dispose();
    bevelMaterial.dispose();
  }, [bevelMaterial, material]);

  return (
    <group ref={gearRef} position={position as [number, number, number]}>
      <mesh material={material}>
        <torusGeometry args={[radius * 0.72, radius * 0.105, 12, Math.max(48, teeth * 2)]} />
      </mesh>
      <mesh material={bevelMaterial} position={[0, 0, 0.035]}>
        <torusGeometry args={[radius * 0.72, radius * 0.026, 8, Math.max(48, teeth * 2)]} />
      </mesh>
      {angles.map((angle, index) => (
        <mesh
          key={index}
          material={material}
          position={[Math.cos(angle) * radius, Math.sin(angle) * radius, 0]}
          rotation={[0, 0, angle]}
        >
          <boxGeometry args={[radius * 0.17, radius * 0.19, 0.16]} />
        </mesh>
      ))}
      {spokeAngles.map((angle) => (
        <mesh
          key={angle}
          material={material}
          position={[Math.cos(angle) * radius * 0.35, Math.sin(angle) * radius * 0.35, -0.015]}
          rotation={[0, 0, angle]}
        >
          <boxGeometry args={[radius * 0.68, radius * 0.065, 0.12]} />
        </mesh>
      ))}
      <mesh material={material} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[radius * 0.18, radius * 0.18, 0.22, 32]} />
      </mesh>
      <mesh position={[0, 0, 0.15]}>
        <cylinderGeometry args={[radius * 0.09, radius * 0.12, 0.12, 32]} />
        <meshPhysicalMaterial
          color="#b88b5f"
          metalness={0.92}
          roughness={0.16}
          clearcoat={0.8}
        />
      </mesh>
      <mesh position={[0, 0, 0.225]}>
        <sphereGeometry args={[radius * 0.07, 28, 18]} />
        <meshPhysicalMaterial
          color={jewelColor}
          emissive="#4b0012"
          emissiveIntensity={0.65}
          metalness={0.08}
          roughness={0.08}
          transmission={0.06}
          clearcoat={1}
        />
      </mesh>
    </group>
  );
}

function BalanceAssembly({ balanceRef }: { balanceRef: React.RefObject<THREE.Group | null> }) {
  const roseGold = useMemo(() => createMetalMaterial("#c18460", 0.16, 0.94), []);
  const steel = useMemo(() => createMetalMaterial("#d3d9da", 0.14, 0.88), []);

  useEffect(() => () => {
    roseGold.dispose();
    steel.dispose();
  }, [roseGold, steel]);

  return (
    <group ref={balanceRef} position={[-2.35, 1.52, 0.62]}>
      <mesh material={roseGold}>
        <torusGeometry args={[1.03, 0.085, 14, 96]} />
      </mesh>
      <mesh material={steel} position={[0, 0, 0.04]}>
        <torusGeometry args={[0.86, 0.022, 8, 80]} />
      </mesh>
      {Array.from({ length: 10 }, (_, index) => {
        const angle = (index / 10) * Math.PI * 2;
        return (
          <group key={angle} rotation={[0, 0, angle]}>
            <mesh material={roseGold} position={[0.55, 0, 0]}>
              <boxGeometry args={[0.92, 0.045, 0.08]} />
            </mesh>
            <mesh material={steel} position={[1.01, 0, 0.025]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.07, 0.07, 0.09, 20]} />
            </mesh>
          </group>
        );
      })}
      {Array.from({ length: 4 }, (_, index) => (
        <mesh key={index} material={roseGold} position={[0, 0, 0.08 + index * 0.012]}>
          <torusGeometry args={[0.18 + index * 0.105, 0.012, 6, 54]} />
        </mesh>
      ))}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.15, 0.15, 0.28, 28]} />
        <meshPhysicalMaterial color="#ead7b5" metalness={0.96} roughness={0.12} clearcoat={1} />
      </mesh>
      <mesh position={[0, 0, 0.19]}>
        <sphereGeometry args={[0.115, 28, 18]} />
        <meshPhysicalMaterial color="#a1082a" emissive="#510014" emissiveIntensity={0.8} roughness={0.06} clearcoat={1} />
      </mesh>
    </group>
  );
}

function RubyJewel({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.18, 0.22, 0.12, 36]} />
        <meshPhysicalMaterial color="#bd8a5e" metalness={0.98} roughness={0.14} clearcoat={0.8} />
      </mesh>
      <mesh position={[0, 0, 0.1]}>
        <sphereGeometry args={[0.125, 32, 20]} />
        <meshPhysicalMaterial
          color="#9b092b"
          emissive="#5b0016"
          emissiveIntensity={0.82}
          roughness={0.06}
          metalness={0.04}
          clearcoat={1}
        />
      </mesh>
    </group>
  );
}

function Screw({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.13, 0.13, 0.11, 28]} />
        <meshPhysicalMaterial color="#dce1e1" metalness={0.98} roughness={0.16} clearcoat={0.9} />
      </mesh>
      <mesh position={[0, 0, 0.065]} rotation={[0, 0, 0.35]}>
        <boxGeometry args={[0.17, 0.024, 0.025]} />
        <meshStandardMaterial color="#4c5355" metalness={0.85} roughness={0.2} />
      </mesh>
    </group>
  );
}

function CameraChoreography({ definitionOpen, reducedMotion }: Full3DWatchCanvasProps) {
  const { camera, invalidate } = useThree();
  const lookTarget = useRef(new THREE.Vector3(0, 0.02, 0));
  const destination = useMemo(() => new THREE.Vector3(), []);
  const targetLook = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    if (!reducedMotion) return;
    camera.position.set(definitionOpen ? 1.25 : 0, definitionOpen ? 0.25 : 0.1, definitionOpen ? 9.3 : 8.7);
    camera.lookAt(definitionOpen ? -0.6 : 0, 0.02, 0);
    invalidate();
  }, [camera, definitionOpen, invalidate, reducedMotion]);

  useFrame((_, delta) => {
    if (reducedMotion) return;
    destination.set(definitionOpen ? 1.25 : 0, definitionOpen ? 0.25 : 0.1, definitionOpen ? 9.3 : 8.7);
    targetLook.set(definitionOpen ? -0.6 : 0, 0.02, 0);
    const factor = 1 - Math.exp(-delta * 3.8);
    camera.position.lerp(destination, factor);
    lookTarget.current.lerp(targetLook, factor);
    camera.lookAt(lookTarget.current);
  });

  return null;
}

function MechanicalMovement({ definitionOpen, reducedMotion }: Full3DWatchCanvasProps) {
  const movementRef = useRef<THREE.Group>(null);
  const driveRef = useRef<THREE.Group>(null);
  const secondRef = useRef<THREE.Group>(null);
  const thirdRef = useRef<THREE.Group>(null);
  const fourthRef = useRef<THREE.Group>(null);
  const fifthRef = useRef<THREE.Group>(null);
  const balanceRef = useRef<THREE.Group>(null);

  useFrame((state, delta) => {
    if (!movementRef.current) return;
    const elapsed = state.clock.getElapsedTime();
    const driveAngle = reducedMotion ? 0.26 : elapsed * 0.2;

    if (driveRef.current) driveRef.current.rotation.z = driveAngle;
    if (secondRef.current) secondRef.current.rotation.z = -(driveAngle * (38 / 26)) + 0.08;
    if (thirdRef.current) thirdRef.current.rotation.z = driveAngle * (38 / 32) + 0.13;
    if (fourthRef.current) fourthRef.current.rotation.z = -(driveAngle * (38 / 20)) + 0.18;
    if (fifthRef.current) fifthRef.current.rotation.z = driveAngle * (38 / 16) + 0.2;
    if (balanceRef.current) {
      balanceRef.current.rotation.z = reducedMotion ? 0.08 : Math.sin(elapsed * Math.PI * 2.35) * 0.3;
    }

    if (reducedMotion) {
      movementRef.current.position.x = definitionOpen ? -0.7 : 0;
      return;
    }
    const factor = 1 - Math.exp(-delta * 4.2);
    movementRef.current.position.x = THREE.MathUtils.lerp(
      movementRef.current.position.x,
      definitionOpen ? -0.7 : 0,
      factor,
    );
  });

  return (
    <group ref={movementRef} rotation={[-0.1, 0.08, -0.065]} scale={0.94}>
      <mesh position={[0, 0, -0.72]}>
        <circleGeometry args={[4.5, 128]} />
        <meshPhysicalMaterial color="#20282b" metalness={0.82} roughness={0.42} clearcoat={0.34} />
      </mesh>
      <mesh position={[0, 0, -0.63]}>
        <ringGeometry args={[3.42, 4.5, 128]} />
        <meshPhysicalMaterial
          color="#a96d4e"
          metalness={0.98}
          roughness={0.18}
          clearcoat={0.88}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh position={[0, 0, -0.55]}>
        <torusGeometry args={[4.42, 0.105, 14, 144]} />
        <meshPhysicalMaterial color="#dfad85" metalness={0.98} roughness={0.12} clearcoat={1} />
      </mesh>
      <mesh position={[0, 0, -0.49]}>
        <ringGeometry args={[2.85, 3.36, 112]} />
        <meshPhysicalMaterial color="#8e999b" metalness={0.94} roughness={0.27} clearcoat={0.7} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0, -0.44]}>
        <torusGeometry args={[2.92, 0.045, 8, 112]} />
        <meshPhysicalMaterial color="#e3e7e6" metalness={0.98} roughness={0.12} clearcoat={0.9} />
      </mesh>

      {Array.from({ length: 30 }, (_, index) => {
        const angle = (index / 30) * Math.PI * 2;
        return (
          <mesh
            key={angle}
            position={[Math.cos(angle) * 4.05, Math.sin(angle) * 4.05, -0.4]}
            rotation={[0, 0, angle]}
          >
            <boxGeometry args={[0.08, 0.28, 0.09]} />
            <meshPhysicalMaterial color={index % 2 ? "#c88b67" : "#edf0ef"} metalness={0.98} roughness={0.16} />
          </mesh>
        );
      })}

      <Gear gearRef={driveRef} position={[-1.58, -0.22, 0.1]} radius={1.48} teeth={38} color="#c8d0d1" />
      <Gear gearRef={secondRef} position={[0.26, 0.78, 0.26]} radius={1.02} teeth={26} color="#bd7e59" roughness={0.16} />
      <Gear gearRef={thirdRef} position={[1.75, -0.36, 0.12]} radius={1.25} teeth={32} color="#aeb9bb" roughness={0.18} />
      <Gear gearRef={fourthRef} position={[0.18, -1.68, 0.38]} radius={0.78} teeth={20} color="#d3d9d9" roughness={0.14} />
      <Gear gearRef={fifthRef} position={[2.22, 1.35, 0.34]} radius={0.64} teeth={16} color="#c58b68" roughness={0.15} />
      <BalanceAssembly balanceRef={balanceRef} />

      <RoundedBox args={[4.15, 0.34, 0.2]} radius={0.1} smoothness={5} position={[0.15, 1.58, 0.58]} rotation={[0, 0, 0.16]}>
        <meshPhysicalMaterial color="#c8d0d0" metalness={0.96} roughness={0.2} clearcoat={0.72} />
      </RoundedBox>
      <RoundedBox args={[3.1, 0.3, 0.2]} radius={0.09} smoothness={5} position={[1.22, -1.48, 0.61]} rotation={[0, 0, -0.42]}>
        <meshPhysicalMaterial color="#b1bbbc" metalness={0.97} roughness={0.18} clearcoat={0.78} />
      </RoundedBox>
      <RoundedBox args={[2.35, 0.28, 0.18]} radius={0.09} smoothness={5} position={[-1.82, -1.62, 0.55]} rotation={[0, 0, 0.54]}>
        <meshPhysicalMaterial color="#cf936d" metalness={0.97} roughness={0.16} clearcoat={0.85} />
      </RoundedBox>
      <RoundedBox args={[1.55, 0.22, 0.18]} radius={0.07} smoothness={4} position={[0.85, 0.1, 0.68]} rotation={[0, 0, 0.8]}>
        <meshPhysicalMaterial color="#e0e4e3" metalness={0.98} roughness={0.13} clearcoat={0.92} />
      </RoundedBox>

      <RubyJewel position={[1.35, 1.43, 0.78]} />
      <RubyJewel position={[-0.3, 1.64, 0.77]} scale={0.84} />
      <RubyJewel position={[-2.58, -0.76, 0.54]} scale={0.88} />
      <RubyJewel position={[2.75, -1.42, 0.32]} scale={0.72} />
      <RubyJewel position={[0.72, -2.44, 0.28]} scale={0.68} />

      {[
        [-3.15, 0.5, 0.06],
        [-1.1, 2.5, 0.18],
        [0.9, 2.4, 0.2],
        [3.1, 0.76, 0.08],
        [3.0, -2.0, -0.04],
        [-1.45, -2.62, 0.04],
        [-3.12, -1.55, -0.06],
      ].map((position, index) => (
        <Screw key={index} position={position as [number, number, number]} scale={index % 2 ? 0.88 : 1} />
      ))}
    </group>
  );
}

function MovementScene(props: Full3DWatchCanvasProps) {
  return (
    <>
      <color attach="background" args={["#101416"]} />
      <fog attach="fog" args={["#101416", 9.5, 16]} />
      <ambientLight intensity={0.58} color="#aab7bb" />
      <hemisphereLight args={["#eefaff", "#321914", 1.05]} />
      <directionalLight position={[-5, 7, 8]} intensity={6.4} color="#f4fbff" />
      <directionalLight position={[5, -1, 6]} intensity={4.1} color="#ffd3ad" />
      <spotLight position={[0, 8, 7]} angle={0.38} penumbra={0.78} intensity={8.2} color="#ffffff" />
      <pointLight position={[-4, -2, 4]} intensity={3.4} color="#b9e2ef" distance={10} />
      <pointLight position={[4, 1, 4]} intensity={3.1} color="#d22547" distance={9} />
      <pointLight position={[0, -4, 3]} intensity={2.4} color="#e8a16f" distance={8} />
      <MechanicalMovement {...props} />
      <CameraChoreography {...props} />
    </>
  );
}

export function Full3DWatchCanvas({ definitionOpen, reducedMotion }: Full3DWatchCanvasProps) {
  const [webGLSupported, setWebGLSupported] = useState<boolean | null>(null);

  useEffect(() => {
    const probeHandle = window.requestAnimationFrame(() => {
      try {
        const probe = document.createElement("canvas");
        const context = probe.getContext("webgl2", { failIfMajorPerformanceCaveat: true })
          ?? probe.getContext("webgl", { failIfMajorPerformanceCaveat: true });
        setWebGLSupported(Boolean(context));
        context?.getExtension("WEBGL_lose_context")?.loseContext();
      } catch {
        setWebGLSupported(false);
      }
    });

    return () => window.cancelAnimationFrame(probeHandle);
  }, []);

  const fallback = <StaticMovementFallback softened={definitionOpen} />;

  return (
    <div
      className={`watch-canvas-shell${definitionOpen ? " is-softened" : ""}`}
      aria-hidden="true"
      data-webgl={webGLSupported === null ? "checking" : webGLSupported ? "enabled" : "fallback"}
    >
      {webGLSupported ? (
        <WebGLBoundary fallback={fallback}>
          <Canvas
            dpr={[1, 1.6]}
            frameloop={reducedMotion ? "demand" : "always"}
            camera={{ position: [0, 0.1, 8.7], fov: 36, near: 0.1, far: 32 }}
            gl={{
              alpha: false,
              antialias: true,
              depth: true,
              stencil: false,
              powerPreference: "high-performance",
            }}
            onCreated={({ gl }) => {
              gl.outputColorSpace = THREE.SRGBColorSpace;
              gl.toneMapping = THREE.ACESFilmicToneMapping;
              gl.toneMappingExposure = 1.32;
            }}
          >
            <MovementScene definitionOpen={definitionOpen} reducedMotion={reducedMotion} />
          </Canvas>
        </WebGLBoundary>
      ) : fallback}
    </div>
  );
}
