import { fetchWithTimeout } from '../api/http';
import { getClientId, rememberClientId } from './clientId';

let bootstrapPromise: Promise<string | null> | null = null;

/** 通过 HttpOnly Cookie 建立会话，不在 WebSocket 中传递身份令牌 */
export function ensureSessionBootstrap(force = false): Promise<string | null> {
  if (force) bootstrapPromise = null;
  if (!bootstrapPromise) {
    bootstrapPromise = fetchWithTimeout(
      '/api/session/bootstrap',
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: getClientId() }),
      },
      8000,
    )
      .then(async (res) => {
        if (!res.ok) return null;
        const data = (await res.json()) as { clientId?: string };
        if (data.clientId) rememberClientId(data.clientId);
        return data.clientId || null;
      })
      .catch(() => null);
  }
  return bootstrapPromise;
}

export function resetSessionBootstrap(): void {
  bootstrapPromise = null;
}
