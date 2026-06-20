import { useState, useEffect, useCallback } from 'react';

import { useParams, useNavigate, useLocation } from 'react-router-dom';

import { Search, Loader2, Copy, Check, Crown, Tv, LogOut } from 'lucide-react';

import { searchAllSongs, getAvailableSources } from '../api/music';

import type { SearchResult } from '../types';

import type { MusicProviderMeta } from '../api/music/types';

import { useRoomStore } from '../stores/roomStore';

import { useSocket } from '../hooks/useSocket';
import { createRandomNickname } from '../lib/randomNickname';

import { songKey } from '../api/music';

import QueuePanel from '../components/QueuePanel';

import MiniPlayer from '../components/MiniPlayer';

import PlayerPage from '../components/PlayerPage';

import OnlineUsers from '../components/OnlineUsers';

import AudioEngine from '../components/AudioEngine';

import SongResultList from '../components/SongResultList';
import SearchSkeleton from '../components/SearchSkeleton';
import ChatPanel from '../components/ChatPanel';
import HotSongPanel from '../components/HotSongPanel';

import JumpRequestBanner from '../components/JumpRequestBanner';
import Toast from '../components/Toast';
import { copyToClipboard } from '../lib/copyToClipboard';


function roomPasswordKey(roomId: string) {
  return `openmusic:room-password:${roomId.toUpperCase()}`;
}

function getStoredRoomPassword(roomId: string | undefined) {
  if (!roomId) return undefined;
  try {
    return sessionStorage.getItem(roomPasswordKey(roomId)) || undefined;
  } catch {
    return undefined;
  }
}

function rememberRoomPassword(roomId: string, password?: string) {
  if (!password?.trim()) return;
  try {
    sessionStorage.setItem(roomPasswordKey(roomId), password.trim());
  } catch {
    // sessionStorage may be unavailable in private browsing.
  }
}


export default function Room() {

  const { roomId } = useParams<{ roomId: string }>();

  const navigate = useNavigate();

  const location = useLocation();

  const roomPassword = (location.state as { password?: string } | null)?.password || getStoredRoomPassword(roomId);

  const { room, showPlayer, setShowPlayer, isOwner } = useRoomStore();

  const { joinRoom, addSong, leaveRoom } = useSocket();



  const [sources, setSources] = useState<MusicProviderMeta[]>([]);

  const [query, setQuery] = useState('');

  const [results, setResults] = useState<SearchResult[]>([]);

  const [searching, setSearching] = useState(false);

  const [joinError, setJoinError] = useState('');

  const [addingId, setAddingId] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);
  const [tvCopied, setTvCopied] = useState(false);
  const [searchedKeyword, setSearchedKeyword] = useState('');
  const [dedupeCrossSource, setDedupeCrossSource] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [hotRefreshKey, setHotRefreshKey] = useState(0);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  }, []);

  const closeToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    let redirectTimer: number | undefined;

    let nick = useRoomStore.getState().nickname.trim();
    if (!nick) {
      nick = createRandomNickname();
      useRoomStore.getState().setNickname(nick);
    }

    joinRoom(roomId, nick, roomPassword).then((res) => {
      if (cancelled) return;
      if (!res.success) {
        setJoinError(res.error || '加入房间失败');
        redirectTimer = window.setTimeout(() => navigate('/'), 2000);
        return;
      }

      rememberRoomPassword(roomId, roomPassword);
    });

    return () => {
      cancelled = true;
      if (redirectTimer) window.clearTimeout(redirectTimer);
      // 刷新/关闭页面时不主动 leave，避免房间被暂停；依赖 socket 断开与重连
    };
  }, [roomId, roomPassword, joinRoom, leaveRoom, navigate]);

  useEffect(() => {
    getAvailableSources().then(setSources);
  }, []);

  const doSearch = useCallback(async (keyword: string, dedupe = dedupeCrossSource) => {

    if (!keyword.trim()) {

      setResults([]);

      return;

    }

    setSearching(true);

    try {

      const songs = await searchAllSongs(keyword, sources, { dedupeCrossSource: dedupe });

      setResults(songs);

    } catch {

      setResults([]);

    } finally {

      setSearching(false);

    }

  }, [sources, dedupeCrossSource]);

  const handleSearch = useCallback(() => {
    const keyword = query.trim();
    setSearchedKeyword(keyword);
    doSearch(keyword);
  }, [query, doSearch]);

  const handleAdd = async (song: SearchResult) => {
    const key = songKey(song);
    setAddingId(key);
    const res = await addSong({
      id: song.id,
      source: song.source,
      name: song.name,
      artist: song.artist,
      album: song.album,
      pic: song.pic,
      duration: song.duration,
      url: song.url,
      lrc: song.lrc,
    });
    setAddingId(null);
    if (res.success) {
      showToast('点歌成功', 'success');
      setHotRefreshKey((k) => k + 1);
    } else if (res.error) {
      showToast(res.error, 'error');
    }
  };



  const handleCopyRoom = async () => {
    const url = `${window.location.origin}/room/${room?.id}`;
    const ok = await copyToClipboard(url);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      showToast('复制失败，请手动复制地址栏链接', 'error');
    }
  };

  const handleCopyTvLink = async () => {
    const url = `${window.location.origin}/tv/${room?.id}`;
    const ok = await copyToClipboard(url);
    if (ok) {
      setTvCopied(true);
      setTimeout(() => setTvCopied(false), 2000);
    } else {
      showToast('复制失败，请手动复制地址栏链接', 'error');
    }
  };



  if (joinError) {

    return (

      <div className="min-h-full flex items-center justify-center">

        <p className="text-netease-red">{joinError}，正在返回...</p>

      </div>

    );

  }



  if (!room) {

    return (

      <div className="min-h-full flex items-center justify-center">

        <Loader2 className="w-8 h-8 text-netease-red animate-spin" />

      </div>

    );

  }



  const searchableCount = sources.filter((s) => s.supportsSearch).length;



  return (

    <div className="h-full flex flex-col overflow-hidden">

      <AudioEngine />

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={closeToast}
        />
      )}

      <header className="glass flex-shrink-0 z-30 border-b border-netease-border/50 px-3 sm:px-4 py-2.5 sm:py-3 safe-top">

        <div className="max-w-7xl mx-auto flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">

          <div className="flex items-center justify-between gap-2 min-w-0">

            <div className="min-w-0">

              <div className="flex items-center gap-2">

                <h1 className="text-base sm:text-lg font-semibold truncate">

                  <span className="truncate">{room.name}</span>

                </h1>

                {isOwner && (

                  <span className="flex items-center gap-0.5 text-[10px] text-amber-400/90 bg-amber-400/10 px-1.5 py-0.5 rounded-full flex-shrink-0">

                    <Crown className="w-3 h-3" />

                    房主

                  </span>

                )}

              </div>

              <p className="text-xs text-netease-muted mt-0.5">
                房间号 <span className="text-netease-red">{room.id}</span>
              </p>

              <p className="text-xs text-netease-muted">{room.userCount} 人在线</p>

            </div>

            <div className="sm:hidden flex-shrink-0">

              <OnlineUsers users={room.users} ownerId={room.ownerId} creatorId={room.creatorId} />

            </div>

          </div>

          <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-3">

            <div className="flex items-center gap-1 sm:gap-2">

              <button

                onClick={handleCopyTvLink}

                className="flex items-center gap-1.5 text-xs text-netease-muted hover:text-white transition-colors px-2.5 sm:px-3 py-1.5 rounded-lg hover:bg-netease-card"

                title="电视投屏"

              >

                {tvCopied ? <Check className="w-4 h-4 text-green-400" /> : <Tv className="w-4 h-4" />}

                <span className="hidden sm:inline">{tvCopied ? '已复制' : '电视投屏'}</span>

              </button>

              <button

                onClick={handleCopyRoom}

                className="flex items-center gap-1.5 text-xs text-netease-muted hover:text-white transition-colors px-2.5 sm:px-3 py-1.5 rounded-lg hover:bg-netease-card"

                title="分享房间"

              >

                {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}

                <span className="hidden sm:inline">{copied ? '已复制' : '分享房间'}</span>

              </button>

              <button
                onClick={() => {
                  leaveRoom();
                  navigate('/');
                }}
                className="flex items-center gap-1.5 text-xs text-netease-muted hover:text-white transition-colors px-2.5 sm:px-3 py-1.5 rounded-lg hover:bg-netease-card"
                title="退出房间"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">退出房间</span>
              </button>

            </div>

            <div className="hidden sm:block">

              <OnlineUsers users={room.users} ownerId={room.ownerId} creatorId={room.creatorId} />

            </div>

          </div>

        </div>

      </header>



      <div className="flex-1 min-h-0 max-w-7xl mx-auto w-full px-3 sm:px-4 pt-3 sm:pt-4 pb-[calc(4.75rem+env(safe-area-inset-bottom,0px))] overflow-y-auto lg:overflow-hidden">

        <div className="flex flex-col lg:grid lg:grid-cols-[240px_1fr_300px] lg:h-full lg:min-h-0 gap-3 lg:gap-4">

          {/* 点歌热榜 — 桌面左侧 */}
          <div className="hidden lg:flex flex-col order-0 lg:min-h-0 lg:overflow-hidden">
            <HotSongPanel addingId={addingId} onAdd={handleAdd} refreshKey={hotRefreshKey} />
          </div>

          {/* 点歌搜索 — 中间；手机端热榜在上方 */}
          <div className="min-w-0 order-1 flex flex-col lg:min-h-0 lg:overflow-hidden">
            <div className="lg:hidden mb-3">
              <HotSongPanel compact addingId={addingId} onAdd={handleAdd} refreshKey={hotRefreshKey} />
            </div>
            <JumpRequestBanner />

            <div className="flex gap-2 mb-2">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 w-4 sm:w-5 h-4 sm:h-5 text-netease-muted pointer-events-none" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="搜索歌曲、歌手..."
                  className={`w-full bg-netease-card border border-netease-border rounded-xl sm:rounded-2xl pl-10 sm:pl-12 py-3 sm:py-3.5 text-sm sm:text-base text-white placeholder:text-netease-muted/50 focus:outline-none focus:border-netease-red/50 transition-colors ${
                    searchableCount > 0 ? 'pr-[8.25rem] sm:pr-[8.75rem]' : 'pr-4'
                  }`}
                />
                {searchableCount > 0 && (
                  <div className="absolute right-2.5 sm:right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
                    <span
                      className={`text-[11px] sm:text-xs whitespace-nowrap transition-colors ${
                        dedupeCrossSource ? 'text-white/80' : 'text-netease-muted'
                      }`}
                    >
                      智能去重
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={dedupeCrossSource}
                      aria-label="跨平台去重"
                      title="跨平台去重：歌名与歌手相同视为同一首"
                      onClick={() => {
                        const next = !dedupeCrossSource;
                        setDedupeCrossSource(next);
                        if (searchedKeyword.trim()) {
                          doSearch(searchedKeyword, next);
                        }
                      }}
                      className={`pointer-events-auto relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-netease-red/50 ${
                        dedupeCrossSource ? 'bg-netease-red' : 'bg-white/15'
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`pointer-events-none absolute top-0.5 left-0.5 inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out ${
                          dedupeCrossSource ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={handleSearch}
                disabled={searching || !query.trim()}
                className="flex-shrink-0 px-3.5 sm:px-5 py-3 sm:py-3.5 rounded-xl sm:rounded-2xl bg-netease-red text-white text-sm font-medium hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4 sm:hidden" />}
                <span className="hidden sm:inline">搜索</span>
              </button>
            </div>

            {searchableCount > 0 && (
              <p className="text-xs text-netease-muted mb-2 sm:mb-4 px-1">
                同时搜索 {sources.filter((s) => s.supportsSearch).map((s) => s.shortName).join('、')}
              </p>
            )}

            <div className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
              {searching && searchedKeyword && (
                <SearchSkeleton />
              )}

              {!searching && searchedKeyword && results.length === 0 && (
                <p className="text-center text-netease-muted py-6 sm:py-8 animate-fade-in">没有找到相关歌曲</p>
              )}

              {!searching && (
                <SongResultList
                  results={results}
                  addingId={addingId}
                  onAdd={handleAdd}
                  keyword={searchedKeyword}
                />
              )}
            </div>
          </div>

          {/* 播放队列 + 聊天室 — 右侧 */}
          <div className="order-2 flex flex-col gap-3 lg:self-stretch lg:min-h-0">
            <div className="bg-netease-card/30 border border-netease-border/50 rounded-2xl overflow-hidden flex flex-col flex-shrink-0">
              <div className="flex items-center justify-between px-4 py-2.5 sm:py-3 border-b border-netease-border/50 flex-shrink-0">
                <h2 className="text-sm font-medium">播放队列</h2>
                <span className="text-xs text-netease-muted">
                  {(room.current ? 1 : 0) + room.queue.length > 0
                    ? `共 ${(room.current ? 1 : 0) + room.queue.length} 首`
                    : '暂无歌曲'}
                </span>
              </div>
              <div className="p-2">
                <QueuePanel />
              </div>
            </div>

            <div className="flex-shrink-0 h-[300px] sm:h-[320px] lg:flex-1 lg:min-h-0 lg:h-auto">
              <ChatPanel />
            </div>
          </div>

        </div>

      </div>



      {room.current ? (

        <MiniPlayer onExpand={() => setShowPlayer(true)} />

      ) : room.randomLoading ? (

        <div className="fixed bottom-0 left-0 right-0 z-40 glass border-t border-netease-border/50 pb-[env(safe-area-inset-bottom,0px)]">
          <div className="max-w-5xl mx-auto flex items-center gap-3 px-3 sm:px-4 py-3.5 sm:py-4">
            <Loader2 className="w-5 h-5 text-netease-red animate-spin flex-shrink-0" />
            <p className="text-sm text-netease-muted">正在加载随机歌曲...</p>
          </div>
        </div>

      ) : null}



      {showPlayer && room.current && (

        <PlayerPage onClose={() => setShowPlayer(false)} />

      )}

    </div>

  );

}


