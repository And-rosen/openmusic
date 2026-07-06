import type { RoomSummary } from '../types';

function roomSummarySignature(room: RoomSummary): string {
  const song = room.currentSong;
  return [
    room.id,
    room.name,
    room.userCount,
    room.hasPassword,
    room.isLocked ?? false,
    room.isPlaying,
    song?.name ?? '',
    song?.artist ?? '',
    room.queueLength,
    room.createdAt,
  ].join('\0');
}

export function areRoomListsEqual(a: RoomSummary[], b: RoomSummary[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (roomSummarySignature(a[i]) !== roomSummarySignature(b[i])) return false;
  }
  return true;
}
