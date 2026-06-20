import { useState, useEffect, useRef, useMemo } from 'react';
import { Trash2, Music, Zap } from 'lucide-react';
import { useRoomStore } from '../stores/roomStore';
import { useSocket } from '../hooks/useSocket';
import { getCoverUrl } from '../api/music';
import SourceBadge from './SourceBadge';

/** 单条约 64px + 间距，固定显示 3 条 */
const VISIBLE_ROWS = 3;
const ROW_HEIGHT = 64;
const ROW_GAP = 6;
const LIST_HEIGHT = VISIBLE_ROWS * ROW_HEIGHT + (VISIBLE_ROWS - 1) * ROW_GAP;

export default function QueuePanel() {
  const room = useRoomStore((s) => s.room);
  const nickname = useRoomStore((s) => s.nickname);
  const mySocketId = useRoomStore((s) => s.mySocketId);
  const isOwner = useRoomStore((s) => s.isOwner);
  const { removeSong, requestJump } = useSocket();
  const [jumpMsg, setJumpMsg] = useState('');
  const currentRef = useRef<HTMLDivElement>(null);

  const allSongs = useMemo(() => {
    if (!room) return [];
    return [
      ...(room.current ? [{ ...room.current, isCurrent: true }] : []),
      ...room.queue.map((s) => ({ ...s, isCurrent: false })),
    ];
  }, [room]);

  const currentKey = room?.current?.queueId || '';
  const pendingQueueIds = new Set(room?.jumpRequests.map((r) => r.queueId) ?? []);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentKey]);

  const handleJumpRequest = async (queueId: string) => {
    setJumpMsg('');
    const res = await requestJump(queueId);
    if (res.success) {
      setJumpMsg('已提交插队申请，等待房主同意');
      setTimeout(() => setJumpMsg(''), 3000);
    } else {
      setJumpMsg(res.error || '申请失败');
    }
  };

  if (!room) return null;

  if (allSongs.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center text-netease-muted"
        style={{ height: LIST_HEIGHT }}
      >
        <Music className="w-7 h-7 mb-2 opacity-30" />
        <p className="text-xs text-center">队列为空，搜索或双击点歌</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {jumpMsg && (
        <p className="text-xs text-amber-400/80 mb-1.5 px-1 flex-shrink-0">{jumpMsg}</p>
      )}

      <div
        className="space-y-1.5 overflow-y-auto pr-0.5"
        style={{ height: LIST_HEIGHT }}
      >
        {allSongs.map((song, i) => {
          const isMine = !song.isCurrent && (
            song.requestedById
              ? song.requestedById === mySocketId
              : song.requestedBy === nickname
          );
          const canRemove = !song.isCurrent && (isOwner || isMine);
          const hasPending = pendingQueueIds.has(song.queueId);

          return (
            <div
              key={song.queueId || `current-${song.id}`}
              ref={song.isCurrent ? currentRef : undefined}
              className={`group flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-colors ${
                song.isCurrent
                  ? 'bg-netease-red/10 border border-netease-red/25'
                  : 'bg-netease-card/35 hover:bg-netease-card/80'
              }`}
              style={{ minHeight: ROW_HEIGHT }}
            >
              <span className="w-5 text-center text-[11px] text-netease-muted flex-shrink-0">
                {song.isCurrent ? (
                  <span className="inline-flex gap-0.5 items-end h-3.5">
                    <span className="w-0.5 h-1.5 bg-netease-red animate-pulse" />
                    <span className="w-0.5 h-2.5 bg-netease-red animate-pulse delay-75" />
                    <span className="w-0.5 h-1 bg-netease-red animate-pulse delay-150" />
                  </span>
                ) : (
                  i
                )}
              </span>
              <img
                src={getCoverUrl(song)}
                alt=""
                className="w-11 h-11 rounded-lg object-cover bg-netease-card flex-shrink-0"
              />
              <div className="flex-1 min-w-0 self-stretch flex flex-col justify-center gap-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p
                    className={`min-w-0 flex-1 text-sm leading-5 truncate ${
                      song.isCurrent ? 'text-netease-red font-medium' : 'text-white/92'
                    }`}
                    title={song.name}
                  >
                    {song.name}
                  </p>
                  <SourceBadge
                    source={song.source || 'netease'}
                    className="rounded-full px-1.5 py-0 text-[9px] leading-4"
                  />
                  {hasPending && (
                    <span className="rounded-full bg-amber-400/10 px-1.5 py-0 text-[9px] leading-4 text-amber-300 flex-shrink-0">
                      待审
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px] leading-4 text-netease-muted min-w-0">
                  <span className="min-w-0 truncate" title={song.artist}>
                    {song.artist}
                  </span>
                  {!song.isCurrent && song.requestedBy && (
                    <span className="min-w-0 truncate text-netease-muted/65" title={`${song.requestedBy}点的歌`}>
                      {song.requestedBy}点的歌
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-center gap-1 flex-shrink-0">
                {isMine && !hasPending && (
                  <button
                    onClick={() => handleJumpRequest(song.queueId)}
                    className="p-1.5 rounded-lg text-amber-400/75 hover:text-amber-300 hover:bg-amber-400/10 transition-colors"
                    title="申请插队"
                  >
                    <Zap className="w-3.5 h-3.5" />
                  </button>
                )}
                {canRemove && (
                  <button
                    onClick={() => removeSong(song.queueId)}
                    className="p-1.5 rounded-lg text-netease-muted hover:text-netease-red hover:bg-netease-red/10 transition-colors"
                    title={isOwner && !isMine ? '移除歌曲' : '删除我的点歌'}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
