import { useState, useEffect, useCallback } from 'react';

import { useParams, useNavigate, useLocation } from 'react-router-dom';

import { Search, Loader2, Copy, Check, Crown, Tv, LogOut, X } from 'lucide-react';

import { searchAllSongs, getAvailableSources, type SearchFilterMode } from '../api/music';
import { importPlaylist, type PlaylistPlatform } from '../api/music/playlist';

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
import SearchFilterSelect from '../components/SearchFilterSelect';
import SearchSkeleton from '../components/SearchSkeleton';
import PlaylistImportModal from '../components/PlaylistImportModal';
import NeteaseToplistModal from '../components/NeteaseToplistModal';
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

  const { room, showPlayer, setShowPlayer, isOwner, exitReason } = useRoomStore();

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
  const [searchFilterMode, setSearchFilterMode] = useState<SearchFilterMode>('smart');
  const [playlistImportOpen, setPlaylistImportOpen] = useState(false);
  const [neteaseToplistOpen, setNeteaseToplistOpen] = useState(false);
  const [isPlaylistResults, setIsPlaylistResults] = useState(false);
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
    if (!exitReason) return;
    const redirectTimer = window.setTimeout(() => navigate('/'), 2500);
    return () => window.clearTimeout(redirectTimer);
  }, [exitReason, navigate]);

  useEffect(() => {
    getAvailableSources().then(setSources);
  }, []);

  const doSearch = useCallback(async (keyword: string, filterMode = searchFilterMode) => {

    if (!keyword.trim()) {

      setResults([]);

      return;

    }

    setSearching(true);

    try {

      const songs = await searchAllSongs(keyword, sources, { filterMode });

      setResults(songs);

    } catch {

      setResults([]);

    } finally {

      setSearching(false);

    }

  }, [sources, searchFilterMode]);

  const handleSearchFilterChange = useCallback((next: SearchFilterMode) => {
    if (isPlaylistResults) return;
    setSearchFilterMode(next);
    if (searchedKeyword.trim()) {
      doSearch(searchedKeyword, next);
    }
  }, [isPlaylistResults, searchedKeyword, doSearch]);

  const handlePlaylistImport = useCallback(async (platform: PlaylistPlatform, input: string) => {
    setPlaylistImportOpen(false);
    setSearching(true);
    setIsPlaylistResults(true);
    setSearchedKeyword(`正在解析${platform === 'netease' ? '网易云' : 'QQ音乐'}歌单…`);
    setResults([]);

    try {
      const result = await importPlaylist(platform, input);
      setResults(result.songs);
      setSearchedKeyword(`歌单：${result.name}`);

      if (result.songs.length === 0) {
        showToast('歌单为空或歌曲无法解析', 'error');
      } else if (result.failed && result.failed > 0) {
        showToast(`已解析 ${result.songs.length} 首，${result.failed} 首失败，请自选点歌`, 'success');
      } else {
        showToast(`已解析 ${result.songs.length} 首，请在结果中自选点歌`, 'success');
      }
    } catch (err) {
      setResults([]);
      setSearchedKeyword('');
      setIsPlaylistResults(false);
      showToast(err instanceof Error ? err.message : '歌单解析失败', 'error');
    } finally {
      setSearching(false);
    }
  }, [showToast]);

  const handleSearch = useCallback(() => {
    const keyword = query.trim();
    setIsPlaylistResults(false);
    setSearchedKeyword(keyword);
    doSearch(keyword);
  }, [query, doSearch]);

  const clearSearchResults = useCallback(() => {
    setQuery('');
    setResults([]);
    setSearchedKeyword('');
    setIsPlaylistResults(false);
  }, []);

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

  if (exitReason) {

    return (

      <div className="min-h-full flex items-center justify-center px-6 text-center">

        <p className="text-netease-red">{exitReason}，正在返回...</p>

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
  const qqImportEnabled = sources.some((s) => s.id === 'tencent' && s.supportsSearch);
  const queueCount = (room.current ? 1 : 0) + room.queue.length;
  const showDesktopSearchOverlay = Boolean(searchedKeyword || searching);

  const renderResultsSummary = () => {
    if (searching) {
      return isPlaylistResults ? searchedKeyword : `正在搜索「${searchedKeyword}」...`;
    }
    if (results.length === 0) {
      return isPlaylistResults ? '歌单为空或链接无效' : `「${searchedKeyword}」无相关结果`;
    }
    if (isPlaylistResults) {
      const name = searchedKeyword.replace(/^歌单：/, '');
      return `「${name}」共 ${results.length} 首，请自选点歌`;
    }
    return `找到 ${results.length} 首相关歌曲`;
  };

  const renderQueueSection = (fillHeight = false) => (
    <div
      className={`bg-netease-card/30 border border-netease-border/50 rounded-2xl overflow-hidden flex flex-col ${
        fillHeight ? 'h-full flex-1 min-h-0' : 'flex-shrink-0'
      }`}
    >
      <div className="flex items-center justify-between px-4 py-2.5 sm:py-3 border-b border-netease-border/50 flex-shrink-0">
        <h2 className="text-sm font-medium">播放队列</h2>
        <span className="text-xs text-netease-muted">
          {queueCount > 0 ? `共 ${queueCount} 首` : '暂无歌曲'}
        </span>
      </div>
      <div className={`p-2 ${fillHeight ? 'flex-1 min-h-0 overflow-hidden flex flex-col' : ''}`}>
        <QueuePanel fillHeight={fillHeight} />
      </div>
    </div>
  );

  const searchBar = (
    <div className="flex gap-2 mb-2">
      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 w-4 sm:w-5 h-4 sm:h-5 text-netease-muted pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="搜索歌曲、歌手..."
          className="w-full bg-netease-card border border-netease-border rounded-xl sm:rounded-2xl pl-10 sm:pl-12 pr-4 py-3 sm:py-3.5 text-sm sm:text-base text-white placeholder:text-netease-muted/50 focus:outline-none focus:border-netease-red/50 transition-colors"
        />
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
  );



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

              <OnlineUsers
                users={room.users}
                ownerId={room.ownerId}
                creatorId={room.creatorId}
                onNotice={showToast}
              />

            </div>

          </div>

          <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-3">

            <div className="flex items-center gap-1 sm:gap-2">

              <button

                onClick={handleCopyTvLink}

                className="flex items-center gap-1.5 text-xs text-netease-muted hover:text-white transition-colors px-2.5 sm:px-3 py-1.5 rounded-lg hover:bg-netease-card"

                title="TV歌词"

              >

                {tvCopied ? <Check className="w-4 h-4 text-green-400" /> : <Tv className="w-4 h-4" />}

                <span className="hidden sm:inline">{tvCopied ? '已复制' : 'TV歌词'}</span>

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

              <OnlineUsers
                users={room.users}
                ownerId={room.ownerId}
                creatorId={room.creatorId}
                onNotice={showToast}
              />

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
          <div className="min-w-0 order-1 flex flex-col lg:min-h-0 lg:h-full lg:overflow-hidden">
            <div className="lg:hidden mb-3">
              <HotSongPanel compact addingId={addingId} onAdd={handleAdd} refreshKey={hotRefreshKey} />
            </div>

            <div className="flex-shrink-0">
              <JumpRequestBanner />
              {searchBar}
              {searchableCount > 0 && (
                <div className="flex items-center justify-between gap-2 mb-2 sm:mb-4 px-1">
                  <p className="text-xs text-netease-muted min-w-0">
                    同时搜索 {sources.filter((s) => s.supportsSearch).map((s) => s.shortName).join('、')}
                  </p>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => setNeteaseToplistOpen(true)}
                      className="rounded-lg px-2 py-1 text-[11px] sm:text-xs text-white/75 hover:bg-white/10 hover:text-white transition-colors whitespace-nowrap"
                    >
                      网易云热榜
                    </button>
                    <button
                      type="button"
                      onClick={() => setPlaylistImportOpen(true)}
                      className="rounded-lg px-2 py-1 text-[11px] sm:text-xs text-white/75 hover:bg-white/10 hover:text-white transition-colors whitespace-nowrap"
                    >
                      导入歌单
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 桌面：播放队列撑满剩余高度，底部与热榜对齐 */}
            <div className="hidden lg:flex flex-1 min-h-0 flex-col mt-1">
              {renderQueueSection(true)}
            </div>

            {/* 手机：搜索结果内联展示（保持原样） */}
            <div className="lg:hidden">
              {searching && searchedKeyword && <SearchSkeleton />}

              {!searching && searchedKeyword && (
                <div className="flex items-center justify-between mb-2 px-1 gap-2">
                  <span className="text-xs text-netease-muted min-w-0 truncate">
                    {renderResultsSummary()}
                  </span>
                  <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                    {searchableCount > 0 && !isPlaylistResults && (
                      <SearchFilterSelect value={searchFilterMode} onChange={handleSearchFilterChange} />
                    )}
                    <button
                      type="button"
                      onClick={clearSearchResults}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-netease-muted hover:bg-white/10 hover:text-white transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                      清空
                    </button>
                  </div>
                </div>
              )}

              {!searching && searchedKeyword && results.length === 0 && (
                <p className="text-center text-netease-muted py-4 sm:py-6 animate-fade-in">
                  {isPlaylistResults ? '歌单为空或链接无效' : '换个关键词试试'}
                </p>
              )}

              {!searching && searchedKeyword && (
                <SongResultList
                  results={results}
                  addingId={addingId}
                  onAdd={handleAdd}
                  keyword={searchedKeyword}
                />
              )}
            </div>
          </div>

          {/* 右侧：桌面仅聊天室；手机保持队列 + 聊天 */}
          <div className="order-2 flex flex-col gap-3 lg:self-stretch lg:min-h-0">
            <div className="lg:hidden">
              {renderQueueSection()}
            </div>

            <div className="flex-shrink-0 h-[300px] sm:h-[320px] lg:flex-1 lg:min-h-0 lg:h-auto">
              <ChatPanel />
            </div>
          </div>

        </div>

      </div>

      {/* 桌面：搜索结果弹层 */}
      {showDesktopSearchOverlay && (
        <div className="hidden lg:flex fixed inset-0 z-50 items-start justify-center px-4 pt-24 pb-8">
          <button
            type="button"
            className="absolute inset-0 z-0 bg-black/65 backdrop-blur-sm"
            onClick={clearSearchResults}
            aria-label="关闭搜索结果"
          />
          <div
            className="relative z-10 w-full max-w-2xl max-h-[min(72vh,680px)] flex flex-col glass rounded-2xl border border-white/10 shadow-2xl animate-fade-in overflow-hidden pointer-events-auto"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-netease-border/50 flex-shrink-0">
              <div className="min-w-0">
                <h2 className="text-sm font-medium text-white">{isPlaylistResults ? '歌单' : '搜索结果'}</h2>
                <p className="text-xs text-netease-muted mt-0.5 truncate">
                  {searching
                    ? (isPlaylistResults ? searchedKeyword : `正在搜索「${searchedKeyword}」...`)
                    : results.length > 0
                      ? renderResultsSummary()
                      : (isPlaylistResults ? '歌单为空或链接无效' : `「${searchedKeyword}」无相关结果`)}
                </p>
              </div>
              <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                {!searching && searchableCount > 0 && !isPlaylistResults && (
                  <SearchFilterSelect value={searchFilterMode} onChange={handleSearchFilterChange} />
                )}
                <button
                  type="button"
                  onClick={clearSearchResults}
                  className="flex-shrink-0 rounded-lg p-1.5 text-netease-muted hover:bg-white/10 hover:text-white transition-colors"
                  aria-label="关闭"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              {searching && searchedKeyword && <SearchSkeleton />}
              {!searching && searchedKeyword && results.length === 0 && (
                <p className="text-center text-netease-muted py-10 animate-fade-in">
                  {isPlaylistResults ? '歌单为空或链接无效' : '换个关键词试试'}
                </p>
              )}
              {!searching && searchedKeyword && (
                <SongResultList
                  results={results}
                  addingId={addingId}
                  onAdd={handleAdd}
                  keyword={searchedKeyword}
                  alwaysShowActions
                />
              )}
            </div>
          </div>
        </div>
      )}

      {playlistImportOpen && (
        <PlaylistImportModal
          open={playlistImportOpen}
          loading={searching}
          qqImportEnabled={qqImportEnabled}
          onClose={() => setPlaylistImportOpen(false)}
          onImport={handlePlaylistImport}
        />
      )}

      {neteaseToplistOpen && (
        <NeteaseToplistModal
          open={neteaseToplistOpen}
          addingId={addingId}
          onClose={() => setNeteaseToplistOpen(false)}
          onAdd={handleAdd}
        />
      )}



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


