const CYAPI_BASE = (
  process.env.CYAPI_BASE
  || process.env.CYAPI_URL?.replace(/\/qq_music\.php$/i, '')
  || 'https://cyapi.top/API'
).replace(/\/$/, '');

const CYAPI_KEY = process.env.CYAPI_KEY || '';
const VMY_LRC_URL = (process.env.VMY_LRC_URL || 'https://api.52vmy.cn/api/music/lrc').replace(/\/$/, '');

export function isCyapiConfigured() {
  return Boolean(CYAPI_KEY);
}

export function getCyapiKey() {
  return CYAPI_KEY;
}

export function qqMusicEndpoint() {
  if (process.env.CYAPI_URL) {
    return process.env.CYAPI_URL.replace(/\/$/, '');
  }
  return `${CYAPI_BASE}/qq_music.php`;
}

export function kugouMusicEndpoint() {
  return `${CYAPI_BASE}/kugou_music.php`;
}

export function songListEndpoint() {
  return `${CYAPI_BASE}/song_list.php`;
}

export function wyrpEndpoint() {
  return `${CYAPI_BASE}/wyrp.php`;
}

const MAX_RANDOM_RETRIES = 20;
const LRC_TAIL_PADDING_MS = 20000;
const RANDOM_DURATION_TIMEOUT_MS = 4000;
const MP3_BITRATES = [
  null,
  32,
  40,
  48,
  56,
  64,
  80,
  96,
  112,
  128,
  160,
  192,
  224,
  256,
  320,
  null,
];

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 随机推荐是否可播放：歌名须含中文，排除纯英文/日文/韩文 */
function shouldPlayRandomSong(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return false;

  if (!/[\u4e00-\u9fff\u3400-\u4dbf]/.test(trimmed)) return false;
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(trimmed)) return false;
  if (/[\uac00-\ud7af\u1100-\u11ff]/.test(trimmed)) return false;

  return true;
}

function extractNeteaseIdFromLink(link) {
  const match = String(link || '').match(/[?&]id=(\d+)/);
  return match ? match[1] : '';
}

function normalizeDurationMs(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return undefined;
  const ms = duration < 10000 ? duration * 1000 : duration;
  return validateDurationMs(ms);
}

function validateDurationMs(value) {
  const ms = Number(value);
  return Number.isFinite(ms) && ms > 0 && ms < 24 * 60 * 60 * 1000
    ? Math.round(ms)
    : undefined;
}

function parseHeaderDurationMs(headers) {
  for (const name of ['x-content-duration', 'content-duration', 'duration']) {
    const value = headers.get(name);
    const ms = normalizeDurationMs(value);
    if (ms) return ms;
  }
  return undefined;
}

function getContentLength(headers) {
  const range = headers.get('content-range');
  const match = range?.match(/\/(\d+)$/);
  const total = Number(match?.[1]);
  if (Number.isFinite(total) && total > 0) return total;

  const direct = Number(headers.get('content-length'));
  return Number.isFinite(direct) && direct > 0 ? direct : 0;
}

function readSynchsafeInt(bytes, offset) {
  return (
    ((bytes[offset] & 0x7f) << 21)
    | ((bytes[offset + 1] & 0x7f) << 14)
    | ((bytes[offset + 2] & 0x7f) << 7)
    | (bytes[offset + 3] & 0x7f)
  );
}

function findMp3BitrateKbps(bytes) {
  let offset = 0;
  if (
    bytes.length > 10
    && bytes[0] === 0x49
    && bytes[1] === 0x44
    && bytes[2] === 0x33
  ) {
    offset = 10 + readSynchsafeInt(bytes, 6);
  }

  for (let i = offset; i + 4 < bytes.length; i++) {
    if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) continue;

    const versionBits = (bytes[i + 1] >> 3) & 0x03;
    const layerBits = (bytes[i + 1] >> 1) & 0x03;
    const bitrateIndex = (bytes[i + 2] >> 4) & 0x0f;
    if (versionBits !== 0x03 || layerBits !== 0x01) continue;

    const bitrate = MP3_BITRATES[bitrateIndex];
    if (bitrate) return bitrate;
  }

  return 0;
}

async function resolveMp3DurationMs(url) {
  if (!url) return undefined;

  try {
    const head = await fetchWithTimeout(url, { method: 'HEAD' }, RANDOM_DURATION_TIMEOUT_MS);
    if (head.ok) {
      const headerDuration = parseHeaderDurationMs(head.headers);
      if (headerDuration) return headerDuration;
    }

    const range = await fetchWithTimeout(
      url,
      { headers: { Range: 'bytes=0-65535' } },
      RANDOM_DURATION_TIMEOUT_MS,
    );
    if (!range.ok && range.status !== 206) return undefined;

    const headerDuration = parseHeaderDurationMs(range.headers);
    if (headerDuration) return headerDuration;

    const totalBytes = getContentLength(range.headers) || getContentLength(head.headers);
    if (!totalBytes) return undefined;

    const bytes = new Uint8Array(await range.arrayBuffer());
    const bitrateKbps = findMp3BitrateKbps(bytes);
    if (!bitrateKbps) return undefined;

    return validateDurationMs((totalBytes * 8) / bitrateKbps);
  } catch {
    return undefined;
  }
}

function getLrcFallbackDurationMs(lrc) {
  let lastTimeSec = 0;
  const regex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  for (const line of String(lrc || '').split('\n')) {
    let match;
    while ((match = regex.exec(line))) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = match[3] ? Number(`0.${match[3].padEnd(3, '0').slice(0, 3)}`) : 0;
      const time = minutes * 60 + seconds + fraction;
      if (Number.isFinite(time) && time > lastTimeSec) lastTimeSec = time;
    }
  }

  return lastTimeSec > 0 ? Math.round(lastTimeSec * 1000 + LRC_TAIL_PADDING_MS) : undefined;
}

async function fetchFallbackLrc(songName) {
  const msg = String(songName || '').trim();
  if (!msg) return '';

  try {
    const params = new URLSearchParams({ msg, n: '1' });
    const response = await fetchWithTimeout(`${VMY_LRC_URL}?${params}`, {}, RANDOM_DURATION_TIMEOUT_MS);
    if (!response.ok) return '';
    return await response.text();
  } catch {
    return '';
  }
}

async function resolveRandomDurationMs(song, raw) {
  const explicit = normalizeDurationMs(
    raw.duration ?? raw.time ?? raw.interval ?? raw.durationMs ?? raw.timeLength,
  );
  if (explicit) return explicit;

  const mp3Duration = await resolveMp3DurationMs(song.url);
  if (mp3Duration) return mp3Duration;

  const lrc = raw.lrc || raw.lyric || raw.lyrics || await fetchFallbackLrc(song.name);
  return getLrcFallbackDurationMs(lrc);
}

async function fetchRandomSongOnce() {
  try {
    const params = new URLSearchParams();
    if (CYAPI_KEY) params.set('apikey', CYAPI_KEY);
    const query = params.toString();
    const targetUrl = query ? `${wyrpEndpoint()}?${query}` : wyrpEndpoint();

    const response = await fetchWithTimeout(targetUrl);
    if (!response.ok) return null;

    const json = await response.json();
    if (!json.song || !json.url) return null;

    const id = extractNeteaseIdFromLink(json.link);
    if (!id) return null;

    return {
      id,
      source: 'netease',
      name: json.song || '未知歌曲',
      artist: json.singer || '未知歌手',
      album: '',
      pic: json.pic || '',
      url: json.url,
      raw: json,
    };
  } catch (err) {
    console.error('Random song API error:', err.message);
    return null;
  }
}

function randomSongKey(song) {
  return `netease:${song.id}`;
}

function resolveExcludeKeys(excludeKeys) {
  return typeof excludeKeys === 'function' ? excludeKeys() : excludeKeys;
}

/** 队列为空时随机推荐（迟言 wyrp 网易云热评） */
export async function fetchRandomSong(excludeKeys = new Set()) {
  // 随机歌曲允许重复，不再按已播记录排除
  // const exclude = resolveExcludeKeys(excludeKeys);
  // const maxRetries = Math.max(MAX_RANDOM_RETRIES, Math.min(exclude.size, 60));
  for (let i = 0; i < MAX_RANDOM_RETRIES; i++) {
    const song = await fetchRandomSongOnce();
    if (!song) continue;
    if (!shouldPlayRandomSong(song.name)) continue;
    // if (exclude.has(randomSongKey(song))) continue;

    const { raw, ...safeSong } = song;
    const duration = await resolveRandomDurationMs(safeSong, raw);
    return duration ? { ...safeSong, duration } : safeSong;
  }
  return null;
}

function withApiKey(params) {
  const search = new URLSearchParams(params);
  search.set('apikey', CYAPI_KEY);
  return search;
}

function normalizeQqSearchPayload(data) {
  let rawList = [];
  if (Array.isArray(data)) {
    rawList = data;
  } else if (Array.isArray(data?.list)) {
    rawList = data.list;
  } else if (Array.isArray(data?.data)) {
    rawList = data.data;
  } else if (Array.isArray(data?.data?.list)) {
    rawList = data.data.list;
  } else if (Array.isArray(data?.data?.song?.list)) {
    rawList = data.data.song.list;
  } else if (Array.isArray(data?.result?.list)) {
    rawList = data.result.list;
  } else if (data && !data.error) {
    rawList = [data];
  }

  return rawList
    .map(mapQqSearchItem)
    .filter(Boolean);
}

function extractQqSongId(item) {
  return String(
    item?.id
    || item?.mid
    || item?.songmid
    || item?.song_mid
    || item?.musicid
    || '',
  ).trim();
}

function extractQqSongName(item) {
  return String(
    item?.name
    || item?.songname
    || item?.song_name
    || item?.title
    || '',
  ).trim();
}

function extractQqArtists(item) {
  if (typeof item?.artists === 'string' && item.artists.trim()) {
    return [{ name: item.artists.trim() }];
  }
  if (Array.isArray(item?.artists) && item.artists.length > 0) {
    return item.artists.map((entry) => (
      typeof entry === 'string'
        ? { name: entry }
        : { name: entry?.name || entry?.title || '' }
    )).filter((a) => a.name);
  }
  if (item?.singer && typeof item.singer === 'object' && !Array.isArray(item.singer)) {
    const name = item.singer.name || item.singer.title || '';
    return name ? [{ name }] : [];
  }
  if (Array.isArray(item?.singer) && item.singer.length > 0) {
    return item.singer.map((entry) => (
      typeof entry === 'string' ? { name: entry } : { name: entry?.name || entry?.title || '' }
    ));
  }
  if (typeof item?.singer === 'string' && item.singer.trim()) {
    return [{ name: item.singer.trim() }];
  }
  if (typeof item?.singername === 'string' && item.singername.trim()) {
    return [{ name: item.singername.trim() }];
  }
  if (typeof item?.artist === 'string' && item.artist.trim()) {
    return [{ name: item.artist.trim() }];
  }
  return [];
}

function extractQqCover(item) {
  const cover = item?.cover;
  if (typeof cover === 'string' && cover.trim()) return cover.trim();
  if (cover && typeof cover === 'object') {
    return cover.medium || cover.large || cover.small || '';
  }
  return item.pic || item.album_pic || item.albumpic || item.albumimg || '';
}

function mapQqSearchItem(item) {
  if (!item || item.error) return null;

  const id = extractQqSongId(item);
  if (!id) return null;

  const artists = extractQqArtists(item);
  const albumRaw = item.album;
  const albumName = typeof albumRaw === 'string'
    ? albumRaw
    : albumRaw?.name || item.albumname || item.album_name || '';
  const coverUrl = extractQqCover(item);

  const durationRaw = Number(item.duration ?? item.interval ?? item.song_time ?? 0);
  const duration = Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : undefined;

  return {
    ...item,
    id,
    name: extractQqSongName(item) || '未知歌曲',
    artists: artists.length > 0 ? artists : [{ name: '未知歌手' }],
    album: albumName ? { name: albumName } : item.album,
    duration,
    cover: coverUrl || item.cover,
    pic: coverUrl || item.pic,
    url: item.url || item.music_url || item.play_url,
    lyric: item.lyric || item.lrc,
  };
}

async function runWithConcurrency(items, limit, worker) {
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      results.push(await worker(item));
    }
  });
  await Promise.all(workers);
  return results;
}

/** QQ 音乐搜索：优先单请求列表，必要时小并发拉取 n=1..num */
export async function searchQqMusic(keyword, num = 15) {
  const limit = Math.min(Math.max(num, 1), 30);
  const endpoint = qqMusicEndpoint();

  const baseParams = withApiKey({
    msg: keyword,
    num: String(limit),
    type: 'json',
  });

  try {
    const response = await fetchWithTimeout(`${endpoint}?${baseParams}`);
    const songs = normalizeQqSearchPayload(await response.json());
    if (songs.length > 0) return songs.slice(0, limit);
  } catch {
    // Fall back to the n-based API below.
  }

  const indexes = Array.from({ length: limit }, (_, i) => i + 1);
  const batches = await runWithConcurrency(indexes, 3, async (n) => {
    const params = withApiKey({
      msg: keyword,
      num: String(limit),
      type: 'json',
      n: String(n),
    });
    try {
      const response = await fetchWithTimeout(`${endpoint}?${params}`);
      return normalizeQqSearchPayload(await response.json());
    } catch {
      return [];
    }
  });

  return batches.flat().slice(0, limit);
}

/** QQ 音乐歌单：迟言 song_list.php */
export async function fetchQqPlaylistSongList(shareUrl) {
  const params = withApiKey({ url: shareUrl });
  const response = await fetchWithTimeout(`${songListEndpoint()}?${params}`, {}, 30000);
  const data = await response.json();
  if (!data || !Array.isArray(data.song_list)) {
    throw new Error('歌单解析失败');
  }
  return {
    total: Number(data.total_num) || data.song_list.length,
    songs: data.song_list,
  };
}

/** QQ 音乐：通过 mid 获取单曲详情 */
export async function getQqSongByMid(mid) {
  const id = String(mid || '').trim();
  if (!id) return null;

  const params = withApiKey({ mid: id, type: 'json' });
  const response = await fetchWithTimeout(`${qqMusicEndpoint()}?${params}`);
  const songs = normalizeQqSearchPayload(await response.json());
  return songs[0] || null;
}

/** 酷狗音乐搜索 */
export async function searchKugouMusic(keyword, limit = 15) {
  const params = withApiKey({ msg: keyword });
  const response = await fetchWithTimeout(`${kugouMusicEndpoint()}?${params}`);
  const data = await response.json();

  if (!data || data.code !== 200 || !Array.isArray(data.list)) {
    return [];
  }

  return data.list.slice(0, Math.min(Math.max(limit, 1), 30));
}

/** 酷狗音乐详情（播放链接、歌词、封面） */
export async function getKugouSongDetail(id) {
  const params = withApiKey({ id });
  const response = await fetchWithTimeout(`${kugouMusicEndpoint()}?${params}`);
  const data = await response.json();

  if (!data || data.code !== 200 || !data.data) {
    return null;
  }

  const detail = data.data;
  return {
    id,
    name: detail.songName || '',
    artist: detail.singerName || '',
    url: detail.url || '',
    pic: detail.albumImage || '',
    duration: detail.timeLength ? detail.timeLength * 1000 : undefined,
    lrc: detail.lyrics || '',
  };
}
