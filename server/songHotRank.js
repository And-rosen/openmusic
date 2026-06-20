import { getRedisClient } from './roomStorage.js';

const HOT_ZSET_KEY = 'openmusic:song_hot';
const HOT_META_HASH = 'openmusic:song_hot:meta';
const MAX_HOT_ITEMS = 200;
const DEFAULT_LIMIT = 20;

/** @type {Map<string, { count: number; id: string; source: string; name: string; artist: string; album?: string; pic?: string; duration?: number; lastRequestedAt: number }>} */
const memoryHot = new Map();

function songHotKey(source, id) {
  return `${source || 'netease'}:${id}`;
}

function buildMeta(song) {
  return {
    id: song.id,
    source: song.source || 'netease',
    name: song.name,
    artist: song.artist || '未知歌手',
    album: song.album || undefined,
    pic: song.pic || undefined,
    duration: song.duration || undefined,
    lastRequestedAt: Date.now(),
  };
}

function recordSongRequestMemory(song) {
  const key = songHotKey(song.source, song.id);
  const meta = buildMeta(song);
  const existing = memoryHot.get(key);
  if (existing) {
    existing.count += 1;
    Object.assign(existing, meta);
  } else {
    memoryHot.set(key, { ...meta, count: 1 });
  }
}

async function trimHotRank(client) {
  const size = await client.zCard(HOT_ZSET_KEY);
  if (size > MAX_HOT_ITEMS) {
    await client.zRemRangeByRank(HOT_ZSET_KEY, 0, size - MAX_HOT_ITEMS - 1);
  }
}

/** 记录一次点歌（异步，不阻塞主流程） */
export function recordSongRequest(song) {
  if (!song?.id || !song?.name) return;

  const client = getRedisClient();
  if (!client) {
    recordSongRequestMemory(song);
    return;
  }

  const key = songHotKey(song.source, song.id);
  const meta = buildMeta(song);

  setImmediate(() => {
    void (async () => {
      try {
        await client.zIncrBy(HOT_ZSET_KEY, 1, key);
        await client.hSet(HOT_META_HASH, key, JSON.stringify(meta));
        await trimHotRank(client);
      } catch (err) {
        console.error('热榜记录失败:', err.message);
        recordSongRequestMemory(song);
      }
    })();
  });
}

export async function getHotSongs(limit = DEFAULT_LIMIT) {
  const n = Math.min(Math.max(1, Number(limit) || DEFAULT_LIMIT), 50);
  const client = getRedisClient();

  if (client) {
    try {
      const entries = await client.zRangeWithScores(HOT_ZSET_KEY, 0, n - 1, { REV: true });
      if (entries.length === 0) return getHotSongsFromMemory(n);

      const keys = entries.map((entry) => entry.value);
      const rawMetas = await client.hmGet(HOT_META_HASH, keys);

      return entries
        .map((entry, i) => {
          let meta = null;
          try {
            meta = rawMetas[i] ? JSON.parse(rawMetas[i]) : null;
          } catch {
            meta = null;
          }
          if (!meta?.id || !meta?.name) return null;
          return {
            id: meta.id,
            source: meta.source || 'netease',
            name: meta.name,
            artist: meta.artist || '未知歌手',
            album: meta.album,
            pic: meta.pic,
            duration: meta.duration,
            count: Math.round(Number(entry.score) || 0),
            lastRequestedAt: meta.lastRequestedAt,
          };
        })
        .filter(Boolean);
    } catch (err) {
      console.error('热榜读取失败:', err.message);
      return getHotSongsFromMemory(n);
    }
  }

  return getHotSongsFromMemory(n);
}

function getHotSongsFromMemory(n) {
  return Array.from(memoryHot.values())
    .sort((a, b) => b.count - a.count || b.lastRequestedAt - a.lastRequestedAt)
    .slice(0, n)
    .map(({ count, ...song }) => ({ ...song, count }));
}
