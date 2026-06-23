import { useEffect } from 'react';

import { useRoomStore } from '../stores/roomStore';
import { useAudioStore } from '../stores/audioStore';
import { resolveDisplayDurationSeconds } from '../hooks/useTrackDuration';
import { getClientPlaybackState, getPlaybackTime } from '../lib/playbackState';
import type { Song, QueueItem } from '../types';

type TimeCapSong = Pick<Song, 'duration' | 'id' | 'source'> & Partial<Pick<QueueItem, 'queueId'>>;

let rafId = 0;
let loopSubscribers = 0;
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

function stateMatchesSong(song: TimeCapSong | null | undefined): boolean {
  const state = getClientPlaybackState();
  if (!state?.trackId || !song?.queueId) return true;
  return state.trackId === song.queueId;
}

function publishStateTimeForSong(song: TimeCapSong | null | undefined, force = false) {
  if (!stateMatchesSong(song)) return;
  publishSmoothPlaybackTime(capSongTime(getPlaybackTime(getClientPlaybackState()), song), force);
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
  publishStateTimeForSong(room?.current ?? null);
  rafId = requestAnimationFrame(tick);
}

function startLoop() {
  if (!rafId) rafId = requestAnimationFrame(tick);
}

/** seek / 切歌时立即对齐进度 */
export function snapSmoothPlaybackTime(time: number) {
  publishSmoothPlaybackTime(time, true);
}

/**
 * 歌词/进度条用的高频播放时间（全局单例 RAF）。
 * 唯一时间源：服务端 PlaybackState 外推。
 */
export function useSmoothPlaybackTime(): number {
  const isPlaying = useRoomStore((s) => s.room?.isPlaying ?? false);
  const current = useRoomStore((s) => s.room?.current);
  const playbackVersion = useAudioStore((s) => s.playbackVersion);
  const smoothTime = useAudioStore((s) => s.smoothPlaybackTime);

  useEffect(() => {
    const trackKey = current ? `${current.source}:${current.id}:${current.queueId}` : '';
    const trackChanged = trackKey !== lastTrackKey;
    lastTrackKey = trackKey;

    if (trackChanged) {
      snapSmoothPlaybackTime(0);
      return;
    }

    publishStateTimeForSong(current ?? null, true);
  }, [playbackVersion, current?.queueId, current?.id, current?.source, isPlaying]);

  useEffect(() => {
    if (!isPlaying) {
      publishStateTimeForSong(current ?? null, true);
      return;
    }

    loopSubscribers += 1;
    startLoop();

    return () => {
      loopSubscribers -= 1;
      if (loopSubscribers <= 0) stopLoop();
    };
  }, [isPlaying, current?.queueId, current?.id, current?.source, playbackVersion]);

  if (!isPlaying) {
    if (!stateMatchesSong(current ?? null)) return smoothTime;
    return capSongTime(getPlaybackTime(getClientPlaybackState()), current ?? null);
  }
  return smoothTime;
}