const ROOM_IDS_KEY = 'openmusic:room_ids';
const roomKey = (id) => `openmusic:room:${id}`;

let redisClient = null;
let enabled = false;

function parseRedisDb(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function buildRedisOptions() {
  const url = (process.env.REDIS_URL || '').trim();
  const host = (process.env.REDIS_HOST || '').trim();

  if (!url && !host) return null;

  const username = (process.env.REDIS_USERNAME || '').trim();
  const password = (process.env.REDIS_PASSWORD || '').trim();
  const database = parseRedisDb(process.env.REDIS_DB);

  if (url) {
    const options = { url };
    if (username) options.username = username;
    if (password) options.password = password;
    if (database !== undefined) options.database = database;
    return options;
  }

  const port = parseInt(process.env.REDIS_PORT || '6379', 10) || 6379;
  const options = {
    socket: { host, port },
  };
  if (username) options.username = username;
  if (password) options.password = password;
  if (database !== undefined) options.database = database;
  return options;
}

function describeRedisTarget(options) {
  if (options.url) {
    try {
      const parsed = new URL(options.url);
      const db = options.database ?? (parsed.pathname?.replace(/^\//, '') || '0');
      return `${parsed.hostname}:${parsed.port || 6379} db=${db}`;
    } catch {
      return 'REDIS_URL';
    }
  }
  const host = options.socket?.host || 'localhost';
  const port = options.socket?.port || 6379;
  const db = options.database ?? 0;
  return `${host}:${port} db=${db}`;
}

export function isRedisEnabled() {
  return enabled;
}

export function getRedisClient() {
  return enabled ? redisClient : null;
}

export async function initRoomStorage() {
  const options = buildRedisOptions();
  if (!options) {
    console.log('Redis: 未配置（REDIS_URL 或 REDIS_HOST），房间数据仅保存在内存');
    return false;
  }

  try {
    const { createClient } = await import('redis');
    redisClient = createClient(options);
    redisClient.on('error', (err) => {
      console.error('Redis 错误:', err.message);
    });
    await redisClient.connect();
    enabled = true;
    console.log(`Redis: 已连接 ${describeRedisTarget(options)}，房间数据将持久化`);
    return true;
  } catch (err) {
    console.error('Redis: 连接失败，回退到内存存储 —', err.message);
    redisClient = null;
    enabled = false;
    return false;
  }
}

export async function loadAllRoomsFromStorage() {
  if (!enabled || !redisClient) return [];

  const ids = await redisClient.sMembers(ROOM_IDS_KEY);
  const rooms = [];

  for (const id of ids) {
    try {
      const raw = await redisClient.get(roomKey(id));
      if (!raw) continue;
      rooms.push(JSON.parse(raw));
    } catch (err) {
      console.error(`Redis: 跳过损坏的房间数据 ${id}:`, err.message);
    }
  }

  return rooms;
}

export async function saveRoomToStorage(roomSnapshot) {
  if (!enabled || !redisClient) return;

  const payload = JSON.stringify(roomSnapshot);
  try {
    await redisClient.set(roomKey(roomSnapshot.id), payload);
    await redisClient.sAdd(ROOM_IDS_KEY, roomSnapshot.id);
  } catch (err) {
    console.error(`Redis: 保存房间 ${roomSnapshot.id} 失败:`, err.message);
  }
}

/** 异步持久化，避免 JSON 序列化阻塞 HTTP / Socket 热路径 */
export function queueSaveRoomToStorage(roomSnapshot) {
  if (!enabled || !redisClient) return;

  setImmediate(() => {
    void saveRoomToStorage(roomSnapshot);
  });
}

export async function deleteRoomFromStorage(roomId) {
  if (!enabled || !redisClient) return;

  try {
    await redisClient.del(roomKey(roomId));
    await redisClient.sRem(ROOM_IDS_KEY, roomId);
  } catch (err) {
    console.error(`Redis: 删除房间 ${roomId} 失败:`, err.message);
  }
}
