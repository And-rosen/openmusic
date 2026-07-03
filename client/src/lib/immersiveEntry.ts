import { getCoverUrl } from '../api/music';
import type { QueueItem } from '../types';
import { getSharedAudio } from './audioElement';
import { isAudioBoundToQueue } from './audioTrackBinding';
import { waitForAudioMinimumReady } from './audioReady';
import { isProxiedMediaUrl, isSameOriginMediaUrl } from './mediaProxyUrl';
import { invalidateTrackUrlCache, resolveSongUrl } from './songPreloadCache';
import { useAudioStore } from '../stores/audioStore';

const TRACK_READY_POLL_MS = 50;
const TRACK_READY_TIMEOUT_MS = 20000;

function preloadImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
}

export function preloadGalaxyBackground(): Promise<unknown> {
  return import('../components/galaxy/GalaxyBackground3D');
}

async function waitForCurrentTrackProxyReady(
  song: QueueItem,
  timeoutMs = TRACK_READY_TIMEOUT_MS,
): Promise<void> {
  const audio = getSharedAudio();
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const loading = useAudioStore.getState().trackLoading;
    const src = audio.currentSrc || audio.src || '';
    const bound = isAudioBoundToQueue(audio, song.queueId);
    const proxied = Boolean(src && (isProxiedMediaUrl(src) || isSameOriginMediaUrl(src)));

    if (!loading && bound && proxied && audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      return;
    }

    await new Promise((resolve) => window.setTimeout(resolve, TRACK_READY_POLL_MS));
  }

  throw new Error('immersive track proxy timeout');
}

export interface PrepareImmersiveEnterOptions {
  song: QueueItem | null;
  needsProxyReload: boolean;
}

/** 进入沉浸模式前预加载 Galaxy chunk、封面与（如需）代理音源 */
export async function prepareImmersiveEnter(options: PrepareImmersiveEnterOptions): Promise<void> {
  const { song, needsProxyReload } = options;
  const coverUrl = song ? getCoverUrl(song, 'medium') : null;

  const tasks: Promise<unknown>[] = [preloadGalaxyBackground()];

  if (coverUrl) {
    tasks.push(preloadImage(coverUrl));
  }

  if (needsProxyReload && song) {
    invalidateTrackUrlCache(song);
    tasks.push((async () => {
      useAudioStore.getState().requestTrackReload();
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
      });
      await resolveSongUrl(song, { refresh: true });
      await waitForCurrentTrackProxyReady(song);
    })());
  }

  await Promise.all(tasks);

  if (needsProxyReload && song) {
    await waitForAudioMinimumReady(getSharedAudio());
  }
}
