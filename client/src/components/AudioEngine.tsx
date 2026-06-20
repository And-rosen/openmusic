import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { usePrefetchTrackDuration } from '../hooks/usePrefetchTrackDuration';
import AudioUnlockOverlay from './AudioUnlockOverlay';

interface Props {
  tvMode?: boolean;
}

export default function AudioEngine({ tvMode = false }: Props) {
  useAudioPlayer({ tvMode });
  usePrefetchTrackDuration();
  return <AudioUnlockOverlay tvMode={tvMode} />;
}
