import { getCoverUrl } from '../api/music';
import type { Song } from '../types';
import {
  ROOM_VISUAL_MODE_META,
  type RoomVisualFxSettings,
  type RoomVisualMode,
} from '../lib/roomVisualPreset';
import AmbientCoverLayers from './AmbientCoverLayers';
import GalaxyBackground from './galaxy/GalaxyBackground3D';

interface Props {
  song: Pick<Song, 'id' | 'source' | 'pic'> | null | undefined;
  visualMode: RoomVisualMode;
  visualFx: RoomVisualFxSettings;
  isPlaying: boolean;
}

export default function RoomAmbientBackground({
  song,
  visualMode,
  visualFx,
  isPlaying,
}: Props) {
  const coverUrl = song ? getCoverUrl(song, 'medium') : null;
  const meta = ROOM_VISUAL_MODE_META[visualMode];
  const shaderPreset = meta.shaderPreset;
  const showGalaxy = shaderPreset !== undefined;
  const showCoverBg = visualMode === 'cover-bg' && Boolean(coverUrl);

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden>
      {visualMode === 'off' ? (
        <div className="absolute inset-0 bg-[#08090b]" />
      ) : null}
      {showGalaxy ? (
        <GalaxyBackground
          coverUrl={coverUrl}
          preset={shaderPreset}
          fx={visualFx}
          isPlaying={isPlaying}
        />
      ) : null}
      {showCoverBg ? (
        <div className="absolute inset-0">
          <AmbientCoverLayers coverUrl={coverUrl!} />
        </div>
      ) : null}
      {visualMode === 'cover-bg' && !coverUrl ? (
        <div className="absolute inset-0 bg-[#08090b]" />
      ) : null}
    </div>
  );
}
