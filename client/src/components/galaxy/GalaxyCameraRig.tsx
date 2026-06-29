import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { RoomVisualFxSettings, RoomVisualPresetId } from '../../lib/roomVisualPreset';
import { readGalaxyAudioBands, resumeGalaxyAudioContext } from './lib/galaxyAudio';

const BASE_FOV = 45;

const PRESET_CAMERA: Record<RoomVisualPresetId, { radius: number; phi: number; theta: number }> = {
  5: { radius: 9.4, phi: 0.34, theta: -0.52 },
  0: { radius: 6.6, phi: 0.08, theta: 0 },
};

interface Props {
  preset: RoomVisualPresetId;
  fx: RoomVisualFxSettings;
}

export default function GalaxyCameraRig({ preset, fx }: Props) {
  const { camera } = useThree();
  const fovRef = useRef(BASE_FOV);
  const persp = camera as THREE.PerspectiveCamera;

  useFrame((state, delta) => {
    const base = PRESET_CAMERA[preset];
    const t = state.clock.elapsedTime * 0.06;
    let phi = base.phi + Math.sin(t) * 0.018;
    let theta = base.theta + Math.cos(t * 0.72) * 0.022;
    let radius = base.radius;
    let fov = BASE_FOV;

    if (preset === 0) {
      radius = base.radius * fx.cameraDistance;
    }

    if (preset === 5) {
      resumeGalaxyAudioContext();
      const bands = readGalaxyAudioBands();
      const punch = bands.beat * 0.05 + bands.bass * 0.035 + bands.energy * 0.015;
      radius = base.radius - punch * 0.18;
      fov = BASE_FOV - punch * 0.9;
    }

    const cy = Math.cos(phi);
    const sy = Math.sin(phi);
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    camera.position.set(radius * cy * st, radius * sy, radius * cy * ct);
    camera.lookAt(0, 0, 0);

    fovRef.current += (fov - fovRef.current) * Math.min(1, delta * (fov < fovRef.current ? 5 : 2.5));
    if (persp.isPerspectiveCamera) {
      persp.fov = fovRef.current;
      persp.updateProjectionMatrix();
    }
  });

  return null;
}
