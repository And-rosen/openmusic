import { isMobileDevice } from './audioUnlock';

/** 服务端 playback_tick / room 进度锚点，用于在 tick 间隔内线性外推 */
let anchor = { time: 0, at: 0, playing: false };

export function snapPlaybackAnchor(time: number, isPlaying: boolean): void {
  anchor = { time, at: Date.now(), playing: isPlaying };
}

export function resetPlaybackAnchor(time = 0): void {
  anchor = { time, at: Date.now(), playing: false };
}

/** 当前应在播放到的时间（秒），比逐步更新的 room.currentTime 更准 */
export function getLivePlaybackTime(fallback = 0): number {
  if (!anchor.playing) return anchor.time || fallback;
  return anchor.time + (Date.now() - anchor.at) / 1000;
}

export function waitForAudioCanPlay(audio: HTMLAudioElement, timeoutMs?: number): Promise<void> {
  const mobile = isMobileDevice();
  const timeout = timeoutMs ?? (mobile ? 2500 : 10000);
  const minReadyState = mobile
    ? HTMLMediaElement.HAVE_METADATA
    : HTMLMediaElement.HAVE_FUTURE_DATA;

  if (audio.readyState >= minReadyState) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, timeout);

    const cleanup = () => {
      window.clearTimeout(timer);
      audio.removeEventListener('canplay', onReady);
      audio.removeEventListener('loadeddata', onReady);
      audio.removeEventListener('loadedmetadata', onReady);
    };

    const onReady = () => {
      if (audio.readyState < minReadyState) return;
      cleanup();
      resolve();
    };

    audio.addEventListener('canplay', onReady, { once: true });
    audio.addEventListener('loadeddata', onReady, { once: true });
    audio.addEventListener('loadedmetadata', onReady, { once: true });
  });
}

/** 移动端：metadata 就绪即可尝试播放/弹解锁，避免等满 10 秒 */
export function waitForAudioMinimumReady(audio: HTMLAudioElement): Promise<void> {
  if (!isMobileDevice()) {
    return waitForAudioCanPlay(audio);
  }

  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, 400);
    const done = () => {
      window.clearTimeout(timer);
      audio.removeEventListener('loadedmetadata', done);
      audio.removeEventListener('canplay', done);
      resolve();
    };
    audio.addEventListener('loadedmetadata', done, { once: true });
    audio.addEventListener('canplay', done, { once: true });
  });
}
