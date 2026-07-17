import { useEffect, useRef } from 'react';
import { useRoomStore } from '../stores/roomStore';
import { useAudioStore } from '../stores/audioStore';
import {
  resolveDisplayDurationSeconds,
} from './useTrackDuration';
import {
  bindMediaSessionActions,
  clearMediaSession,
  isMediaSessionSupported,
  updateMediaSessionMetadata,
  updateMediaSessionPlaybackState,
  updateMediaSessionPositionState,
} from '../lib/mediaSession';
import {
  installBackgroundPlaybackGuards,
  isLikelySystemMediaSuspend,
} from '../lib/backgroundPlayback';

const SEEK_STEP_SEC = 10;
const POSITION_UPDATE_MS = 1000;

type MediaSessionControls = {
  /** false 时禁用（如 TV 投屏页不占用系统媒体会话） */
  enabled?: boolean;
  togglePlay: (isPlaying: boolean) => void | Promise<boolean>;
  skipSong: () => Promise<{ success: boolean; error?: string }>;
  requestSkip: () => Promise<{ success: boolean; error?: string }>;
  seekTo: (time: number) => void;
};

/**
 * 将房间播放/暂停/切歌同步到系统媒体控件（锁屏、通知栏、耳机键、键盘多媒体键）。
 * 有控制权时与页面按钮一致；无控制权时切歌改为提交申请。
 * 房间可关闭系统播放/切歌绑定，防止摘耳机等误触。
 * 无播放控制权的用户通过系统暂停不会改动房间播放状态。
 */
export function useMediaSession({
  enabled = true,
  togglePlay,
  skipSong,
  requestSkip,
  seekTo,
}: MediaSessionControls): void {
  const controlsRef = useRef({ togglePlay, skipSong, requestSkip, seekTo });
  controlsRef.current = { togglePlay, skipSong, requestSkip, seekTo };

  useEffect(() => {
    if (!enabled || !isMediaSessionSupported()) {
      clearMediaSession();
      return;
    }

    installBackgroundPlaybackGuards();

    const syncHandlers = () => {
      const state = useRoomStore.getState();
      const canControl = state.canControlPlayback;
      const hasTrack = Boolean(state.room?.current);
      const playBound = state.room?.systemMediaPlayBound !== false;
      const skipBound = state.room?.systemMediaSkipBound !== false;

      bindMediaSessionActions({
        play: hasTrack && playBound
          ? () => {
              const { room } = useRoomStore.getState();
              if (!room?.current) return;
              const { localPlayback } = useAudioStore.getState();
              if (canControl) {
                if (!room.isPlaying) {
                  updateMediaSessionPlaybackState('playing');
                  void controlsRef.current.togglePlay(true);
                  localPlayback?.(true);
                } else {
                  localPlayback?.(true);
                }
                return;
              }
              // 无控制权：跟随房间，尝试恢复本机播放
              localPlayback?.(true);
            }
          : undefined,
        pause: hasTrack && playBound
          ? () => {
              const { room, canControlPlayback } = useRoomStore.getState();
              if (!room?.current) return;
              const { localPlayback } = useAudioStore.getState();

              // 息屏瞬间系统常会误发 pause；短窗口内忽略，避免整房被停
              if (isLikelySystemMediaSuspend() && room.isPlaying) {
                updateMediaSessionPlaybackState('playing');
                localPlayback?.(true);
                return;
              }

              if (canControlPlayback) {
                updateMediaSessionPlaybackState('paused');
                localPlayback?.(false);
                void controlsRef.current.togglePlay(false);
                return;
              }
              // 无控制权不能改房间状态：本地被系统暂停后立刻跟播恢复
              if (room.isPlaying) {
                localPlayback?.(true);
              }
            }
          : undefined,
        nexttrack: hasTrack && skipBound
          ? () => {
              const can = useRoomStore.getState().canControlPlayback;
              if (can) {
                useAudioStore.getState().setTrackLoading(true);
                void controlsRef.current.skipSong().then((res) => {
                  if (!res.success) useAudioStore.getState().setTrackLoading(false);
                });
                return;
              }
              void controlsRef.current.requestSkip();
            }
          : undefined,
        seekbackward: hasTrack
          ? (canControl
            ? (details) => {
              const step = Number(details.seekOffset) > 0 ? Number(details.seekOffset) : SEEK_STEP_SEC;
              const time = useAudioStore.getState().smoothPlaybackTime;
              controlsRef.current.seekTo(Math.max(0, time - step));
            }
            : () => { syncPosition(); })
          : undefined,
        seekforward: hasTrack
          ? (canControl
            ? (details) => {
              const step = Number(details.seekOffset) > 0 ? Number(details.seekOffset) : SEEK_STEP_SEC;
              const time = useAudioStore.getState().smoothPlaybackTime;
              controlsRef.current.seekTo(time + step);
            }
            : () => { syncPosition(); })
          : undefined,
        seekto: hasTrack
          ? (canControl
            ? (details) => {
              if (typeof details.seekTime !== 'number' || !Number.isFinite(details.seekTime)) return;
              controlsRef.current.seekTo(Math.max(0, details.seekTime));
            }
            : () => { syncPosition(); })
          : undefined,
        stop: hasTrack && canControl && playBound
          ? () => {
              if (isLikelySystemMediaSuspend() && useRoomStore.getState().room?.isPlaying) {
                updateMediaSessionPlaybackState('playing');
                useAudioStore.getState().localPlayback?.(true);
                return;
              }
              useAudioStore.getState().localPlayback?.(false);
              void controlsRef.current.togglePlay(false);
            }
          : undefined,
      });
    };

    const syncMetadataAndState = () => {
      const room = useRoomStore.getState().room;
      const current = room?.current ?? null;
      updateMediaSessionMetadata(current);
      if (!current) {
        updateMediaSessionPlaybackState('none');
        return;
      }
      updateMediaSessionPlaybackState(room?.isPlaying ? 'playing' : 'paused');
    };

    const syncPosition = () => {
      const room = useRoomStore.getState().room;
      const current = room?.current;
      if (!current) return;

      const { smoothPlaybackTime, mediaDurationMs, mediaTrackKey, lrcDurationMs, lrcTrackKey } = useAudioStore.getState();
      const duration = resolveDisplayDurationSeconds(current, {
        lrcDurationMs,
        lrcTrackKey,
        mediaDurationMs,
        mediaTrackKey,
      });
      if (!(duration > 0)) return;

      updateMediaSessionPositionState({
        duration,
        position: Math.min(Math.max(0, smoothPlaybackTime), duration),
        playbackRate: 1,
      });
    };

    syncHandlers();
    syncMetadataAndState();
    syncPosition();

    const unsubRoom = useRoomStore.subscribe((state, prev) => {
      if (
        state.room?.current?.queueId !== prev.room?.current?.queueId
        || state.room?.current?.name !== prev.room?.current?.name
        || state.room?.current?.artist !== prev.room?.current?.artist
        || state.room?.current?.pic !== prev.room?.current?.pic
        || state.room?.isPlaying !== prev.room?.isPlaying
        || state.canControlPlayback !== prev.canControlPlayback
        || state.room?.systemMediaPlayBound !== prev.room?.systemMediaPlayBound
        || state.room?.systemMediaSkipBound !== prev.room?.systemMediaSkipBound
        || Boolean(state.room?.current) !== Boolean(prev.room?.current)
      ) {
        syncHandlers();
        syncMetadataAndState();
        syncPosition();
      }
    });

    const unsubAudio = useAudioStore.subscribe((state, prev) => {
      if (
        state.smoothPlaybackTime !== prev.smoothPlaybackTime
        || state.mediaDurationMs !== prev.mediaDurationMs
        || state.lrcDurationMs !== prev.lrcDurationMs
      ) {
        // throttle via interval below; only force on duration change
        if (
          state.mediaDurationMs !== prev.mediaDurationMs
          || state.lrcDurationMs !== prev.lrcDurationMs
        ) {
          syncPosition();
        }
      }
    });

    const timer = window.setInterval(syncPosition, POSITION_UPDATE_MS);

    return () => {
      unsubRoom();
      unsubAudio();
      window.clearInterval(timer);
      clearMediaSession();
    };
  }, [enabled]);
}
