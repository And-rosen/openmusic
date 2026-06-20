import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Crown, Pencil, Users, X } from 'lucide-react';
import { useRoomStore } from '../stores/roomStore';
import { useSocket } from '../hooks/useSocket';
import type { RoomUser } from '../types';

interface Props {
  users: RoomUser[];
  ownerId?: string | null;
  creatorId?: string | null;
}

export default function OnlineUsers({ users, ownerId, creatorId }: Props) {
  const mySocketId = useRoomStore((s) => s.mySocketId);
  const nickname = useRoomStore((s) => s.nickname);
  const setNickname = useRoomStore((s) => s.setNickname);
  const { renameUser } = useSocket();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(nickname);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  const orderedUsers = useMemo(() => {
    return [...users].sort((a, b) => {
      if (a.id === mySocketId) return -1;
      if (b.id === mySocketId) return 1;
      if (creatorId) {
        if (a.id === creatorId) return -1;
        if (b.id === creatorId) return 1;
      }
      if (a.id === ownerId) return -1;
      if (b.id === ownerId) return 1;
      return a.joinedAt - b.joinedAt;
    });
  }, [users, mySocketId, ownerId, creatorId]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
      setEditing(false);
      setError('');
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  useEffect(() => {
    setDraftName(nickname);
  }, [nickname]);

  const saveNickname = async () => {
    const nextName = draftName.trim();
    if (!nextName || saving) return;

    setSaving(true);
    setError('');
    const res = await renameUser(nextName);
    if (res.success) {
      setNickname(nextName);
      setEditing(false);
    } else {
      setError(res.error || '改名失败');
    }
    setSaving(false);
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-xs text-netease-muted hover:bg-netease-card hover:text-white transition-colors"
        title="查看房间用户"
      >
        <Users className="w-4 h-4" />
        <div className="flex -space-x-2">
          {orderedUsers.slice(0, 5).map((user) => (
            <div
              key={user.id}
              title={user.id === ownerId ? `${user.nickname}（房主）` : user.nickname}
              className={`relative w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white border-2 border-netease-dark ${
                user.id === ownerId
                  ? 'bg-gradient-to-br from-amber-500 to-orange-600'
                  : user.id === mySocketId
                    ? 'bg-gradient-to-br from-netease-red to-pink-500'
                    : 'bg-gradient-to-br from-zinc-500 to-zinc-700'
              }`}
            >
              {user.nickname.charAt(0).toUpperCase()}
              {user.id === ownerId && (
                <Crown className="absolute -top-1 -right-1 w-3 h-3 text-amber-300" />
              )}
            </div>
          ))}
          {orderedUsers.length > 5 && (
            <div className="w-7 h-7 rounded-full bg-netease-card flex items-center justify-center text-[10px] text-white border-2 border-netease-dark">
              +{orderedUsers.length - 5}
            </div>
          )}
        </div>
        <span className="hidden sm:inline">共 {users.length} 人</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 rounded-2xl border border-netease-border/70 bg-netease-dark/95 p-3 shadow-2xl backdrop-blur z-30">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-white">房间用户</h3>
              <p className="text-[11px] text-netease-muted">共 {users.length} 人</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setEditing(false);
              }}
              className="rounded-lg p-1 text-netease-muted hover:bg-white/10 hover:text-white"
              aria-label="关闭用户列表"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="max-h-80 space-y-1.5 overflow-y-auto pr-0.5">
            {orderedUsers.map((user) => {
              const isMe = user.id === mySocketId;
              const isOwner = user.id === ownerId;

              return (
                <div
                  key={user.id}
                  className={`rounded-xl border px-2.5 py-2 ${
                    isMe
                      ? 'border-netease-red/30 bg-netease-red/10'
                      : 'border-white/5 bg-white/[0.03]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`relative w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 ${
                        isOwner
                          ? 'bg-gradient-to-br from-amber-500 to-orange-600'
                          : isMe
                            ? 'bg-gradient-to-br from-netease-red to-pink-500'
                            : 'bg-gradient-to-br from-zinc-500 to-zinc-700'
                      }`}
                    >
                      {user.nickname.charAt(0).toUpperCase()}
                      {isOwner && <Crown className="absolute -top-1 -right-1 w-3 h-3 text-amber-300" />}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="min-w-0 truncate text-sm text-white" title={user.nickname}>
                          {user.nickname}
                        </p>
                        {isMe && <span className="rounded-full bg-netease-red/20 px-1.5 text-[9px] text-netease-red">我</span>}
                        {isOwner && <span className="rounded-full bg-amber-400/15 px-1.5 text-[9px] text-amber-300">房主</span>}
                        {user.readOnly && <span className="rounded-full bg-white/8 px-1.5 text-[9px] text-netease-muted">TV</span>}
                      </div>
                    </div>

                    {isMe && !editing && (
                      <button
                        type="button"
                        onClick={() => {
                          setDraftName(user.nickname);
                          setEditing(true);
                        }}
                        className="rounded-lg p-1.5 text-netease-muted hover:bg-white/10 hover:text-white"
                        title="修改昵称"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {isMe && editing && (
                    <div className="mt-2 flex gap-1.5">
                      <input
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void saveNickname();
                          if (event.key === 'Escape') setEditing(false);
                        }}
                        maxLength={20}
                        className="min-w-0 flex-1 rounded-lg border border-netease-border/60 bg-netease-dark px-2 py-1 text-xs text-white outline-none focus:border-netease-red/50"
                        placeholder="输入新昵称"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={saveNickname}
                        disabled={saving || !draftName.trim()}
                        className="rounded-lg bg-netease-red px-2 text-white disabled:opacity-40"
                        title="保存昵称"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {error && <p className="mt-2 text-xs text-netease-red">{error}</p>}
        </div>
      )}
    </div>
  );
}
