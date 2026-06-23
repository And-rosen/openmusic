const HOT_TOPLIST_ID = '3778678';
const TOPLIST_URL = `https://music.163.com/discover/toplist?id=${HOT_TOPLIST_ID}`;
const CACHE_TTL_MS = 30 * 60 * 1000;

const NETEASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://music.163.com/',
  Accept: 'text/html,application/xhtml+xml',
};

/** @type {{ at: number; data: { id: string; name: string; songs: object[] } } | null} */
let cache = null;

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeNeteaseToplistSong(raw) {
  if (!raw || raw.id == null) return null;
  const artists = Array.isArray(raw.artists) ? raw.artists : [];
  return {
    id: String(raw.id),
    source: 'netease',
    name: String(raw.name || '未知歌曲'),
    artist: artists.map((a) => a?.name).filter(Boolean).join(' / ') || '未知歌手',
    album: raw.album?.name || undefined,
    pic: raw.album?.picUrl || undefined,
    duration: typeof raw.duration === 'number' ? raw.duration : undefined,
  };
}

function parseTitle(html) {
  const match = html.match(/<h2 class="f-ff2">([^<]+)<\/h2>/i);
  return match?.[1]?.trim() || '热歌榜';
}

function parseFromTextarea(html) {
  const match = html.match(/id="song-list-pre-data"[^>]*>([\s\S]*?)<\/textarea>/i);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (!Array.isArray(parsed)) return null;
    return parsed.map(normalizeNeteaseToplistSong).filter(Boolean);
  } catch {
    return null;
  }
}

function parseFromHiddenList(html) {
  const blockMatch = html.match(/id="song-list-pre-cache"[\s\S]*?<ul class="f-hide">([\s\S]*?)<\/ul>/i);
  if (!blockMatch) return [];
  const items = [...blockMatch[1].matchAll(/<a href="\/song\?id=(\d+)">([^<]*)<\/a>/gi)];
  return items.map((m) => ({
    id: m[1],
    source: 'netease',
    name: m[2]?.trim() || '未知歌曲',
    artist: '未知歌手',
  }));
}

function parseToplistHtml(html) {
  const fromTextarea = parseFromTextarea(html);
  if (fromTextarea?.length) return fromTextarea;
  return parseFromHiddenList(html);
}

export async function fetchNeteaseHotToplist(limit = 200) {
  const n = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 200) : 200;
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return {
      ...cache.data,
      songs: cache.data.songs.slice(0, n),
    };
  }

  const res = await fetchWithTimeout(TOPLIST_URL, { headers: NETEASE_HEADERS });
  if (!res.ok) throw new Error(`网易云热榜请求失败 (${res.status})`);

  const html = await res.text();
  const songs = parseToplistHtml(html);
  if (songs.length === 0) throw new Error('未能解析网易云热榜歌曲');

  const data = {
    id: HOT_TOPLIST_ID,
    name: parseTitle(html),
    songs,
  };
  cache = { at: now, data };
  return { ...data, songs: songs.slice(0, n) };
}
