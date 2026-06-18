import { useEffect, useRef, useState } from 'react';
import { useRoomStore } from '../stores/roomStore';
import { useAudioStore } from '../stores/audioStore';
import { getSharedAudio } from '../lib/audioElement';

/**
 * 歌词/进度条用的高频播放时间。
 * 房主：直接读 audio.currentTime；听众：在服务端 tick 之间线性插值。
 */
export function useSmoothPlaybackTime(): number {
  const roomTime = useRoomStore((s) => s.room?.currentTime ?? 0);
  const isPlaying = useRoomStore((s) => s.room?.isPlaying ?? false);
  const current = useRoomStore((s) => s.room?.current);
  const isOwner = useRoomStore((s) => s.isOwner);
  const trackLoading = useAudioStore((s) => s.trackLoading);

  const [smoothTime, setSmoothTime] = useState(roomTime);
  const anchorRef = useRef({ time: roomTime, at: Date.now() });
  const lastTrackKeyRef = useRef('');

  useEffect(() => {
    const trackKey = current ? `${current.queueId}:${current.id}` : '';
    const trackChanged = trackKey !== lastTrackKeyRef.current;
    lastTrackKeyRef.current = trackKey;

    // 房主播放中：新用户加入会触发 room_update，不要用服务端时间覆盖进度条
    if (isOwner && isPlaying && !trackChanged) return;

    anchorRef.current = { time: roomTime, at: Date.now() };
    setSmoothTime(roomTime);
  }, [roomTime, current?.queueId, current?.id, isOwner, isPlaying]);

  useEffect(() => {
    if (!isPlaying) {
      setSmoothTime(roomTime);
      return;
    }

    let rafId = 0;

    const tick = () => {
      const audio = getSharedAudio();
      const song = useRoomStore.getState().room?.current;
      const owner = useRoomStore.getState().isOwner;
      const loading = useAudioStore.getState().trackLoading;

      if (
        owner
        && !loading
        && song
        && audio.src
        && !audio.paused
        && isFinite(audio.currentTime)
      ) {
        setSmoothTime(audio.currentTime);
      } else {
        const { time, at } = anchorRef.current;
        setSmoothTime(time + (Date.now() - at) / 1000);
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, roomTime, current?.queueId, current?.id, isOwner, trackLoading]);

  return isPlaying ? smoothTime : roomTime;
}
