const QFACE_BASE = `${import.meta.env.BASE_URL}qface/`;
const MANIFEST_URL = `${QFACE_BASE}manifest.json`;

export interface QFaceItem {
  id: string;
  text: string;
  url: string;
}

interface QFaceManifestEntry {
  id: string;
  text: string;
}

const POPULAR_FACE_IDS = ['0', '1', '2', '4', '5', '9', '13', '14', '21', '23', '27', '63'];

const POPULAR_LABELS: Record<string, string> = {
  '0': '/惊讶',
  '1': '/撇嘴',
  '2': '/色',
  '4': '/得意',
  '5': '/流泪',
  '9': '/大哭',
  '13': '/呲牙',
  '14': '/微笑',
  '21': '/偷笑',
  '23': '/酷',
  '27': '/奋斗',
  '63': '/玫瑰',
};

const QQ_FACE_TOKEN_RE = /\[qqface:([^\]]+)\]/g;

const preloadedImageUrls = new Set<string>();
const faceSubscribers = new Set<(faces: QFaceItem[]) => void>();

let fullFacesCache: QFaceItem[] | null = null;
let pendingFaces: Promise<QFaceItem[]> | null = null;

function faceUrl(id: string): string {
  return `${QFACE_BASE}${encodeURIComponent(id)}.apng`;
}

function buildPopularFaces(): QFaceItem[] {
  return POPULAR_FACE_IDS.map((id) => ({
    id,
    text: POPULAR_LABELS[id] || `/表情${id}`,
    url: faceUrl(id),
  }));
}

function toFaceItems(entries: QFaceManifestEntry[]): QFaceItem[] {
  return entries.map((entry) => ({
    id: entry.id,
    text: entry.text,
    url: faceUrl(entry.id),
  }));
}

function getDisplayFaces(): QFaceItem[] {
  return fullFacesCache || buildPopularFaces();
}

function notifyFaceSubscribers(): void {
  const faces = getDisplayFaces();
  faceSubscribers.forEach((callback) => callback(faces));
}

async function fetchLocalManifest(): Promise<QFaceItem[]> {
  const res = await fetch(MANIFEST_URL);
  if (!res.ok) throw new Error('本地表情 manifest 不存在');
  const data = (await res.json()) as QFaceManifestEntry[];
  const faces = toFaceItems(data.filter((entry) => entry?.id && entry?.text));
  if (faces.length <= POPULAR_FACE_IDS.length) throw new Error('本地表情 manifest 不完整');
  return faces;
}

async function loadLocalFaces(): Promise<QFaceItem[]> {
  const faces = await fetchLocalManifest();
  fullFacesCache = faces;
  notifyFaceSubscribers();
  return faces;
}

export function qqFaceToken(id: string): string {
  return `[qqface:${id}]`;
}

export function hasFullQQFaces(): boolean {
  return fullFacesCache !== null;
}

export function getInitialQQFaces(): QFaceItem[] {
  return getDisplayFaces();
}

export function subscribeQQFaces(callback: (faces: QFaceItem[]) => void): () => void {
  faceSubscribers.add(callback);
  callback(getDisplayFaces());
  return () => faceSubscribers.delete(callback);
}

export function preloadQQFaceImages(faces: QFaceItem[]): void {
  if (typeof Image === 'undefined') return;

  faces.forEach((face) => {
    if (preloadedImageUrls.has(face.url)) return;
    preloadedImageUrls.add(face.url);

    const image = new Image();
    image.decoding = 'async';
    image.src = face.url;
  });
}

export function parseQQFaceTokens(text: string): Array<string | { type: 'qqface'; id: string }> {
  const parts: Array<string | { type: 'qqface'; id: string }> = [];
  let lastIndex = 0;

  for (const match of text.matchAll(QQ_FACE_TOKEN_RE)) {
    if (match.index === undefined) continue;
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push({ type: 'qqface', id: match[1] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length ? parts : [text];
}

export async function loadQQFaces(): Promise<QFaceItem[]> {
  if (fullFacesCache) return fullFacesCache;
  if (pendingFaces) return pendingFaces;

  pendingFaces = loadLocalFaces()
    .catch(() => getDisplayFaces())
    .finally(() => {
      pendingFaces = null;
    });

  return pendingFaces;
}

export function ensureQQFacesLoaded(): void {
  if (fullFacesCache) return;
  void loadQQFaces();
}

export function initQQFaces(): void {
  void loadQQFaces();
}
