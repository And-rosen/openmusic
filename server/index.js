import './loadEnv.js';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import {
  createRoom,
  getRoomPublic,
  listRooms,
  listRoomIds,
  verifyRoomPassword,
  roomExists,
  initRooms,
  isRedisEnabled,
  persistRoomById,
  addUser,
  removeUser,
  renameUser,
  addToQueue,
  removeFromQueue,
  skipSong,
  finishCurrentSong,
  ensurePlayback,
  markRandomLoading,
  setPlaying,
  seekTo,
  getRoomInternal,
  requestJump,
  approveJump,
  rejectJump,
  requestSkip,
  approveSkip,
  rejectSkip,
  addChatMessage,
  advancePlaybackIfEnded,
  canUserMutate,
} from './roomManager.js';
import {
  isCyapiConfigured,
  searchQqMusic,
  searchKugouMusic,
  getKugouSongDetail,
} from './cyapi.js';
import { recordSongRequest, getHotSongs } from './songHotRank.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;
const METING_API_URL = (process.env.METING_API_URL || 'http://localhost:3000').replace(/\/$/, '');
const METING_API_AUTH = process.env.METING_API_AUTH || '';
const VMY_LRC_URL = (process.env.VMY_LRC_URL || 'https://api.52vmy.cn/api/music/lrc').replace(/\/$/, '');
const DISCONNECT_GRACE_MS = 1500;
const CLIENT_URL = (process.env.CLIENT_URL || '').replace(/\/$/, '');
const ALLOWED_ORIGINS = CLIENT_URL
  ? new Set(CLIENT_URL.split(',').map((origin) => origin.trim().replace(/\/$/, '')).filter(Boolean))
  : null;
const CLIENT_ID_SECRET = process.env.CLIENT_ID_SECRET || randomBytes(32).toString('hex');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (IS_PRODUCTION && !ALLOWED_ORIGINS) {
  console.warn('安全告警: NODE_ENV=production 但未配置 CLIENT_URL，浏览器跨域请求将被拒绝');
}

const app = express();
const httpServer = createServer(app);

function corsOrigin(origin, callback) {
  if (!origin) {
    callback(null, true);
    return;
  }

  if (!ALLOWED_ORIGINS) {
    callback(null, !IS_PRODUCTION);
    return;
  }

  callback(null, ALLOWED_ORIGINS.has(origin.replace(/\/$/, '')));
}

const io = new Server(httpServer, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
  },
});

app.use(cors({ origin: corsOrigin }));
app.use(express.json());

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeClientIp(raw) {
  let ip = String(raw || '').replace(/^::ffff:/, '').trim();
  if (!ip) return '';

  const v4WithPort = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (v4WithPort) return v4WithPort[1];

  return ip;
}

function getRequestIp(req) {
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = req.headers['x-forwarded-for'];
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const first = raw?.split(',')[0]?.trim() || req.headers['x-real-ip'] || req.ip || '';
    return normalizeClientIp(first);
  }
  return normalizeClientIp(req.socket?.remoteAddress || req.ip);
}

function getClientIp(socket) {
  if (process.env.TRUST_PROXY !== '1') {
    return normalizeClientIp(socket.handshake.address);
  }

  const forwarded = socket.handshake.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = raw?.split(',')[0]?.trim()
    || socket.handshake.headers['x-real-ip']
    || socket.handshake.address
    || '';
  return normalizeClientIp(first);
}

function isPrivateIp(ip) {
  return (
    !ip
    || ip === '::1'
    || ip === '127.0.0.1'
    || ip.startsWith('10.')
    || ip.startsWith('192.168.')
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
    || /^fc|^fd/i.test(ip)
  );
}

const VALID_SOURCES = new Set(['netease', 'tencent', 'kugou']);

function limitText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function createRateLimiter({ windowMs, max }) {
  const buckets = new Map();
  return (key) => {
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= max;
  };
}

const limitRoomCreate = createRateLimiter({ windowMs: 60_000, max: 20 });
const limitJoinAttempt = createRateLimiter({ windowMs: 60_000, max: 30 });
const limitProxyRequest = createRateLimiter({ windowMs: 60_000, max: 120 });
const limitSocketAction = createRateLimiter({ windowMs: 60_000, max: 90 });
const limitSocketChat = createRateLimiter({ windowMs: 60_000, max: 30 });
const limitSocketSync = createRateLimiter({ windowMs: 60_000, max: 45 });

function sanitizeClientSong(song) {
  if (!song || typeof song !== 'object') {
    return { error: '歌曲数据无效' };
  }

  const source = VALID_SOURCES.has(song.source) ? song.source : 'netease';
  const id = limitText(song.id, 128);
  const name = limitText(song.name, 100);
  const artist = limitText(song.artist, 100) || '未知歌手';

  if (!id || !name) {
    return { error: '歌曲数据缺少 id 或名称' };
  }

  const duration = Number(song.duration);
  const sanitized = {
    id,
    source,
    name,
    artist,
    album: limitText(song.album, 100) || undefined,
    pic: limitText(song.pic, 1000) || undefined,
    duration: Number.isFinite(duration) && duration > 0 && duration < 24 * 60 * 60 * 1000
      ? duration
      : undefined,
    lrc: limitText(song.lrc, 20000) || undefined,
  };

  // 播放 URL 必须由服务端可信 provider 解析，不能信任客户端直传。
  return { song: sanitized };
}

function buildMetingUrl(query) {
  const params = new URLSearchParams(query);
  if (METING_API_AUTH && !params.has('auth')) {
    params.set('auth', METING_API_AUTH);
  }
  return `${METING_API_URL}/api?${params.toString()}`;
}

async function proxyMetingResponse(targetUrl, res) {
  const response = await fetchWithTimeout(targetUrl, { redirect: 'manual' });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (location) return res.redirect(response.status, location);
  }

  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();

  if (contentType.includes('application/json') || text.startsWith('[') || text.startsWith('{')) {
    try {
      return res.json(JSON.parse(text));
    } catch {
      return res.type('text').send(text);
    }
  }

  return res.type('text').send(text);
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/music/hot', async (req, res) => {
  const limit = parseInt(String(req.query.limit || ''), 10);
  try {
    const songs = await getHotSongs(Number.isFinite(limit) ? limit : 20);
    res.json(songs);
  } catch (err) {
    console.error('Hot songs error:', err.message);
    res.status(500).json({ error: '获取热榜失败' });
  }
});

app.get('/api/music/sources', (_req, res) => {
  const sources = [
    {
      id: 'netease',
      name: '网易云音乐',
      shortName: '网易',
      color: '#ec4141',
      supportsSearch: true,
      supportsIdLookup: true,
    },
    {
      id: 'tencent',
      name: 'QQ音乐',
      shortName: 'QQ',
      color: '#31c27c',
      supportsSearch: isCyapiConfigured(),
      supportsIdLookup: false,
      description: isCyapiConfigured() ? '通过迟言 API 搜索' : '请配置 CYAPI_KEY',
    },
    {
      id: 'kugou',
      name: '酷狗音乐',
      shortName: '酷狗',
      color: '#2688ee',
      supportsSearch: isCyapiConfigured(),
      supportsIdLookup: false,
      description: isCyapiConfigured() ? '通过迟言 API 搜索' : '请配置 CYAPI_KEY',
    },
  ];
  res.json(sources);
});

app.get('/api/meting', async (req, res) => {
  if (!limitProxyRequest(`meting:${getRequestIp(req)}`)) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  try {
    await proxyMetingResponse(buildMetingUrl(req.query), res);
  } catch (err) {
    console.error('Meting proxy error:', err.message);
    res.status(502).json({ error: '无法连接 Meting API，请检查 METING_API_URL 配置' });
  }
});

/** HTTPS 站点下代理 http 音频/封面，避免浏览器混合内容警告 */
app.get('/api/media-proxy', async (req, res) => {
  if (!limitProxyRequest(`media:${getRequestIp(req)}`)) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  const raw = String(req.query.url || '').trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return res.status(400).json({ error: '无效地址' });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: '不支持的协议' });
  }

  if (isPrivateHostname(parsed.hostname)) {
    return res.status(403).json({ error: '禁止访问内网地址' });
  }

  try {
    const response = await fetchWithTimeout(raw, { redirect: 'follow' }, 20000);
    if (!response.ok) {
      return res.status(response.status).json({ error: '上游媒体请求失败' });
    }

    const contentType = response.headers.get('content-type');
    if (contentType) res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=3600');

    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error('Media proxy error:', err.message);
    res.status(502).json({ error: '媒体代理失败' });
  }
});

/** cyapi QQ 音乐搜索 */
app.get('/api/music/cyapi/search', async (req, res) => {
  if (!limitProxyRequest(`qq:${getRequestIp(req)}`)) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  if (!isCyapiConfigured()) {
    return res.status(503).json({ error: '未配置 CYAPI_KEY' });
  }

  const keyword = String(req.query.q || '').trim();
  const num = Math.min(Math.max(parseInt(String(req.query.num || '15'), 10) || 15, 1), 30);

  if (!keyword) return res.json([]);

  try {
    res.json(await searchQqMusic(keyword, num));
  } catch (err) {
    console.error('Cyapi QQ search error:', err.message);
    res.status(502).json({ error: 'QQ音乐搜索失败' });
  }
});

/** cyapi 酷狗音乐搜索 */
app.get('/api/music/cyapi/kugou/search', async (req, res) => {
  if (!limitProxyRequest(`kugou:${getRequestIp(req)}`)) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  if (!isCyapiConfigured()) {
    return res.status(503).json({ error: '未配置 CYAPI_KEY' });
  }

  const keyword = String(req.query.q || '').trim();
  const num = Math.min(Math.max(parseInt(String(req.query.num || '15'), 10) || 15, 1), 30);

  if (!keyword) return res.json([]);

  try {
    res.json(await searchKugouMusic(keyword, num));
  } catch (err) {
    console.error('Cyapi Kugou search error:', err.message);
    res.status(502).json({ error: '酷狗音乐搜索失败' });
  }
});

/** cyapi 酷狗音乐详情（播放链接、歌词） */
app.get('/api/music/cyapi/kugou/song', async (req, res) => {
  if (!limitProxyRequest(`kugou-song:${getRequestIp(req)}`)) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  if (!isCyapiConfigured()) {
    return res.status(503).json({ error: '未配置 CYAPI_KEY' });
  }

  const id = String(req.query.id || '').trim();
  if (!id) return res.status(400).json({ error: '缺少歌曲 id' });

  try {
    const detail = await getKugouSongDetail(id);
    if (!detail) return res.status(404).json({ error: '歌曲不存在' });
    res.json(detail);
  } catch (err) {
    console.error('Cyapi Kugou song error:', err.message);
    res.status(502).json({ error: '酷狗音乐获取失败' });
  }
});

/** 歌词备用：52vmy，按歌名搜索 */
app.get('/api/music/lrc-fallback', async (req, res) => {
  if (!limitProxyRequest(`lrc:${getRequestIp(req)}`)) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }

  const msg = String(req.query.msg || '').trim();
  const n = String(req.query.n || '1');
  if (!msg) return res.status(400).json({ error: '缺少歌曲名' });

  try {
    const params = new URLSearchParams({ msg, n });
    const response = await fetchWithTimeout(`${VMY_LRC_URL}?${params}`);
    if (!response.ok) {
      return res.status(502).json({ error: '歌词接口请求失败' });
    }
    const text = await response.text();
    res.type('text/plain; charset=utf-8').send(text);
  } catch (err) {
    console.error('LRC fallback error:', err.message);
    res.status(502).json({ error: '歌词获取失败' });
  }
});

app.get('/api/rooms', (_req, res) => {
  res.json(listRooms());
});

app.post('/api/rooms', (req, res) => {
  if (!limitRoomCreate(`room:${getRequestIp(req)}`)) {
    return res.status(429).json({ error: '创建房间过于频繁，请稍后再试' });
  }

  const name = req.body?.name;
  const password = req.body?.password;
  const room = createRoom({ name, password });
  res.json(room);
});

app.get('/api/rooms/:id', (req, res) => {
  const room = getRoomPublic(req.params.id);
  if (!room) return res.status(404).json({ error: '房间不存在' });
  res.json(room);
});

const clientDist = path.join(__dirname, '../client/dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) next();
  });
});

const socketToRoom = new Map();
const socketToUserId = new Map();

function isPrivateHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host || host === 'localhost') return true;
  if (host.endsWith('.local')) return true;
  return isPrivateIp(host);
}

function sanitizeClientId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{8,64}$/.test(id) ? id : '';
}

function signClientId(clientId) {
  return createHmac('sha256', CLIENT_ID_SECRET).update(clientId).digest('base64url');
}

function verifyClientToken(clientId, token) {
  const id = sanitizeClientId(clientId);
  const rawToken = String(token || '').trim();
  if (!id || !rawToken) return false;

  try {
    const expected = Buffer.from(signClientId(id));
    const actual = Buffer.from(rawToken);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function createServerClientId() {
  return randomBytes(18).toString('base64url');
}

function resolveUserIdentity(clientId, clientToken) {
  const id = sanitizeClientId(clientId);
  if (id && verifyClientToken(id, clientToken)) {
    return { userId: id, clientToken: signClientId(id) };
  }

  const userId = createServerClientId();
  return { userId, clientToken: signClientId(userId) };
}

function getSocketUserId(socket) {
  return socketToUserId.get(socket.id) || socket.id;
}

function rejectReadOnly(socket, callback) {
  const roomId = socketToRoom.get(socket.id);
  if (!roomId) {
    callback?.({ success: false, error: '未加入房间' });
    return true;
  }

  if (!canUserMutate(roomId, getSocketUserId(socket))) {
    callback?.({ success: false, error: '只读端无法执行此操作' });
    return true;
  }

  return false;
}

function rejectRateLimited(socket, limiter, kind, callback) {
  if (!limiter(`${kind}:${socket.id}`)) {
    callback?.({ success: false, error: '操作过于频繁，请稍后再试' });
    return true;
  }
  return false;
}

io.on('connection', (socket) => {
  socket.on('join_room', ({ roomId, nickname, password, readOnly, clientId, clientToken }, callback) => {
    const id = roomId?.toUpperCase();
    if (!roomExists(id)) {
      callback?.({ success: false, error: '房间不存在' });
      return;
    }

    const ip = getClientIp(socket);
    if (!limitJoinAttempt(`join:${ip}:${id}`)) {
      callback?.({ success: false, error: '尝试过于频繁，请稍后再试' });
      return;
    }

    const auth = verifyRoomPassword(id, password);
    if (!auth.ok) {
      callback?.({ success: false, error: auth.error, needsPassword: auth.needsPassword });
      return;
    }

    const prevRoomId = socketToRoom.get(socket.id);
    const prevUserId = getSocketUserId(socket);
    if (prevRoomId && prevRoomId !== id) {
      socket.leave(prevRoomId);
      const prevResult = removeUser(prevRoomId, prevUserId, socket.id);
      if (prevResult && !prevResult.empty) {
        io.to(prevRoomId).emit('room_update', prevResult);
      }
    }

    const { userId, clientToken: nextClientToken } = resolveUserIdentity(clientId, clientToken);

    // 同一连接再次加入同一房间，但解析出的用户身份不同（如身份令牌尚未持久化、
    // 快速重连或 StrictMode 重复挂载）：先移除旧的占位用户，避免一个浏览器出现多个用户。
    if (prevRoomId === id && prevUserId && prevUserId !== userId) {
      removeUser(id, prevUserId, socket.id);
    }

    const joinedRoom = addUser(id, userId, nickname, {
      readOnly: Boolean(readOnly),
      connectionId: socket.id,
    });
    if (!joinedRoom) {
      callback?.({ success: false, error: '加入房间失败' });
      return;
    }

    socketToRoom.set(socket.id, id);
    socketToUserId.set(socket.id, userId);
    socket.join(id);

    // 无当前歌曲且队列为空时，加入后会异步拉取随机歌曲，先告知客户端"加载中"，
    // 避免播放条在随机歌曲到达前直接消失。
    const roomPayload = markRandomLoading(id) || joinedRoom;

    io.to(id).emit('room_update', roomPayload);
    callback?.({
      success: true,
      room: roomPayload,
      socketId: userId,
      connectionId: socket.id,
      clientId: userId,
      clientToken: nextClientToken,
      isOwner: roomPayload.ownerId === userId && roomPayload.ownerConnectionId === socket.id,
    });

    ensurePlayback(id).then((room) => {
      if (room) io.to(id).emit('room_update', room);
    }).catch((err) => {
      console.error('Ensure playback after join failed:', err.message);
    });
  });

  socket.on('rename_user', ({ nickname }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'rename', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const userId = getSocketUserId(socket);
    const result = renameUser(roomId, userId, nickname);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    io.to(roomId).emit('room_update', result.room);
    callback?.({ success: true, room: result.room });
  });

  socket.on('leave_room', (_payload, callback) => {
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: true });
      return;
    }

    socket.leave(roomId);
    socketToRoom.delete(socket.id);
    const userId = getSocketUserId(socket);
    socketToUserId.delete(socket.id);
    const result = removeUser(roomId, userId, socket.id);
    if (result && !result.empty) {
      io.to(roomId).emit('room_update', result);
    }
    callback?.({ success: true });
  });

  socket.on('add_song', async ({ song }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'add_song', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const clean = sanitizeClientSong(song);
    if (clean.error) {
      callback?.({ success: false, error: clean.error });
      return;
    }

    const room = getRoomInternal(roomId);
    const userId = getSocketUserId(socket);
    const user = room?.users.get(userId);
    const result = await addToQueue(roomId, clean.song, {
      id: userId,
      nickname: user?.nickname || '匿名',
    });
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    io.to(roomId).emit('room_update', result.room);
    recordSongRequest(clean.song);
    callback?.({ success: true, room: result.room });
  });

  socket.on('remove_song', ({ queueId }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'remove_song', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = removeFromQueue(roomId, getSocketUserId(socket), queueId);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    io.to(roomId).emit('room_update', result.room);
    callback?.({ success: true, room: result.room });
  });

  socket.on('skip_song', async (_payload, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'skip_song', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = await skipSong(roomId, getSocketUserId(socket), socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    io.to(roomId).emit('room_update', result.room);
    callback?.({ success: true, room: result.room });
  });

  socket.on('finish_song', async ({ queueId }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'finish_song', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = await finishCurrentSong(roomId, getSocketUserId(socket), socket.id, String(queueId || ''));
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    io.to(roomId).emit('room_update', result.room);
    callback?.({ success: true, room: result.room });
  });

  socket.on('request_jump', ({ queueId }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'request_jump', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = requestJump(roomId, getSocketUserId(socket), queueId);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    io.to(roomId).emit('room_update', result.room);
    callback?.({ success: true, room: result.room });
  });

  socket.on('approve_jump', async ({ requestId }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'approve_jump', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = await approveJump(roomId, getSocketUserId(socket), requestId, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    io.to(roomId).emit('room_update', result.room);
    callback?.({ success: true, room: result.room });
  });

  socket.on('reject_jump', ({ requestId }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'reject_jump', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = rejectJump(roomId, getSocketUserId(socket), requestId, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    io.to(roomId).emit('room_update', result.room);
    callback?.({ success: true, room: result.room });
  });

  socket.on('request_skip', (_payload, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'request_skip', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = requestSkip(roomId, getSocketUserId(socket));
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    io.to(roomId).emit('room_update', result.room);
    callback?.({ success: true, room: result.room });
  });

  socket.on('approve_skip', async ({ requestId }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'approve_skip', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = await approveSkip(roomId, getSocketUserId(socket), requestId, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    io.to(roomId).emit('room_update', result.room);
    callback?.({ success: true, room: result.room });
  });

  socket.on('reject_skip', ({ requestId }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'reject_skip', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = rejectSkip(roomId, getSocketUserId(socket), requestId, socket.id);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    io.to(roomId).emit('room_update', result.room);
    callback?.({ success: true, room: result.room });
  });

  socket.on('send_chat', ({ text }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketChat, 'send_chat', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const result = addChatMessage(roomId, getSocketUserId(socket), text);
    if (result.error) {
      callback?.({ success: false, error: result.error });
      return;
    }

    io.to(roomId).emit('chat_message', result.message);
    io.to(roomId).emit('room_update', result.room);
    callback?.({ success: true, message: result.message });
  });

  socket.on('toggle_play', ({ isPlaying }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'toggle_play', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const updated = setPlaying(roomId, getSocketUserId(socket), isPlaying, socket.id);
    if (!updated) {
      callback?.({ success: false, error: '仅房主可暂停/播放' });
      return;
    }
    io.to(roomId).emit('room_update', updated);
    callback?.({ success: true, room: updated });
  });

  socket.on('seek', ({ time }, callback) => {
    if (rejectReadOnly(socket, callback)) return;
    if (rejectRateLimited(socket, limitSocketAction, 'seek', callback)) return;

    const roomId = socketToRoom.get(socket.id);
    if (!roomId) {
      callback?.({ success: false, error: '未加入房间' });
      return;
    }

    const updated = seekTo(roomId, getSocketUserId(socket), time, socket.id);
    if (!updated) {
      callback?.({ success: false, error: '仅房主可调节进度' });
      return;
    }
    io.to(roomId).emit('room_update', updated);
    callback?.({ success: true, room: updated });
  });

  socket.on('sync_time', ({ time }) => {
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) return;
    if (!limitSocketSync(`sync_time:${socket.id}`)) return;

    const nextTime = Number(time);
    if (!Number.isFinite(nextTime) || nextTime < 0) return;

    const room = getRoomInternal(roomId);
    if (!room || !room.isPlaying) return;
    if (room.ownerId !== getSocketUserId(socket) || room.ownerConnectionId !== socket.id) return;

    room.startedAt = Date.now() - nextTime * 1000;
    room.currentTime = nextTime;
    persistRoomById(roomId);
  });

  socket.on('disconnect', () => {
    const roomId = socketToRoom.get(socket.id);
    if (!roomId) return;

    const userId = getSocketUserId(socket);
    socketToRoom.delete(socket.id);
    socketToUserId.delete(socket.id);

    setTimeout(() => {
      const result = removeUser(roomId, userId, socket.id);
      if (result?.deleted || result?.empty) return;
      io.to(roomId).emit('room_update', result);
    }, DISCONNECT_GRACE_MS);
  });
});

let playbackTickRunning = false;

async function broadcastPlaybackState() {
  if (playbackTickRunning) return;
  playbackTickRunning = true;

  try {
    for (const roomId of listRoomIds()) {
      const internal = getRoomInternal(roomId);
      if (!internal?.isPlaying || !internal.current || internal.users.size === 0) continue;

      const advanced = await advancePlaybackIfEnded(roomId);
      if (advanced) {
        io.to(roomId).emit('room_update', advanced);
        continue;
      }

      const state = {
        currentTime: internal.startedAt
          ? (Date.now() - internal.startedAt) / 1000
          : internal.currentTime,
        isPlaying: true,
      };

      io.to(roomId).emit('playback_tick', state);
    }
  } finally {
    playbackTickRunning = false;
  }
}

setInterval(() => {
  void broadcastPlaybackState();
}, 250);

await initRooms();

httpServer.listen(PORT, () => {
  console.log(`🎵 OpenMusic 服务运行在 http://localhost:${PORT}`);
  console.log(`📡 Meting API: ${METING_API_URL}`);
  console.log(`🎤 Cyapi (QQ/酷狗): ${isCyapiConfigured() ? '已配置' : '未配置'}`);
  console.log(`💾 房间存储: ${isRedisEnabled() ? 'Redis' : '内存'}`);
});
