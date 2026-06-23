import { isMobileDevice } from './audioUnlock';

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

/** metadata ready is enough to seek/play; do not block track switching on full buffering. */
export function waitForAudioMinimumReady(audio: HTMLAudioElement): Promise<void> {
  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();

  const timeoutMs = isMobileDevice() ? 400 : 700;
  return new Promise((resolve) => {
    let resolved = false;
    const cleanup = () => {
      audio.removeEventListener('loadedmetadata', done);
      audio.removeEventListener('loadeddata', done);
      audio.removeEventListener('canplay', done);
    };
    const finish = () => {
      if (resolved) return;
      resolved = true;
      window.clearTimeout(timer);
      cleanup();
      resolve();
    };
    const done = () => {
      if (audio.readyState < HTMLMediaElement.HAVE_METADATA) return;
      finish();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    audio.addEventListener('loadedmetadata', done, { once: true });
    audio.addEventListener('loadeddata', done, { once: true });
    audio.addEventListener('canplay', done, { once: true });
  });
}
