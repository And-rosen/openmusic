/**
 * 将第三方媒体 URL 转为同源 `/api/media-proxy`，供播放、Canvas、WebGL、fetch 使用。
 */

const MEDIA_PROXY_PATH = '/api/media-proxy';

export function isProxiedMediaUrl(url: string): boolean {
  if (!url) return false;
  return url.startsWith(`${MEDIA_PROXY_PATH}?`);
}

/** 从代理 URL 取出原始外链（测试/调试） */
export function unwrapProxiedMediaUrl(url: string): string {
  if (!isProxiedMediaUrl(url)) return url;
  const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
  return params.get('url') || url;
}

function isRelativeSameOriginUrl(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//');
}

function isInlineAssetUrl(url: string): boolean {
  return url.startsWith('data:') || url.startsWith('blob:');
}

/** 是否为本站同源、无需再包一层 media-proxy 的地址 */
export function isSameOriginMediaUrl(url: string): boolean {
  if (!url || isInlineAssetUrl(url) || isProxiedMediaUrl(url)) return true;
  if (isRelativeSameOriginUrl(url)) return true;
  if (typeof window === 'undefined') return false;
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin;
  } catch {
    return false;
  }
}

/** 是否需要走 media-proxy（外部 http/https） */
export function shouldProxyMediaUrl(url: string): boolean {
  if (!url || isSameOriginMediaUrl(url)) return false;
  return /^https?:\/\//i.test(url);
}

/**
 * 外部媒体一律走同源代理；本站 `/api/meting` 等相对路径保持原样。
 */
export function toProxiedMediaUrl(url: string): string {
  if (!url || !shouldProxyMediaUrl(url)) return url;
  return `${MEDIA_PROXY_PATH}?url=${encodeURIComponent(url)}`;
}

/**
 * @deprecated 请使用 toProxiedMediaUrl；保留别名兼容旧调用。
 */
export function toSecureMediaUrl(url: string): string {
  return toProxiedMediaUrl(url);
}

/** Canvas / WebGL / fetch 分析用，与 toProxiedMediaUrl 相同 */
export function toVisualMediaUrl(url: string): string {
  return toProxiedMediaUrl(url);
}

/** 沉浸式封面默认采样边长（对齐 Mineradio coverResolution 1.55 → 512） */
export const VISUAL_COVER_PIXEL_SIZE = 512;
