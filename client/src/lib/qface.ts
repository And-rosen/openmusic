const QFACE_BASE_URL = 'https://koishi.js.org/QFace/';
const QFACE_INDEX_URL = `${QFACE_BASE_URL}assets/qq_emoji/_index.json`;

export interface QFaceItem {
  id: string;
  text: string;
  url: string;
}

interface QFaceAsset {
  type: number;
  path: string;
}

interface QFaceIndexItem {
  emojiId: string;
  describe: string;
  isHide?: boolean;
  assets?: QFaceAsset[];
}

const POPULAR_QQ_FACES: QFaceItem[] = [
  { id: '0', text: '/惊讶', url: `${QFACE_BASE_URL}assets/qq_emoji/0/apng/0.png` },
  { id: '1', text: '/撇嘴', url: `${QFACE_BASE_URL}assets/qq_emoji/1/apng/1.png` },
  { id: '2', text: '/色', url: `${QFACE_BASE_URL}assets/qq_emoji/2/apng/2.png` },
  { id: '4', text: '/得意', url: `${QFACE_BASE_URL}assets/qq_emoji/4/apng/4.png` },
  { id: '5', text: '/流泪', url: `${QFACE_BASE_URL}assets/qq_emoji/5/apng/5.png` },
  { id: '9', text: '/大哭', url: `${QFACE_BASE_URL}assets/qq_emoji/9/apng/9.png` },
  { id: '13', text: '/呲牙', url: `${QFACE_BASE_URL}assets/qq_emoji/13/apng/13.png` },
  { id: '14', text: '/微笑', url: `${QFACE_BASE_URL}assets/qq_emoji/14/apng/14.png` },
  { id: '21', text: '/偷笑', url: `${QFACE_BASE_URL}assets/qq_emoji/21/apng/21.png` },
  { id: '23', text: '/酷', url: `${QFACE_BASE_URL}assets/qq_emoji/23/apng/23.png` },
  { id: '27', text: '/奋斗', url: `${QFACE_BASE_URL}assets/qq_emoji/27/apng/27.png` },
  { id: '63', text: '/玫瑰', url: `${QFACE_BASE_URL}assets/qq_emoji/63/apng/63.png` },
];

const QQ_FACE_TOKEN_RE = /\[qqface:([^\]]+)\]/g;
let cachedFaces: QFaceItem[] | null = null;
let pendingFaces: Promise<QFaceItem[]> | null = null;
const preloadedImageUrls = new Set<string>();

function toAbsoluteUrl(path: string): string {
  return new URL(path, QFACE_BASE_URL).toString();
}

function toQFaceItem(item: QFaceIndexItem): QFaceItem | null {
  if (item.isHide) return null;

  const asset = item.assets?.find((entry) => entry.type === 2)
    || item.assets?.find((entry) => entry.type === 0)
    || item.assets?.[0];
  if (!item.emojiId || !item.describe || !asset?.path) return null;

  return {
    id: item.emojiId,
    text: item.describe,
    url: toAbsoluteUrl(asset.path),
  };
}

export function qqFaceToken(id: string): string {
  return `[qqface:${id}]`;
}

export function getInitialQQFaces(): QFaceItem[] {
  return cachedFaces || POPULAR_QQ_FACES;
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
  if (cachedFaces) return cachedFaces;
  if (pendingFaces) return pendingFaces;

  pendingFaces = (async () => {
    const res = await fetch(QFACE_INDEX_URL);
    if (!res.ok) throw new Error('QFace index failed');
    const data = (await res.json()) as QFaceIndexItem[];
    const faces = data.map(toQFaceItem).filter((face): face is QFaceItem => Boolean(face));
    cachedFaces = faces.length ? faces : POPULAR_QQ_FACES;
    return cachedFaces;
  })().catch(() => {
    cachedFaces = POPULAR_QQ_FACES;
    return cachedFaces;
  }).finally(() => {
    pendingFaces = null;
  });

  return pendingFaces;
}
