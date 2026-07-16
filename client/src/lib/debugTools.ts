import { useAudioStore } from '../stores/audioStore';
import { useRoomStore } from '../stores/roomStore';
import { useChatStore } from '../stores/chatStore';
import { getSharedAudio } from './audioElement';
import { getAudioBoundQueueId } from './audioTrackBinding';
import { getClientId } from './clientId';
import {
  getClientPlaybackState,
  getPlaybackSnapshotTiming,
  getPlaybackTime,
} from './playbackState';
import { formatDriftHistogram, resetDriftHistogram } from './driftHistogram';

const DEBUG_FLAG_KEY = 'openmusic:debug';
const DEBUG_INTERVAL_MS = 2000;
const MAX_EVENTS = 120;

type DebugEvent = {
  at: string;
  name: string;
  line: string;
};

type SocketSnapshot = {
  id?: string;
  connected?: boolean;
  transport?: string;
};

const state = {
  enabled: false,
  timer: 0,
  events: [] as DebugEvent[],
  getSocket: null as null | (() => SocketSnapshot | null),
};

function nowLabel(): string {
  return new Date().toISOString().slice(11, 23);
}

function fmtNum(value: number | null | undefined, digits = 3): string {
  return Number.isFinite(value) ? Number(value!.toFixed(digits)).toString() : 'null';
}

/** key=value 单行，便于整段复制 */
export function debugLine(parts: Record<string, string | number | boolean | null | undefined>): string {
  return Object.entries(parts)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v ?? 'null'}`)
    .join(' ');
}

export function debugLog(name: string, line?: string): void {
  const text = line ?? '';
  const event: DebugEvent = { at: nowLabel(), name, line: text };
  state.events.push(event);
  if (state.events.length > MAX_EVENTS) {
    state.events.splice(0, state.events.length - MAX_EVENTS);
  }
  if (state.enabled) {
    console.log(text ? `[openmusic:${name}] ${text}` : `[openmusic:${name}]`);
  }
}

function shortSrc(src: string): string {
  if (!src) return '';
  try {
    const url = new URL(src);
    return `${url.host}${url.pathname.slice(0, 24)}…`;
  } catch {
    return src.slice(0, 48);
  }
}

function formatSnapshotText(reason: string): string {
  const lines: string[] = [];
  const at = new Date().toISOString();
  lines.push(`--- openmusic debug ${reason} ${at} ---`);

  const socket = state.getSocket?.();
  lines.push(debugLine({
    href: location.href,
    clientId: getClientId(),
    socketId: socket?.id ?? null,
    socketConnected: socket?.connected ?? null,
    socketTransport: socket?.transport ?? null,
    hidden: document.hidden,
    visibility: document.visibilityState,
    online: navigator.onLine,
  }));

  const { room, nickname, mySocketId, isOwner } = useRoomStore.getState();
  lines.push(debugLine({
    roomId: room?.id ?? null,
    roomName: room?.name ?? null,
    nickname,
    mySocketId,
    isOwner,
    isPlaying: room?.isPlaying ?? null,
    roomCurrentTime: fmtNum(room?.currentTime),
    users: room?.users?.length ?? 0,
    queueLen: room?.queue?.length ?? 0,
    chatMsgs: useChatStore.getState().messages.length,
  }));

  if (room?.current) {
    lines.push(debugLine({
      trackQueueId: room.current.queueId,
      trackId: room.current.id,
      trackSource: room.current.source,
      trackName: room.current.name,
      trackDuration: room.current.duration ?? null,
    }));
  }

  const audio = getSharedAudio();
  const audioStore = useAudioStore.getState();
  lines.push(debugLine({
    audioBound: getAudioBoundQueueId(audio) || null,
    audioTime: fmtNum(audio.currentTime),
    audioDuration: fmtNum(audio.duration),
    audioPaused: audio.paused,
    audioEnded: audio.ended,
    audioReadyState: audio.readyState,
    audioRate: fmtNum(audio.playbackRate),
    trackLoading: audioStore.trackLoading,
    needsUnlock: audioStore.needsAudioUnlock,
    smoothTime: fmtNum(audioStore.smoothPlaybackTime),
    playbackVersion: audioStore.playbackVersion,
    audioSrc: shortSrc(audio.currentSrc || audio.src),
  }));

  const pb = getClientPlaybackState();
  if (pb) {
    const derived = getPlaybackTime(pb);
    const driftMs = audio.ended
      ? 'inf'
      : Math.round((derived - audio.currentTime) * 1000);
    const timing = getPlaybackSnapshotTiming();
    const serverNowMs = Number(pb.serverNowMs);
    const clockSkewMs = Number.isFinite(serverNowMs) && serverNowMs > 0
      ? Math.round(Date.now() - serverNowMs)
      : null;
    lines.push(debugLine({
      pbVersion: pb.version,
      pbTrackId: pb.trackId,
      pbStatus: pb.status,
      pbPositionSec: fmtNum(pb.positionSec),
      pbDurationSec: fmtNum(pb.durationSec),
      pbDerivedSec: fmtNum(derived),
      pbDriftMs: driftMs,
      pbStartedAt: pb.startedAt || 0,
      pbServerNowMs: pb.serverNowMs,
      pbReceivedAt: timing?.receivedAt ?? pb.receivedAt,
      pbCommittedAt: timing?.committedAt ?? pb.committedAt,
      snapshotAgeMs: timing?.snapshotAgeMs ?? null,
      clockSkewMs,
    }));
  } else {
    lines.push('playback_state=null');
  }

  lines.push(formatDriftHistogram());

  const recent = state.events.slice(-12);
  if (recent.length > 0) {
    lines.push('recent_events:');
    for (const e of recent) {
      lines.push(`  ${e.at} ${e.name} ${e.line}`.trimEnd());
    }
  }

  lines.push('--- end ---');
  return lines.join('\n');
}

export function getDebugSnapshot(): string {
  return formatSnapshotText('snapshot');
}

function printSnapshot(reason = 'tick'): void {
  console.log(formatSnapshotText(reason));
}

function printDriftHistogram(): void {
  console.log(formatDriftHistogram());
}

/** URL ?debug=1 或 ?om_debug=1 自动开启（并从地址栏移除参数） */
function consumeDebugUrlParam(): boolean {
  try {
    const params = new URLSearchParams(location.search);
    const enabled = params.get('debug') === '1' || params.get('om_debug') === '1';
    if (!enabled) return false;
    params.delete('debug');
    params.delete('om_debug');
    const query = params.toString();
    const next = `${location.pathname}${query ? `?${query}` : ''}${location.hash}`;
    history.replaceState(null, '', next);
    return true;
  } catch {
    return false;
  }
}

export function setDebugSocketProvider(provider: () => SocketSnapshot | null): void {
  state.getSocket = provider;
}

export function enableOpenMusicDebug(): void {
  if (state.enabled) {
    printSnapshot('already-on');
    return;
  }
  state.enabled = true;
  localStorage.setItem(DEBUG_FLAG_KEY, '1');
  printSnapshot('enabled');
  state.timer = window.setInterval(() => printSnapshot('tick'), DEBUG_INTERVAL_MS);
}

export function disableOpenMusicDebug(): void {
  state.enabled = false;
  localStorage.removeItem(DEBUG_FLAG_KEY);
  if (state.timer) window.clearInterval(state.timer);
  state.timer = 0;
  resetDriftHistogram();
  console.log('[openmusic:debug] disabled');
}

export function installOpenMusicDebug(): void {
  const target = window as typeof window & {
    debug?: () => void;
    debugOff?: () => void;
    debugNow?: () => void;
    debugHist?: () => void;
    debugHistReset?: () => void;
    openMusicDebug?: {
      on: () => void;
      off: () => void;
      now: () => void;
      hist: () => void;
      histReset: () => void;
      snapshot: typeof getDebugSnapshot;
      event: typeof debugLog;
    };
  };

  target.debug = enableOpenMusicDebug;
  target.debugOff = disableOpenMusicDebug;
  target.debugNow = () => printSnapshot('manual');
  target.debugHist = printDriftHistogram;
  target.debugHistReset = () => {
    resetDriftHistogram();
    console.log('[openmusic:debug] drift histogram reset');
  };
  target.openMusicDebug = {
    on: enableOpenMusicDebug,
    off: disableOpenMusicDebug,
    now: target.debugNow,
    hist: target.debugHist,
    histReset: target.debugHistReset,
    snapshot: getDebugSnapshot,
    event: debugLog,
  };

  window.addEventListener('visibilitychange', () => {
    debugLog('visibilitychange', debugLine({
      hidden: document.hidden,
      visibility: document.visibilityState,
    }));
  });
  window.addEventListener('online', () => debugLog('online'));
  window.addEventListener('offline', () => debugLog('offline'));
  window.addEventListener('error', (event) => {
    debugLog('window-error', debugLine({
      message: event.message,
      file: event.filename,
      line: event.lineno,
      col: event.colno,
    }));
  });
  window.addEventListener('unhandledrejection', (event) => {
    debugLog('unhandled-rejection', String(event.reason));
  });

  if (localStorage.getItem(DEBUG_FLAG_KEY) === '1' || consumeDebugUrlParam()) {
    enableOpenMusicDebug();
  }
}

export { resetDriftHistogram };
