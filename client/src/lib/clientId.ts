const CLIENT_ID_KEY = 'openmusic_client_id';
const CLIENT_ID_COOKIE = 'openmusic_uid';
const CLIENT_TOKEN_KEY = 'openmusic_client_token';
const CLIENT_TOKEN_COOKIE = 'openmusic_token';
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365 * 5;

function createClientId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const random = Math.random().toString(36).slice(2, 14);
  return `${Date.now().toString(36)}-${random}`;
}

function isValidClientId(value: string | null | undefined): value is string {
  return /^[a-zA-Z0-9_-]{8,64}$/.test(String(value || '').trim());
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${encodeURIComponent(name)}=`;
  const part = document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix));
  if (!part) return null;
  try {
    return decodeURIComponent(part.slice(prefix.length));
  } catch {
    return part.slice(prefix.length);
  }
}

function writeCookie(name: string, value: string): void {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Max-Age=${COOKIE_MAX_AGE_SEC}; Path=/; SameSite=Lax${secure}`;
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key) || sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage may be unavailable.
  }
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // sessionStorage may be unavailable.
  }
}

let cachedClientId: string | null = null;
let cachedClientToken: string | null = null;

function persistClientId(clientId: string): void {
  cachedClientId = clientId;
  writeCookie(CLIENT_ID_COOKIE, clientId);
  writeStorage(CLIENT_ID_KEY, clientId);
}

export function getClientId(): string {
  if (cachedClientId) return cachedClientId;

  const candidates = [
    readCookie(CLIENT_ID_COOKIE),
    readCookie(CLIENT_ID_KEY),
    readStorage(CLIENT_ID_KEY),
  ];

  const existing = candidates.find(isValidClientId);
  if (existing) {
    persistClientId(existing);
    return existing;
  }

  const next = createClientId();
  persistClientId(next);
  return next;
}

export function rememberClientId(clientId: string): void {
  if (!isValidClientId(clientId)) return;
  persistClientId(clientId);
}

export function getClientToken(): string | undefined {
  if (cachedClientToken) return cachedClientToken;
  const token = readCookie(CLIENT_TOKEN_COOKIE) || readStorage(CLIENT_TOKEN_KEY);
  if (!token) return undefined;
  cachedClientToken = token;
  writeCookie(CLIENT_TOKEN_COOKIE, token);
  writeStorage(CLIENT_TOKEN_KEY, token);
  return token;
}

export function rememberClientToken(clientToken: string): void {
  if (!clientToken) return;
  cachedClientToken = clientToken;
  writeCookie(CLIENT_TOKEN_COOKIE, clientToken);
  writeStorage(CLIENT_TOKEN_KEY, clientToken);
}

export function rememberClientIdentity(clientId?: string, clientToken?: string): void {
  if (clientId) rememberClientId(clientId);
  if (clientToken) rememberClientToken(clientToken);
}
