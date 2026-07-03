import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import type { RoomVisualPresetId } from '../../lib/roomVisualPreset';
import GalaxyBeatMapDriver from './GalaxyBeatMapDriver';
import GalaxyAudioDriver from './GalaxyAudioDriver';
import GalaxyCameraRig from './GalaxyCameraRig';
import GalaxyOrbitControls from './GalaxyOrbitControls';
import GalaxyParticles from './GalaxyParticles';
import GalaxyGestureSceneBridge from './GalaxyGestureSceneBridge';
import GestureHudOverlay from './GestureHudOverlay';
import type { QueueItem } from '../../types';

interface Props {
  className?: string;
  coverUrl?: string | null;
  preset: RoomVisualPresetId;
  isPlaying: boolean;
  song?: Pick<QueueItem, 'queueId' | 'id' | 'source' | 'url'> | null;
  immersivePanelFocus?: 'search' | 'queue' | 'chat' | null;
}

export default function GalaxyBackground3D({
  className = 'absolute inset-0',
  coverUrl,
  preset,
  isPlaying,
  song,
  immersivePanelFocus = null,
}: Props) {
  return (
    <div className={`${className} overflow-hidden bg-[#08090b]`} aria-hidden>
      <GestureHudOverlay />
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
          <GalaxyBeatMapDriver song={song} isPlaying={isPlaying} />
          <GalaxyGestureSceneBridge />
          <GalaxyAudioDriver preset={preset} />
          <GalaxyOrbitControls preset={preset} />
          <GalaxyCameraRig preset={preset} immersivePanelFocus={immersivePanelFocus} />
          <GalaxyParticles coverUrl={coverUrl} preset={preset} isPlaying={isPlaying} />
        </Suspense>
      </Canvas>
    </div>
  );
}
