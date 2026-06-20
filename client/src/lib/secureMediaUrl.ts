/**
 * HTTPS 页面下将 http 媒体地址走同源代理，避免浏览器「部分内容不安全」警告。
 */
export function toSecureMediaUrl(url: string): string {
  if (!url) return url;
  if (typeof window === 'undefined' || window.location.protocol !== 'https:') return url;
  if (url.startsWith('/') || url.startsWith('data:') || url.startsWith('blob:')) return url;
  if (url.startsWith('https://')) return url;
  if (url.startsWith('http://')) {
    return `/api/media-proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}
