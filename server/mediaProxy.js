import { Readable } from 'stream';

export const DEFAULT_MEDIA_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * 从上游拉取媒体并 pipe 给客户端，不 302 到第三方（避免浏览器跨域 / 混合内容）。
 * @param {import('express').Response} res
 * @param {(url: string, options?: object, timeoutMs?: number) => Promise<Response>} fetchWithTimeout
 */
export async function pipeUpstreamMedia(rawUrl, res, fetchWithTimeout, options = {}) {
  const headers = {
    'User-Agent': DEFAULT_MEDIA_UA,
    Accept: '*/*',
    ...(options.headers || {}),
  };

  const range = String(options.range || '').trim();
  if (range) headers.Range = range;

  let upstreamHost = '';
  try {
    upstreamHost = new URL(rawUrl).hostname;
  } catch {
    res.status(400).json({ error: '无效上游地址' });
    return false;
  }

  const response = await fetchWithTimeout(
    rawUrl,
    { headers, redirect: 'follow' },
    options.timeoutMs || 20000,
  );

  if (!response.ok) {
    res.status(response.status).json({ error: '上游媒体请求失败' });
    return false;
  }

  const contentType = response.headers.get('content-type');
  if (contentType) res.set('Content-Type', contentType);
  for (const header of ['accept-ranges', 'content-length', 'content-range']) {
    const value = response.headers.get(header);
    if (value) res.set(header, value);
  }

  res.set('Cache-Control', 'public, max-age=3600');
  res.set('X-OpenMusic-Proxy', '1');
  if (upstreamHost) res.set('X-OpenMusic-Upstream-Host', upstreamHost);

  res.status(response.status);
  if (response.body) {
    Readable.fromWeb(response.body).pipe(res);
  } else {
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  }
  return true;
}
