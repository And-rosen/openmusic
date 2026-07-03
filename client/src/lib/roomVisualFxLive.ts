import {
  readRoomVisualFx,
  writeRoomVisualFx,
  type RoomVisualFxSettings,
} from './roomVisualPreset';
import {
  bindStageLyricFxSource,
  recomputeStageLyricPalette,
} from './stageLyricPaletteLive';
import { applyRoomVisualAppearance } from './roomVisualAppearance';
import { syncGalaxyHandGestureMode } from '../components/galaxy/lib/galaxyHandGesture';

const fxListeners = new Set<() => void>();

/** 供 R3F useFrame 同步读取，绕过 Canvas 外 React 更新延迟 */
export const roomVisualFxLive: { current: RoomVisualFxSettings } = {
  current: readRoomVisualFx(),
};

bindStageLyricFxSource(() => roomVisualFxLive.current);
recomputeStageLyricPalette();
applyRoomVisualAppearance(roomVisualFxLive.current);

export function subscribeRoomVisualFx(listener: () => void): () => void {
  fxListeners.add(listener);
  return () => {
    fxListeners.delete(listener);
  };
}

function notifyFxListeners(): void {
  fxListeners.forEach((listener) => listener());
}

function afterFxCommit(next: RoomVisualFxSettings, prev: RoomVisualFxSettings): void {
  applyRoomVisualAppearance(next);
  if (next.cameraInteraction !== prev.cameraInteraction) {
    void syncGalaxyHandGestureMode(next.cameraInteraction);
  }
}

export function commitRoomVisualFx(next: RoomVisualFxSettings): RoomVisualFxSettings {
  const prev = roomVisualFxLive.current;
  roomVisualFxLive.current = next;
  writeRoomVisualFx(next);
  recomputeStageLyricPalette();
  afterFxCommit(next, prev);
  notifyFxListeners();
  return next;
}

export function patchRoomVisualFx(patch: Partial<RoomVisualFxSettings>): RoomVisualFxSettings {
  return commitRoomVisualFx({ ...roomVisualFxLive.current, ...patch });
}
