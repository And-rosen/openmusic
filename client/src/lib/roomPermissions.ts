import { formatSongRequestWaitRemain } from './formatStayDuration';
import type { RoomState } from '../types';

export function canModerateRoom(isOwner: boolean, isAdmin: boolean): boolean {
  return isOwner || isAdmin;
}

export function canRequestSong(
  room: RoomState | null,
  isOwner: boolean,
  isAdmin: boolean,
): boolean {
  return getSongRequestBlockReason(room, isOwner, isAdmin, null) === null;
}

export function countUserQueueSongs(room: RoomState, userId: string): number {
  let count = 0;
  if (room.current?.requestedById === userId) count += 1;
  for (const item of room.queue) {
    if (item.requestedById === userId) count += 1;
  }
  return count;
}

export function getSongRequestBlockReason(
  room: RoomState | null,
  isOwner: boolean,
  isAdmin: boolean,
  mySocketId: string | null,
): string | null {
  if (!room) return '未加入房间';
  if (room.songRequestEnabled === false && !isOwner && !isAdmin) {
    return '房主已禁止点歌';
  }

  if (isOwner || isAdmin) return null;
  if (!mySocketId) return null;

  const user = room.users.find((entry) => entry.id === mySocketId);
  const minStaySec = room.songRequestMinStaySec ?? 0;
  if (minStaySec > 0 && user) {
    const stayedSec = (Date.now() - user.joinedAt) / 1000;
    if (stayedSec < minStaySec) {
      return formatSongRequestWaitRemain(minStaySec - stayedSec);
    }
  }

  const maxPerUser = room.songRequestMaxPerUser ?? 0;
  if (maxPerUser > 0) {
    const count = countUserQueueSongs(room, mySocketId);
    if (count >= maxPerUser) {
      return `每人最多 ${maxPerUser} 首待播，你已达上限`;
    }
  }

  return null;
}
