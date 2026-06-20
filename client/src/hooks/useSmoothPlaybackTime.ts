import { useEffect } from 'react';
import { useRoomStore } from '../stores/roomStore';
import { useAudioStore } from '../stores/audioStore';
import { getSharedAudio } from '../lib/audioElement';
import { resolveDisplayDurationSeconds } from '../hooks/useTrackDuration';
import { getLivePlaybackTime } from '../lib/playbackSync';
import { getTrackKey } from '../api/music';
import type { Song, QueueItem } from '../types';

type TimeCapSong = Pick<Song, 'duration' | 'id' | 'source'> & Partial<Pick<QueueItem, 'queueId'>>;

let rafId = 0;
let loopSubscribers = 0;
const anchor = { time: 0, at: Date.now() };
let lastTrackKey = '';
let lastPublishedTime = 0;

function publishSmoothPlaybackTime(time: number, force = false) {
  if (!force && Math.abs(time - lastPublishedTime) < 0.05) return;
  lastPublishedTime = time;
  useAudioStore.getState().setSmoothPlaybackTime(time);
}

function getSongDisplayDurationSec(song: TimeCapSong | null | undefined): number {
  if (!song) return 0;
  const { lrcDurationMs, lrcTrackKey, mediaDurationMs, mediaTrackKey } = useAudioStore.getState();
  return resolveDisplayDurationSeconds(song, {
    lrcDurationMs,
    lrcTrackKey,
    mediaDurationMs,
    mediaTrackKey,
  });
}

function capSongTime(time: number, song: TimeCapSong | null | undefined): number {
  const dur = getSongDisplayDurationSec(song);
  return dur > 0 ? Math.min(time, dur) : time;
}

function stopLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

function tick() {
  if (loopSubscribers <= 0) {
    stopLoop();
    return;
  }

  const { room } = useRoomStore.getState();
  const isPlaying = room?.isPlaying ?? false;
  const roomTime = room?.currentTime ?? 0;
  const liveRoomTime = isPlaying ? getLivePlaybackTime(roomTime) : roomTime;

  if (!isPlaying) {
    publishSmoothPlaybackTime(capSongTime(liveRoomTime, room?.current ?? null));
    rafId = requestAnimationFrame(tick);
    return;
  }

  const audio = getSharedAudio();
  const song = room?.current;
  const loading = useAudioStore.getState().trackLoading;

  if (loading && isPlaying && song) {
    const t = capSongTime(liveRoomTime, song);
    publishSmoothPlaybackTime(t);
    anchor.time = t;
    anchor.at = Date.now();
    rafId = requestAnimationFrame(tick);
    return;
  }

  if (!loading && song && audio.src && isFinite(audio.currentTime)) {
    const trackKey = getTrackKey(song);
    if (trackKey === lastTrackKey) {
      if (!audio.paused) {
        const t = capSongTime(audio.currentTime, song);
        publishSmoothPlaybackTime(t);
        anchor.time = t;
        anchor.at = Date.now();
        rafId = requestAnimationFrame(tick);
        return;
      }
      if (isPlaying) {
        // 微信等：play 被拦截时仍跟随房间时间推进进度
        const t = capSongTime(liveRoomTime, song);
        publishSmoothPlaybackTime(t);
        anchor.time = t;
        anchor.at = Date.now();
        rafId = requestAnimationFrame(tick);
        return;
      }
    }
  }

  publishSmoothPlaybackTime(capSongTime(anchor.time + (Date.now() - anchor.at) / 1000, song));

  rafId = requestAnimationFrame(tick);
}

function startLoop() {
  if (!rafId) rafId = requestAnimationFrame(tick);
}

/** seek / 切歌时立即对齐进度，避免外层进度条缓慢追赶 */
export function snapSmoothPlaybackTime(time: number) {
  anchor.time = time;
  anchor.at = Date.now();
  publishSmoothPlaybackTime(time, true);
}

/**
 * 歌词/进度条用的高频播放时间（全局单例）。
 * 房主：直接读 audio.currentTime；听众：在服务端 tick 之间线性插值。
 */
export function useSmoothPlaybackTime(): number {
  const roomTime = useRoomStore((s) => s.room?.currentTime ?? 0);
  const isPlaying = useRoomStore((s) => s.room?.isPlaying ?? false);
  const current = useRoomStore((s) => s.room?.current);
  const isOwner = useRoomStore((s) => s.isOwner);
  const trackLoading = useAudioStore((s) => s.trackLoading);
  const smoothTime = useAudioStore((s) => s.smoothPlaybackTime);

  useEffect(() => {
    const trackKey = current ? getTrackKey(current) : '';
    const trackChanged = trackKey !== lastTrackKey;
    lastTrackKey = trackKey;

    if (trackChanged) {
      snapSmoothPlaybackTime(isPlaying ? getLivePlaybackTime(roomTime) : roomTime);
      return;
    }

    // 本地音频播放中：不用服务端时间覆盖进度条（房主 + 听众均适用）
    const audio = getSharedAudio();
    if (isPlaying && audio.src && !audio.paused && isFinite(audio.currentTime)) return;

    const live = isPlaying ? getLivePlaybackTime(roomTime) : roomTime;
    anchor.time = live;
    anchor.at = Date.now();
      publishSmoothPlaybackTime(capSongTime(live, current), true);
  }, [roomTime, current?.queueId, current?.id, isOwner, isPlaying]);

  useEffect(() => {
    if (!isPlaying) {
      publishSmoothPlaybackTime(roomTime, true);
      return;
    }

    loopSubscribers += 1;
    startLoop();

    return () => {
      loopSubscribers -= 1;
      if (loopSubscribers <= 0) stopLoop();
    };
  }, [isPlaying, current?.queueId, current?.id, isOwner, trackLoading]);

  return isPlaying ? smoothTime : roomTime;
}
