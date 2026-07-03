import { useMemo, useRef } from 'react';
import type { RoomState, RoomUser } from '../types';
import { useRoomStore } from '../stores/roomStore';
import type { ChatRoomMeta } from '../components/ChatMessageRow';
import { memberTiersEqual, roomUsersEqual } from './roomStateEquality';

export type ChatRoomSlice = {
  id: string;
  creatorId: string;
  adminIds: string[];
  users: RoomUser[];
  memberTiers?: RoomState['memberTiers'];
  muteAll?: boolean;
  mutedUserIds?: string[];
};

function stringArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function roomToChatSlice(room: RoomState): ChatRoomSlice {
  return {
    id: room.id,
    creatorId: room.creatorId || '',
    adminIds: room.adminIds || [],
    users: room.users,
    memberTiers: room.memberTiers,
    muteAll: room.muteAll,
    mutedUserIds: room.mutedUserIds || [],
  };
}

export function chatRoomSlicesEqual(a: ChatRoomSlice | null, b: ChatRoomSlice | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id
    && a.creatorId === b.creatorId
    && a.muteAll === b.muteAll
    && stringArraysEqual(a.adminIds, b.adminIds)
    && stringArraysEqual(a.mutedUserIds || [], b.mutedUserIds || [])
    && roomUsersEqual(a.users, b.users)
    && memberTiersEqual(a.memberTiers, b.memberTiers);
}

export function chatSliceToRoomMeta(slice: ChatRoomSlice): ChatRoomMeta {
  return {
    id: slice.id,
    creatorId: slice.creatorId,
    adminIds: slice.adminIds,
    users: slice.users,
    memberTiers: slice.memberTiers,
    muteAll: slice.muteAll,
  };
}

/** 仅在聊天相关字段变化时更新引用，避免 room_update 拖动 ChatPanel 重渲染 */
export function useChatRoomSlice(): ChatRoomSlice | null {
  const room = useRoomStore((s) => s.room);
  const sliceRef = useRef<ChatRoomSlice | null>(null);

  return useMemo(() => {
    if (!room) {
      sliceRef.current = null;
      return null;
    }
    const next = roomToChatSlice(room);
    if (sliceRef.current && chatRoomSlicesEqual(sliceRef.current, next)) {
      return sliceRef.current;
    }
    sliceRef.current = next;
    return next;
  }, [room]);
}

export function useChatRoomMeta(): ChatRoomMeta | null {
  const slice = useChatRoomSlice();
  return useMemo(() => (slice ? chatSliceToRoomMeta(slice) : null), [slice]);
}
