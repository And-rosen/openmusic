import type { MusicSource, RoomAudioQuality } from '../../types';
import { useRoomStore } from '../../stores/roomStore';
import { resolveEffectiveAudioQuality } from '../../stores/userQualityStore';
import { useImmersiveModeStore } from '../../stores/immersiveModeStore';

export type NeteaseQuality = 'standard' | 'exhigh' | 'lossless' | 'higher' | 'hires' | '128' | '320' | 'flac';
export type TencentQuality = 'standard' | 'exhigh' | 'lossless' | '128' | '320' | 'flac';

export const DEFAULT_ROOM_AUDIO_QUALITY: RoomAudioQuality = {
  netease: 'hires',
  tencent: 'lossless',
};

/** 沉浸模式本机播放音质上限（不改写用户设置） */
export const IMMERSIVE_PLAYBACK_QUALITY_CAP = 'exhigh';

export interface QualityOption {
  value: string;
  label: string;
}

export const NETEASE_QUALITY_OPTIONS: QualityOption[] = [
  { value: 'standard', label: '标准 ~128k' },
  { value: 'higher', label: '较高 ~192k' },
  { value: 'exhigh', label: '极高 ~320k' },
  { value: 'lossless', label: '无损 FLAC' },
  { value: 'hires', label: 'Hi-Res' },
];

export const TENCENT_QUALITY_OPTIONS: QualityOption[] = [
  { value: 'standard', label: '标准 ~128k' },
  { value: 'exhigh', label: '极高 ~320k' },
  { value: 'lossless', label: '无损 FLAC' },
];

const NETEASE_CANONICAL = new Set(NETEASE_QUALITY_OPTIONS.map((o) => o.value));
const TENCENT_CANONICAL = new Set(TENCENT_QUALITY_OPTIONS.map((o) => o.value));

/** API 别名 → 房间存储用的 canonical 值 */
const QUALITY_ALIASES: Record<string, string> = {
  '128': 'standard',
  '320': 'exhigh',
  flac: 'lossless',
};

const QUALITY_LABEL_MAP = new Map<string, string>();
for (const opt of [...NETEASE_QUALITY_OPTIONS, ...TENCENT_QUALITY_OPTIONS]) {
  if (!QUALITY_LABEL_MAP.has(opt.value)) {
    QUALITY_LABEL_MAP.set(opt.value, opt.label);
  }
}

export function getQualityLabel(quality: string | undefined): string {
  if (!quality) return '默认';
  return QUALITY_LABEL_MAP.get(quality) || quality;
}

export function normalizeRoomAudioQuality(
  input: RoomAudioQuality | Partial<RoomAudioQuality> | null | undefined,
): RoomAudioQuality {
  const rawNetease = String(input?.netease || DEFAULT_ROOM_AUDIO_QUALITY.netease);
  const rawTencent = String(input?.tencent || DEFAULT_ROOM_AUDIO_QUALITY.tencent);
  const netease = QUALITY_ALIASES[rawNetease] || rawNetease;
  const tencent = QUALITY_ALIASES[rawTencent] || rawTencent;
  return {
    netease: NETEASE_CANONICAL.has(netease) ? netease : 'lossless',
    tencent: TENCENT_CANONICAL.has(tencent) ? tencent : 'lossless',
  };
}

export function getRoomPlaybackQuality(source: MusicSource): string | undefined {
  const room = useRoomStore.getState().room;
  const quality = normalizeRoomAudioQuality(room?.audioQuality);
  if (source === 'netease') return quality.netease;
  if (source === 'tencent') return quality.tencent;
  return undefined;
}

export function getQualityOptionsForSource(source: MusicSource): QualityOption[] {
  if (source === 'netease') return NETEASE_QUALITY_OPTIONS;
  if (source === 'tencent') return TENCENT_QUALITY_OPTIONS;
  return [];
}

/** 沉浸模式：音质不超过极高；若用户设置更低则沿用设置 */
export function capQualityForImmersive(source: MusicSource, quality: string): string {
  const options = getQualityOptionsForSource(source);
  if (options.length === 0) return quality;
  const normalized = QUALITY_ALIASES[quality] || quality;
  const capIndex = options.findIndex((opt) => opt.value === IMMERSIVE_PLAYBACK_QUALITY_CAP);
  if (capIndex < 0) return normalized;
  const currentIndex = options.findIndex((opt) => opt.value === normalized);
  if (currentIndex < 0) return IMMERSIVE_PLAYBACK_QUALITY_CAP;
  return currentIndex <= capIndex ? normalized : IMMERSIVE_PLAYBACK_QUALITY_CAP;
}

export function applyImmersivePlaybackQualityCap(quality: RoomAudioQuality): RoomAudioQuality {
  return {
    netease: capQualityForImmersive('netease', quality.netease),
    tencent: capQualityForImmersive('tencent', quality.tencent),
  };
}

/** 本机自选音质，仅用于拉取播放地址，不影响房间同步逻辑 */
export function getUserPlaybackQuality(source: MusicSource): string | undefined {
  const room = useRoomStore.getState().room;
  let quality = resolveEffectiveAudioQuality(room?.audioQuality);
  const immersive = useImmersiveModeStore.getState();
  if (immersive.qualityCapActive || immersive.enabled) {
    quality = applyImmersivePlaybackQualityCap(quality);
  }
  if (source === 'netease') return quality.netease;
  if (source === 'tencent') return quality.tencent;
  return undefined;
}

/** 降一级音质；已在最低档时返回 null */
export function getDowngradedQuality(source: MusicSource, currentQuality: string): string | null {
  const options = getQualityOptionsForSource(source);
  if (options.length === 0) return null;
  const normalized = QUALITY_ALIASES[currentQuality] || currentQuality;
  const index = options.findIndex((opt) => opt.value === normalized);
  if (index <= 0) return null;
  return options[index - 1].value;
}

/** 最低可用音质（标准档） */
export function getLowestQuality(source: MusicSource): string | null {
  const options = getQualityOptionsForSource(source);
  return options[0]?.value ?? null;
}

/** 从房间音质起，生成逐级降档列表（含起始档） */
export function buildQualityFallbackChain(source: MusicSource, startQuality: string): string[] {
  const chain: string[] = [];
  let current: string | null = startQuality;
  while (current && !chain.includes(current)) {
    chain.push(current);
    current = getDowngradedQuality(source, current);
  }
  return chain;
}
