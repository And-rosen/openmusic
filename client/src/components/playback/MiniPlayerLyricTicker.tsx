import { memo } from 'react';
import type { QueueItem } from '../../types';
import { getActiveLyricPair } from '../../api/music';
import { useSmoothPlaybackTime } from '../../hooks/useSmoothPlaybackTime';
import { useTrackDuration, clampPlaybackTime } from '../../hooks/useTrackDuration';
import { useTrackLyrics } from '../../hooks/useTrackLyrics';

interface Props {
  song: QueueItem;
  onExpand: () => void;
}

function MiniPlayerLyricTicker({ song, onExpand }: Props) {
  const currentTime = useSmoothPlaybackTime();
  const duration = useTrackDuration(song);
  const displayTime = clampPlaybackTime(currentTime, duration);
  const lyrics = useTrackLyrics(song);
  const { current: currentLyric, next: nextLyric } = getActiveLyricPair(lyrics, displayTime);

  return (
    <button
      type="button"
      onClick={onExpand}
      className="flex-1 min-w-0 text-center px-1 sm:px-2"
    >
      {currentLyric || nextLyric ? (
        <>
          <p className="text-xs sm:text-sm font-medium truncate leading-tight">
            {currentLyric || '\u00A0'}
          </p>
          <p className="text-[10px] sm:text-xs text-netease-muted truncate leading-tight mt-0.5">
            {nextLyric || '\u00A0'}
          </p>
        </>
      ) : (
        <>
          <p className="text-xs sm:text-sm font-medium truncate leading-tight">{song.name}</p>
          <p className="text-[10px] sm:text-xs text-netease-muted truncate leading-tight mt-0.5">
            {song.artist}
          </p>
        </>
      )}
    </button>
  );
}

export default memo(MiniPlayerLyricTicker);
