import * as THREE from 'three';

const GRID = 118;

export function buildGalaxyParticleGeometry(): THREE.BufferGeometry {
  const count = GRID * GRID;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const rand = new Float32Array(count);
  const texelStep = 1 / GRID;

  for (let i = 0; i < count; i++) {
    const gx = i % GRID;
    const gy = Math.floor(i / GRID);
    const u = (gx + 0.5) * texelStep;
    const v = (gy + 0.5) * texelStep;
    const px = gx / (GRID - 1);
    const py = gy / (GRID - 1);
    positions[i * 3] = (px - 0.5) * 4.8;
    positions[i * 3 + 1] = (py - 0.5) * 4.8;
    positions[i * 3 + 2] = 0;
    uvs[i * 2] = u;
    uvs[i * 2 + 1] = v;
    rand[i] = Math.random();
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aUv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));
  return geo;
}
