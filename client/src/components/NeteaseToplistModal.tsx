import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import type { SearchResult } from '../types';
import { getNeteaseHotToplist } from '../api/music/toplist';
import SongResultList from './SongResultList';

interface Props {
  open: boolean;
  addingId: string | null;
  onClose: () => void;
  onAdd: (song: SearchResult) => void;
}

export default function NeteaseToplistModal({ open, addingId, onClose, onAdd }: Props) {
  const [title, setTitle] = useState('网易云热榜');
  const [songs, setSongs] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setSongs([]);
      setError('');
      setTitle('网易云热榜');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError('');
    getNeteaseHotToplist()
      .then((data) => {
        if (cancelled) return;
        setTitle(data.name || '网易云热榜');
        setSongs(data.songs);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '加载失败');
        setSongs([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-label="关闭"
      />
      <div className="relative w-full max-w-2xl max-h-[min(80vh,720px)] flex flex-col glass rounded-2xl border border-white/10 shadow-2xl animate-fade-in overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-netease-border/50 flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-semibold text-white truncate">{title}</h2>
            <p className="text-xs text-netease-muted mt-0.5">
              {loading ? '加载中...' : error ? error : `共 ${songs.length} 首`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
            aria-label="关闭"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-netease-muted">
              <Loader2 className="w-6 h-6 animate-spin mb-2" />
              <p className="text-sm">正在加载热榜...</p>
            </div>
          ) : error ? (
            <p className="text-center text-netease-muted py-16 text-sm">{error}</p>
          ) : songs.length === 0 ? (
            <p className="text-center text-netease-muted py-16 text-sm">暂无歌曲</p>
          ) : (
            <SongResultList
              results={songs}
              addingId={addingId}
              onAdd={onAdd}
              alwaysShowActions
            />
          )}
        </div>
      </div>
    </div>
  );
}
