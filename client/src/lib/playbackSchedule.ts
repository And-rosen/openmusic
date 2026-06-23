import type { PlaybackState } from '../types';
import { useAudioStore } from '../stores/audioStore';
import { useRoomStore } from '../stores/roomStore';
import {
  applyPlaybackState,
  getPlaybackTime,
  playbackStateFromRoom,
  resetPlaybackStateCache,
} from './playbackState';
import type { RoomState } from '../types';

function syncRoomPlaybackFromState(state: PlaybackState) {
  const { room } = useRoomStore.getState();
  if (!room || room.id !== state.roomId) return;
  if (!room.current || room.current.queueId !== state.trackId) return;
  useRoomStore.getState().setRoom({
    ...room,
    currentTime: getPlaybackTime(state),
    isPlaying: state.status === 'playing',
  });
}

/** 立即应用（加入房间等初始同步） */
export function commitPlaybackState(state: PlaybackState): boolean {
  if (!applyPlaybackState(state)) return false;
  useAudioStore.getState().setPlaybackVersion(state.version);
  syncRoomPlaybackFromState(state);
  return true;
}

/** 立即应用服务端播放状态，避免 seek / 切歌边界被旧状态短暂覆盖。 */
export function schedulePlaybackState(state: PlaybackState): void {
  commitPlaybackState(state);
}

export function resetPlaybackScheduling(): void {}

export function seedPlaybackFromRoom(room: RoomState): void {
  if (!room.current) {
    resetPlaybackStateCache();
    resetPlaybackScheduling();
    useAudioStore.getState().setPlaybackVersion(0);
    return;
  }
  const state = playbackStateFromRoom(
    room.id,
    room.current.queueId,
    room.isPlaying,
    room.currentTime,
  );
  commitPlaybackState(state);
}
