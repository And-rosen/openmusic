import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import type { RoomVisualFxSettings, RoomVisualPresetId } from '../../lib/roomVisualPreset';
import GalaxyCameraRig from './GalaxyCameraRig';
import GalaxyParticles from './GalaxyParticles';

interface Props {
  className?: string;
  coverUrl?: string | null;
  preset: RoomVisualPresetId;
  fx: RoomVisualFxSettings;
  isPlaying: boolean;
}

export default function GalaxyBackground3D({
  className = 'absolute inset-0',
  coverUrl,
  preset,
  fx,
  isPlaying,
}: Props) {
  return (
    <div className={`${className} overflow-hidden bg-[#08090b]`} aria-hidden>
      <Canvas
        className="!absolute inset-0 h-full w-full"
        style={{ width: '100%', height: '100%', display: 'block' }}
        dpr={[1, 1.75]}
        frameloop="always"
        gl={{
          alpha: false,
          antialias: true,
          powerPreference: 'high-performance',
        }}
        camera={{ fov: 45, near: 0.1, far: 200, position: [0, 3.1, 7.7] }}
        onCreated={({ gl, scene, camera }) => {
          gl.setClearColor('#08090b', 1);
          gl.compile(scene, camera);
        }}
      >
        <color attach="background" args={['#08090b']} />
        <Suspense fallback={null}>
          <GalaxyCameraRig preset={preset} fx={fx} />
          <GalaxyParticles coverUrl={coverUrl} preset={preset} fx={fx} isPlaying={isPlaying} />
        </Suspense>
      </Canvas>
    </div>
  );
}
