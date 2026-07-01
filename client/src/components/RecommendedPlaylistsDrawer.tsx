import { useEffect } from 'react';
import { X, Sparkles } from 'lucide-react';
import type { PlaylistSearchItem } from '../api/music/playlist';
import RecommendedPlaylistsPanel from './RecommendedPlaylistsPanel';

const PANEL_WIDTH = 360;

interface Props {
  open: boolean;
  onClose: () => void;
  onSelectPlaylist: (playlist: PlaylistSearchItem) => Promise<void>;
}

export default function RecommendedPlaylistsDrawer({ open, onClose, onSelectPlaylist }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleSelect = async (playlist: PlaylistSearchItem) => {
    await onSelectPlaylist(playlist);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 hidden lg:block">
      <button
        type="button"
        className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
        onClick={onClose}
        aria-label="关闭热榜歌单"
      />
      <aside
        className="absolute left-0 top-14 bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] flex flex-col border-r border-netease-border/50 bg-[#101012]/95 shadow-2xl backdrop-blur-xl animate-fade-in"
        style={{ width: PANEL_WIDTH, maxWidth: 'min(92vw, 360px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-netease-border/50 px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="h-4 w-4 flex-shrink-0 text-sky-400" />
            <h2 className="text-sm font-medium text-white">热榜歌单</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-netease-muted transition-colors hover:bg-white/10 hover:text-white"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <RecommendedPlaylistsPanel hideHeader onSelectPlaylist={handleSelect} />
        </div>
      </aside>
    </div>
  );
}
