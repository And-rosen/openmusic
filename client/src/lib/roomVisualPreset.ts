const MODE_KEY = 'openmusic:room-visual-mode';
const FX_KEY = 'openmusic:room-visual-fx';

/** Mineradio 着色器预设：封面(0) / 星河(5) */
export type RoomVisualPresetId = 0 | 5;

/** 房间背景模式 */
export type RoomVisualMode = 'galaxy' | 'cover' | 'cover-bg' | 'off';

export const ROOM_VISUAL_MODES: RoomVisualMode[] = ['galaxy', 'cover', 'cover-bg', 'off'];

export const ROOM_VISUAL_MODE_META: Record<
  RoomVisualMode,
  { name: string; hasSettings: boolean; shaderPreset?: RoomVisualPresetId }
> = {
  galaxy: { name: '星河流动', hasSettings: false, shaderPreset: 5 },
  cover: { name: '律动背景', hasSettings: true, shaderPreset: 0 },
  'cover-bg': { name: '封面背景', hasSettings: false },
  off: { name: '关闭背景', hasSettings: false },
};

/** @deprecated 使用 ROOM_VISUAL_MODES */
export const ROOM_VISUAL_PRESET_CYCLE = ROOM_VISUAL_MODES;

/** @deprecated 使用 ROOM_VISUAL_MODE_META */
export const ROOM_VISUAL_PRESET_META = Object.fromEntries(
  ROOM_VISUAL_MODES.map((mode) => [mode, ROOM_VISUAL_MODE_META[mode]]),
) as Record<RoomVisualMode, { name: string; hasSettings: boolean }>;

const LEGACY_NUMERIC_MODE: Record<number, RoomVisualMode> = {
  5: 'galaxy',
  0: 'cover',
  1: 'galaxy',
  4: 'galaxy',
};

export interface RoomVisualFxSettings {
  intensity: number;
  depth: number;
  point: number;
  speed: number;
  colorBoost: number;
  bloomStrength: number;
  /** 封面模式镜头远近，1 为默认，越小越近 */
  cameraDistance: number;
}

export const DEFAULT_ROOM_VISUAL_FX: RoomVisualFxSettings = {
  intensity: 0.85,
  depth: 1.0,
  point: 1.0,
  speed: 1.0,
  colorBoost: 1.1,
  bloomStrength: 0.62,
  cameraDistance: 1.0,
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function readRoomVisualMode(): RoomVisualMode {
  try {
    const keys = [MODE_KEY, 'openmusic:room-visual-preset'];
    for (const key of keys) {
      const raw = sessionStorage.getItem(key);
      if (!raw) continue;
      if (ROOM_VISUAL_MODES.includes(raw as RoomVisualMode)) {
        return raw as RoomVisualMode;
      }
      const legacy = LEGACY_NUMERIC_MODE[Number(raw)];
      if (legacy) return legacy;
    }
  } catch {
    // ignore
  }
  return 'galaxy';
}

export function writeRoomVisualMode(mode: RoomVisualMode): void {
  try {
    sessionStorage.setItem(MODE_KEY, mode);
  } catch {
    // ignore
  }
}

/** @deprecated 使用 readRoomVisualMode */
export function readRoomVisualPreset(): RoomVisualMode {
  return readRoomVisualMode();
}

/** @deprecated 使用 writeRoomVisualMode */
export function writeRoomVisualPreset(mode: RoomVisualMode): void {
  writeRoomVisualMode(mode);
}

export function readRoomVisualFx(): RoomVisualFxSettings {
  try {
    const raw = sessionStorage.getItem(FX_KEY);
    if (!raw) return { ...DEFAULT_ROOM_VISUAL_FX };
    const parsed = JSON.parse(raw) as Partial<RoomVisualFxSettings>;
    return {
      intensity: clamp(Number(parsed.intensity) || DEFAULT_ROOM_VISUAL_FX.intensity, 0.2, 1.6),
      depth: clamp(Number(parsed.depth) || DEFAULT_ROOM_VISUAL_FX.depth, 0.2, 1.8),
      point: clamp(Number(parsed.point) || DEFAULT_ROOM_VISUAL_FX.point, 0.5, 2.2),
      speed: clamp(Number(parsed.speed) || DEFAULT_ROOM_VISUAL_FX.speed, 0.2, 2.5),
      colorBoost: clamp(Number(parsed.colorBoost) || DEFAULT_ROOM_VISUAL_FX.colorBoost, 0.5, 2.0),
      bloomStrength: clamp(Number(parsed.bloomStrength) || DEFAULT_ROOM_VISUAL_FX.bloomStrength, 0, 1.6),
      cameraDistance: clamp(Number(parsed.cameraDistance) || DEFAULT_ROOM_VISUAL_FX.cameraDistance, 0.55, 1.65),
    };
  } catch {
    return { ...DEFAULT_ROOM_VISUAL_FX };
  }
}

export function writeRoomVisualFx(fx: RoomVisualFxSettings): void {
  try {
    sessionStorage.setItem(FX_KEY, JSON.stringify(fx));
  } catch {
    // ignore
  }
}

export const ROOM_AMBIENT_GLASS_CLASS =
  'border-white/10 bg-black/20 backdrop-blur-xl [-webkit-backdrop-filter:blur(24px)]';

/** 星河流动 / 律动背景：顶栏底栏全透明，无玻璃模糊 */
export const ROOM_AMBIENT_GLASS_TRANSPARENT_CLASS = 'border-transparent bg-transparent';

export function roomAmbientGlassClass(mode: RoomVisualMode): string {
  return mode === 'galaxy' || mode === 'cover'
    ? ROOM_AMBIENT_GLASS_TRANSPARENT_CLASS
    : ROOM_AMBIENT_GLASS_CLASS;
}
