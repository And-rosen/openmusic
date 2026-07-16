export type AppVersionInfo = {
  buildId: string;
  version?: string;
  notes: string[];
  builtAt?: string | null;
};

export const LOCAL_APP_BUILD_ID =
  typeof __APP_BUILD_ID__ === 'string' && __APP_BUILD_ID__
    ? __APP_BUILD_ID__
    : 'dev';

export const LOCAL_APP_NOTES: string[] =
  Array.isArray(__APP_VERSION_NOTES__) ? __APP_VERSION_NOTES__ : [];

const DISMISS_KEY = 'openmusic:update-dismissed-build';

export function getDismissedUpdateBuildId(): string | null {
  try {
    return sessionStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

export function dismissUpdateForBuild(buildId: string): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, buildId);
  } catch {
    // ignore
  }
}

export function isUpdateSuppressedForBuild(buildId: string): boolean {
  const id = String(buildId || '').trim();
  if (!id) return false;
  return getDismissedUpdateBuildId() === id;
}

export async function fetchRemoteAppVersion(signal?: AbortSignal): Promise<AppVersionInfo | null> {
  const url = `/api/app-version?_=${Date.now()}`;
  const res = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Partial<AppVersionInfo>;
  const buildId = String(data.buildId || data.version || '').trim();
  if (!buildId) return null;
  const notes = Array.isArray(data.notes)
    ? data.notes.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  return {
    buildId,
    version: data.version ? String(data.version) : buildId,
    notes,
    builtAt: data.builtAt ?? null,
  };
}

export type ForceAppReloadOptions = {
  /** 刷新到首页（离开房间），默认刷新当前页 */
  toHome?: boolean;
};

/** 清缓存并带版本参数硬刷新，绕过 EdgeOne/浏览器旧 HTML */
export async function forceAppReload(options: ForceAppReloadOptions = {}): Promise<void> {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    // ignore
  }

  const url = options.toHome
    ? new URL('/', window.location.origin)
    : new URL(window.location.href);
  url.searchParams.set('_omv', Date.now().toString());
  window.location.replace(url.toString());
}
