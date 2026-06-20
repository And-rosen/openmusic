import { useEffect, useRef, useCallback, type MutableRefObject } from 'react';
import { useRoomStore } from '../stores/roomStore';
import { useAudioStore } from '../stores/audioStore';
import { useSocket } from '../hooks/useSocket';
import { getTrackKey } from '../api/music';
import { snapSmoothPlaybackTime } from '../hooks/useSmoothPlaybackTime';
import { resolveAutoSkipThresholdSeconds, resolveDisplayDurationSeconds } from '../hooks/useTrackDuration';
import type { QueueItem } from '../types';
import { getSharedAudio } from '../lib/audioElement';
import { onWeChatBridgeReady, playInUserGesture, tryPlayWithAutoplayFallback, assessPlaybackResult, playbackNeedsUnlock, isAudioSessionUnlocked, markAudioSessionUnlocked, resetAudioSessionUnlocked, shouldShowUnlockOverlay, isMobileDevice, isRestrictedAutoplayEnv, type PlayResult } from '../lib/audioUnlock';
import { prefetchQueueSongs, rememberSongUrl, resolveSongUrl } from '../lib/songPreloadCache';
import { getLivePlaybackTime, waitForAudioMinimumReady } from '../lib/playbackSync';

let audioListenersAttached = false;

interface AudioRuntime {
  audioRef: MutableRefObject<HTMLAudioElement | null>;
  readyTrackKey: MutableRefObject<string | null>;
  lastTrackKey: MutableRefObject<string | null>;
  skippingRef: MutableRefObject<boolean>;
  syncing: MutableRefObject<boolean>;
  errorRetries: MutableRefObject<number>;
  lastSyncAt: MutableRefObject<number>;
  requestSkip: () => void;
  finishSong: (queueId: string) => void;
  syncTime: (time: number) => void;
}

let activeAudioRuntime: AudioRuntime | null = null;

const OWNER_SYNC_INTERVAL_MS = isMobileDevice() ? 5000 : 2000;
const LISTENER_DRIFT_SEC = isMobileDevice() ? 1.25 : 0.35;
const LISTENER_SEEK_COOLDOWN_MS = isMobileDevice() ? 4000 : 1500;
const UNLOCK_POLL_MS = isMobileDevice() ? 350 : 800;

function trackKeyOf(song: Pick<QueueItem, 'queueId' | 'id' | 'source'>) {
  return getTrackKey(song);
}

function getAutoSkipThresholdSec(song: QueueItem, audio: HTMLAudioElement): number {
  const { lrcDurationMs, lrcTrackKey, mediaDurationMs, mediaTrackKey } = useAudioStore.getState();
  const sources = { lrcDurationMs, lrcTrackKey, mediaDurationMs, mediaTrackKey };
  const fileDur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
  const displayDur = resolveDisplayDurationSeconds(song, sources);
  if (displayDur > 0) return displayDur;
  return resolveAutoSkipThresholdSeconds(song, sources, fileDur);
}

function capSeekTime(time: number, song: QueueItem | null | undefined, mediaDur: number): number {
  const fileDur = isFinite(mediaDur) && mediaDur > 0 ? mediaDur : 0;
  const { lrcDurationMs, lrcTrackKey, mediaDurationMs, mediaTrackKey } = useAudioStore.getState();
  const capBase = song
    ? resolveAutoSkipThresholdSeconds(song, { lrcDurationMs, lrcTrackKey, mediaDurationMs, mediaTrackKey }, fileDur)
    : fileDur;
  const cap = capBase > 0
    ? capBase - 0.25
    : (fileDur > 0 ? fileDur - 0.25 : time);
  return Math.max(0, Math.min(time, cap));
}

function syncMediaDuration(audio: HTMLAudioElement, trackKey: string) {
  const dur = audio.duration;
  if (!isFinite(dur) || dur <= 0) return;
  useAudioStore.getState().setMediaDuration(trackKey, Math.round(dur * 1000));
}

function seekAudioToRoomTime(
  audio: HTMLAudioElement,
  song: QueueItem,
  isPlaybackDriver: boolean,
  options: { forceZero?: boolean; fallbackTime?: number } = {},
) {
  const { forceZero = false, fallbackTime = 0 } = options;
  const liveTime = forceZero && isPlaybackDriver
    ? 0
    : Math.max(0, getLivePlaybackTime(fallbackTime));
  const target = capSeekTime(liveTime, song, audio.duration);
  audio.currentTime = target;
  snapSmoothPlaybackTime(target);
  return target;
}

interface UseAudioPlayerOptions {
  tvMode?: boolean;
}

export function useAudioPlayer(options: UseAudioPlayerOptions = {}) {
  const tvMode = options.tvMode ?? false;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const room = useRoomStore((s) => s.room);
  const isOwner = useRoomStore((s) => s.isOwner);
  const setTrackLoading = useAudioStore((s) => s.setTrackLoading);
  const setLrcDuration = useAudioStore((s) => s.setLrcDuration);
  const setMediaDuration = useAudioStore((s) => s.setMediaDuration);
  const setSeekPlayback = useAudioStore((s) => s.setSeekPlayback);
  const setNeedsAudioUnlock = useAudioStore((s) => s.setNeedsAudioUnlock);
  const needsAudioUnlock = useAudioStore((s) => s.needsAudioUnlock);
  const setRetryPlayback = useAudioStore((s) => s.setRetryPlayback);
  const { togglePlay, seek, skipSong, finishSong, syncTime } = useSocket();

  const lastTrackKey = useRef<string | null>(null);
  const readyTrackKey = useRef<string | null>(null);
  const loadGeneration = useRef(0);
  const skippingRef = useRef(false);
  const justSkippedRef = useRef(false);
  const prevQueueIdRef = useRef<string | null>(null);
  const syncing = useRef(false);
  const errorRetries = useRef(0);
  const lastSyncAt = useRef(0);
  const lastListenerSeekAt = useRef(0);

  const playAudio = useCallback(async (audio: HTMLAudioElement) => {
    const result = await tryPlayWithAutoplayFallback(audio, tvMode);
    return assessPlaybackResult(audio, result);
  }, [tvMode]);

  const applyPlaybackResult = useCallback((result: PlayResult, audio: HTMLAudioElement, liveRoom: NonNullable<typeof room>) => {
    const latestRoom = useRoomStore.getState().room;
    if (
      !latestRoom?.current
      || !liveRoom.current
      || trackKeyOf(latestRoom.current) !== trackKeyOf(liveRoom.current)
    ) {
      return;
    }

    if (playbackNeedsUnlock(result, audio)) {
      if (useRoomStore.getState().isOwner && latestRoom.isPlaying && isFinite(audio.currentTime)) {
        syncTime(Math.max(0, audio.currentTime));
        lastSyncAt.current = Date.now();
      }
      const stillLoading = useAudioStore.getState().trackLoading;
      if (!stillLoading && (skippingRef.current || syncing.current)) return;
      if (stillLoading && !isRestrictedAutoplayEnv()) return;
      if (stillLoading && !audio.src) return;

      if (isAudioSessionUnlocked()) {
        void audio.play().then(() => {
          if (audio.paused) {
            resetAudioSessionUnlocked();
            if (shouldShowUnlockOverlay()) {
              useAudioStore.getState().setNeedsAudioUnlock(true);
            }
          }
        }).catch(() => {
          resetAudioSessionUnlocked();
          useAudioStore.getState().setNeedsAudioUnlock(true);
        });
        return;
      }
      if (shouldShowUnlockOverlay()) {
        setNeedsAudioUnlock(true);
      }
      return;
    }
    setNeedsAudioUnlock(false);
    if (useRoomStore.getState().isOwner && latestRoom.isPlaying) {
      syncTime(audio.currentTime);
      lastSyncAt.current = Date.now();
    }
  }, [syncTime, setNeedsAudioUnlock]);

  const requestUnlockIfPaused = useCallback((audio: HTMLAudioElement) => {
    const liveRoom = useRoomStore.getState().room;
    if (!liveRoom?.current || !liveRoom.isPlaying || !audio.paused || !audio.src) return;
    if (readyTrackKey.current !== trackKeyOf(liveRoom.current)) return;

    if (isAudioSessionUnlocked()) {
      void audio.play().then(() => {
        if (audio.paused) {
          resetAudioSessionUnlocked();
          setNeedsAudioUnlock(true);
        }
      }).catch(() => {
        resetAudioSessionUnlocked();
        setNeedsAudioUnlock(true);
      });
      return;
    }
    if (shouldShowUnlockOverlay()) {
      setNeedsAudioUnlock(true);
    }
  }, [setNeedsAudioUnlock]);

  const requestSkip = useCallback(() => {
    if (skippingRef.current) return;
    const { isOwner, room: live } = useRoomStore.getState();
    if (!isOwner) return;

    skippingRef.current = true;
    justSkippedRef.current = true;
    readyTrackKey.current = null;
    useAudioStore.getState().setNeedsAudioUnlock(false);
    audioRef.current?.pause();
    snapSmoothPlaybackTime(0);
    if (live) {
      useRoomStore.getState().setRoom({ ...live, currentTime: 0 });
    }
    skipSong().finally(() => {
      skippingRef.current = false;
    });
  }, [skipSong]);

  const initAudio = useCallback(() => {
    const audio = getSharedAudio();
    audioRef.current = audio;
    activeAudioRuntime = {
      audioRef,
      readyTrackKey,
      lastTrackKey,
      skippingRef,
      syncing,
      errorRetries,
      lastSyncAt,
      requestSkip,
      finishSong,
      syncTime,
    };

    if (!audioListenersAttached) {
      audioListenersAttached = true;

      audio.addEventListener('ended', () => {
        const runtime = activeAudioRuntime;
        if (!runtime) return;
        const live = useRoomStore.getState();
        if (!live.isOwner || !live.room?.current) return;
        if (runtime.readyTrackKey.current !== trackKeyOf(live.room.current)) return;
        runtime.finishSong(live.room.current.queueId);
      });

      audio.addEventListener('error', () => {
        const runtime = activeAudioRuntime;
        if (!runtime) return;
        const live = useRoomStore.getState();
        if (!live.isOwner || !live.room?.current || runtime.skippingRef.current) return;
        if (runtime.readyTrackKey.current !== trackKeyOf(live.room.current)) return;

        if (runtime.errorRetries.current < 2) {
          runtime.errorRetries.current += 1;
          audio.load();
          audio.play().catch(() => {});
          return;
        }
        runtime.requestSkip();
      });

      audio.addEventListener('playing', () => {
        const runtime = activeAudioRuntime;
        if (runtime) runtime.errorRetries.current = 0;
        markAudioSessionUnlocked();
        useAudioStore.getState().setNeedsAudioUnlock(false);
        const live = useRoomStore.getState().room;
        if (live?.queue.length) prefetchQueueSongs(live.queue);
      });

      audio.addEventListener('loadedmetadata', () => {
        const runtime = activeAudioRuntime;
        if (!runtime) return;
        const live = useRoomStore.getState().room?.current;
        if (!live || runtime.lastTrackKey.current !== trackKeyOf(live)) return;
        syncMediaDuration(audio, runtime.lastTrackKey.current);
      });

      audio.addEventListener('loadeddata', () => {
        const runtime = activeAudioRuntime;
        if (!runtime) return;
        const live = useRoomStore.getState().room?.current;
        if (!live || runtime.lastTrackKey.current !== trackKeyOf(live)) return;
        syncMediaDuration(audio, runtime.lastTrackKey.current);
      });

      audio.addEventListener('durationchange', () => {
        const runtime = activeAudioRuntime;
        if (!runtime) return;
        const live = useRoomStore.getState().room?.current;
        if (!live || runtime.lastTrackKey.current !== trackKeyOf(live)) return;
        syncMediaDuration(audio, runtime.lastTrackKey.current);
      });

      audio.addEventListener('timeupdate', () => {
        const runtime = activeAudioRuntime;
        const currentAudio = runtime?.audioRef.current;
        if (!runtime || runtime.syncing.current || runtime.skippingRef.current || !currentAudio) return;
        const { isOwner, room: liveRoom } = useRoomStore.getState();
        if (!isOwner || !liveRoom?.isPlaying || !liveRoom.current) return;
        if (useAudioStore.getState().trackLoading) return;
        if (runtime.readyTrackKey.current !== trackKeyOf(liveRoom.current)) return;

        const now = Date.now();
        if (now - runtime.lastSyncAt.current < OWNER_SYNC_INTERVAL_MS) return;
        runtime.lastSyncAt.current = now;
        const capDur = getAutoSkipThresholdSec(liveRoom.current, currentAudio);
        const syncAt = capDur > 0
          ? Math.min(currentAudio.currentTime, capDur)
          : currentAudio.currentTime;
        runtime.syncTime(syncAt);
      });
    }

    return audio;
  }, [requestSkip, finishSong, syncTime]);

  const retryPlayback = useCallback(async (fromUserGesture = false) => {
    const audio = audioRef.current;
    const liveRoom = useRoomStore.getState().room;
    if (!audio || !liveRoom?.current) return;

    const trackKey = trackKeyOf(liveRoom.current);

    if (!liveRoom.isPlaying && !fromUserGesture) {
      setNeedsAudioUnlock(false);
      return;
    }

    if (fromUserGesture) {
      markAudioSessionUnlocked();
      setNeedsAudioUnlock(false);
      if (audio.src) playInUserGesture(audio);
    }

    if (readyTrackKey.current !== trackKey) {
      return;
    }

    if (!useRoomStore.getState().isOwner && liveRoom.isPlaying) {
      await waitForAudioMinimumReady(audio);
      seekAudioToRoomTime(audio, liveRoom.current, false, { fallbackTime: liveRoom.currentTime ?? 0 });
    }

    const result = await playAudio(audio);
    applyPlaybackResult(result, audio, liveRoom);
  }, [playAudio, applyPlaybackResult, setNeedsAudioUnlock]);

  useEffect(() => {
    const gen = ++loadGeneration.current;
    const audio = initAudio();
    const current = room?.current;

    if (!current) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      lastTrackKey.current = null;
      readyTrackKey.current = null;
      prevQueueIdRef.current = null;
      errorRetries.current = 0;
      setTrackLoading(false);
      setLrcDuration(null, null);
      setMediaDuration(null, null);
      return;
    }

    const trackKey = trackKeyOf(current);
    const isPlaybackDriver = isOwner;

    if (prevQueueIdRef.current && prevQueueIdRef.current !== current.queueId) {
      justSkippedRef.current = true;
      snapSmoothPlaybackTime(0);
      if (isPlaybackDriver) {
        syncTime(0);
        lastSyncAt.current = Date.now();
        const live = useRoomStore.getState().room;
        if (live) {
          useRoomStore.getState().setRoom({ ...live, currentTime: 0 });
        }
      }
    }
    prevQueueIdRef.current = current.queueId;

    const needsLoad = readyTrackKey.current !== trackKey;

    const loadAndPlay = async () => {
      try {
        if (needsLoad) {
          audio.pause();
          audio.currentTime = 0;
          snapSmoothPlaybackTime(0);
          readyTrackKey.current = null;
          errorRetries.current = 0;
          lastTrackKey.current = trackKey;
          setTrackLoading(true);
          setNeedsAudioUnlock(false);
          setLrcDuration(null, null);
          setMediaDuration(null, null);

          try {
            const url = await resolveSongUrl(current);
            if (gen !== loadGeneration.current) return;

            audio.pause();
            audio.src = url;
            await audio.load();
            if (gen !== loadGeneration.current) return;

            await waitForAudioMinimumReady(audio);
            if (gen !== loadGeneration.current) return;

            rememberSongUrl(trackKey, url);
            syncMediaDuration(audio, trackKey);
            readyTrackKey.current = trackKey;

            const liveAfterLoad = useRoomStore.getState().room;
            if (
              isRestrictedAutoplayEnv()
              && liveAfterLoad?.isPlaying
              && liveAfterLoad.current
              && trackKeyOf(liveAfterLoad.current) === trackKey
            ) {
              const probe = await playAudio(audio);
              if (playbackNeedsUnlock(probe, audio)) {
                setTrackLoading(false);
                applyPlaybackResult(probe, audio, liveAfterLoad);
              }
            }

            const liveQueue = useRoomStore.getState().room?.queue;
            if (liveQueue?.length) prefetchQueueSongs(liveQueue);
          } catch (err) {
            console.error('Failed to load song:', err);
            if (gen !== loadGeneration.current) return;
            readyTrackKey.current = null;
            if (isPlaybackDriver) {
              requestSkip();
            }
            return;
          }
        }

        if (gen !== loadGeneration.current) return;
        if (readyTrackKey.current !== trackKey) return;

        const liveRoom = useRoomStore.getState().room;
        if (!liveRoom?.current || trackKeyOf(liveRoom.current) !== trackKey) return;

        syncing.current = true;
        const forceZero = isPlaybackDriver && justSkippedRef.current;
        justSkippedRef.current = false;
        seekAudioToRoomTime(audio, liveRoom.current, isPlaybackDriver, {
          forceZero,
          fallbackTime: liveRoom.currentTime ?? 0,
        });

        if (liveRoom.isPlaying) {
          const result = await playAudio(audio);
          applyPlaybackResult(result, audio, liveRoom);
        } else {
          audio.pause();
        }

        setTimeout(() => { syncing.current = false; }, 300);
      } finally {
        if (gen === loadGeneration.current) {
          setTrackLoading(false);
          const live = useRoomStore.getState().room;
          if (
            live?.isPlaying
            && live.current
            && trackKeyOf(live.current) === trackKey
            && readyTrackKey.current === trackKey
            && audio.paused
          ) {
            requestUnlockIfPaused(audio);
          }
        }
      }
    };

    loadAndPlay();
  }, [
    room?.current?.id,
    room?.current?.queueId,
    room?.current?.source,
    isOwner,
    tvMode,
    initAudio,
    requestSkip,
    syncTime,
    setTrackLoading,
    setLrcDuration,
    setMediaDuration,
    setNeedsAudioUnlock,
    playAudio,
    applyPlaybackResult,
    requestUnlockIfPaused,
  ]);

  useEffect(() => {
    const audio = audioRef.current;
    const current = room?.current;
    if (!audio || !current) return;

    const trackKey = trackKeyOf(current);
    if (readyTrackKey.current !== trackKey) return;

    if (room.isPlaying && audio.paused) {
      if (!useRoomStore.getState().isOwner) {
        seekAudioToRoomTime(audio, current, false, { fallbackTime: room.currentTime ?? 0 });
      }
      playAudio(audio).then((result) => {
        applyPlaybackResult(result, audio, room);
      });
    } else if (!room.isPlaying && !audio.paused) {
      audio.pause();
    }
  }, [room?.isPlaying, room?.current?.queueId, room?.current?.id, room?.current?.source, playAudio, applyPlaybackResult]);

  // 听众：跟随房主 seek / 进度校正
  useEffect(() => {
    if (isOwner || tvMode) return;
    const audio = audioRef.current;
    const current = room?.current;
    if (!audio || !current || !room?.isPlaying) return;

    const trackKey = trackKeyOf(current);
    if (readyTrackKey.current !== trackKey) return;
    if (useAudioStore.getState().trackLoading || syncing.current) return;

    const liveTime = getLivePlaybackTime(room.currentTime);
    const drift = Math.abs(audio.currentTime - liveTime);
    if (drift > LISTENER_DRIFT_SEC) {
      const now = Date.now();
      if (now - lastListenerSeekAt.current < LISTENER_SEEK_COOLDOWN_MS) return;
      lastListenerSeekAt.current = now;
      syncing.current = true;
      const target = capSeekTime(liveTime, current, audio.duration);
      audio.currentTime = target;
      snapSmoothPlaybackTime(target);
      window.setTimeout(() => { syncing.current = false; }, 300);
    }
  }, [room?.currentTime, room?.isPlaying, room?.current?.queueId, room?.current?.id, isOwner, tvMode]);

  const handlePlayPause = useCallback(() => {
    if (!room) return;
    togglePlay(!room.isPlaying);
  }, [room, togglePlay]);

  const handleSeek = useCallback((time: number) => {
    const live = useRoomStore.getState().room;
    const current = live?.current ?? null;
    seek(time);
    if (audioRef.current && readyTrackKey.current) {
      syncing.current = true;
      const dur = audioRef.current.duration;
      const target = capSeekTime(time, current, dur);
      audioRef.current.currentTime = target;
      snapSmoothPlaybackTime(target);
      if (live) {
        useRoomStore.getState().setRoom({ ...live, currentTime: target });
      }
      syncTime(target);
      lastSyncAt.current = Date.now();
      setTimeout(() => { syncing.current = false; }, 300);
    }
  }, [seek, syncTime]);

  useEffect(() => {
    setSeekPlayback(handleSeek);
    return () => setSeekPlayback(null);
  }, [handleSeek, setSeekPlayback]);

  useEffect(() => {
    setRetryPlayback(retryPlayback);
    return () => setRetryPlayback(null);
  }, [retryPlayback, setRetryPlayback]);

  useEffect(() => {
    onWeChatBridgeReady(() => {
      const audio = audioRef.current;
      const liveRoom = useRoomStore.getState().room;
      if (!audio?.src || !liveRoom?.current || !liveRoom.isPlaying) return;
      if (useAudioStore.getState().trackLoading || skippingRef.current) return;
      void audio.play().then(() => {
        if (audio.paused) {
          if (isAudioSessionUnlocked()) {
            void audio.play().catch(() => {});
          } else if (shouldShowUnlockOverlay()) {
            setNeedsAudioUnlock(true);
          }
        } else {
          setNeedsAudioUnlock(false);
        }
      }).catch(() => {
        if (!isAudioSessionUnlocked() && shouldShowUnlockOverlay()) {
          setNeedsAudioUnlock(true);
        }
      });
    });
  }, [setNeedsAudioUnlock]);

  useEffect(() => {
    if (!needsAudioUnlock || !shouldShowUnlockOverlay()) return;
    if (!tvMode) return;

    const unlock = () => {
      markAudioSessionUnlocked();
      useAudioStore.getState().setNeedsAudioUnlock(false);
      useAudioStore.getState().retryPlayback?.(true);
    };

    document.addEventListener('keydown', unlock, { capture: true });

    return () => {
      document.removeEventListener('keydown', unlock, { capture: true });
    };
  }, [tvMode, needsAudioUnlock]);

  // 播放状态与真实音频不同步时检测；移动端加载有 src 时也尽快弹解锁层
  useEffect(() => {
    const check = () => {
      const liveRoom = useRoomStore.getState().room;
      if (!liveRoom?.current || !liveRoom.isPlaying) return;
      const trackLoading = useAudioStore.getState().trackLoading;
      const audio = audioRef.current;
      if (trackLoading && (!isRestrictedAutoplayEnv() || !audio?.src)) return;
      if (skippingRef.current || syncing.current) return;

      if (!audio?.src || !audio.paused) return;
      if (readyTrackKey.current !== trackKeyOf(liveRoom.current)) return;

      if (isAudioSessionUnlocked()) {
        void audio.play().then(() => {
          if (audio.paused) {
            resetAudioSessionUnlocked();
            setNeedsAudioUnlock(true);
          }
        }).catch(() => {
          resetAudioSessionUnlocked();
          setNeedsAudioUnlock(true);
        });
        return;
      }
      if (shouldShowUnlockOverlay()) {
        setNeedsAudioUnlock(true);
      }
    };

    const id = window.setInterval(check, UNLOCK_POLL_MS);
    return () => window.clearInterval(id);
  }, [room?.current?.queueId, room?.isPlaying, setNeedsAudioUnlock]);

  useEffect(() => {
    const current = room?.current;
    const queue = room?.queue;
    if (!current || !queue?.length) return;
    if (readyTrackKey.current !== trackKeyOf(current)) return;
    prefetchQueueSongs(queue);
  }, [room?.queue, room?.current?.queueId, room?.current?.id, room?.current?.source]);

  useEffect(() => {
    return () => {
      loadGeneration.current += 1;
      lastTrackKey.current = null;
      readyTrackKey.current = null;
      if (activeAudioRuntime?.audioRef === audioRef) {
        activeAudioRuntime = null;
      }
    };
  }, []);

  const handleSkip = useCallback(() => {
    requestSkip();
  }, [requestSkip]);

  return { handlePlayPause, handleSeek, handleSkip, audioRef };
}

