import { useFrame, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';

/** Mineradio Preset 5 默认机位：radius 9.4, phi 0.34, theta -0.52 */
function cameraPosition(theta: number, phi: number, radius: number): THREE.Vector3 {
  const cy = Math.cos(phi);
  const sy = Math.sin(phi);
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  return new THREE.Vector3(radius * cy * st, radius * sy, radius * cy * ct);
}

export default function GalaxyCamera() {
  const { camera } = useThree();

  useEffect(() => {
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = 45;
      camera.near = 0.1;
      camera.far = 200;
      camera.updateProjectionMatrix();
    }
    const pos = cameraPosition(-0.52, 0.34, 9.4);
    camera.position.copy(pos);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  useFrame((state) => {
    const t = state.clock.elapsedTime * 0.06;
    const theta = -0.52 + Math.cos(t * 0.7) * 0.04;
    const phi = 0.34 + Math.sin(t) * 0.025;
    camera.position.copy(cameraPosition(theta, phi, 9.4));
    camera.lookAt(0, 0, 0);
  });

  return null;
}
