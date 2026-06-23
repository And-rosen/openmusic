import type { SearchResult } from '../../types';
import { fetchWithTimeout } from '../http';

export interface NeteaseToplistResult {
  id: string;
  name: string;
  songs: SearchResult[];
}

export async function getNeteaseHotToplist(limit = 200): Promise<NeteaseToplistResult> {
  const res = await fetchWithTimeout(`/api/music/toplist/netease?limit=${limit}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || '获取网易云热榜失败');
  }
  return res.json();
}
