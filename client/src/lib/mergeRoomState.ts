import type { RoomState } from '../types';
import {
  isRoomStateEquivalent,
  memberTiersEqual,
  roomQueueEqual,
  roomUsersEqual,
  stringArraysEqual,
} from './roomStateEquality';

/** room_update 合并：等价快照保留引用，子结构未变时复用引用减轻 React 重渲染。 */
export function mergeRoomState(incoming: RoomState, current: RoomState | null): RoomState {
  if (!current || current.id !== incoming.id) {
    return incoming;
  }
  if (isRoomStateEquivalent(incoming, current)) {
    return current;
  }

  const merged: RoomState = { ...incoming, currentTime: incoming.currentTime };

  if (roomUsersEqual(incoming.users, current.users)) merged.users = current.users;
  if (roomQueueEqual(incoming.queue, current.queue)) merged.queue = current.queue;
  if (incoming.current === current.current
    || (incoming.current && current.current && incoming.current.queueId === current.current.queueId
      && incoming.current.id === current.current.id
      && incoming.current.requestedBy === current.current.requestedBy)) {
    merged.current = current.current;
  }
  if (memberTiersEqual(incoming.memberTiers, current.memberTiers)) {
    merged.memberTiers = current.memberTiers;
  }
  if (stringArraysEqual(incoming.adminIds, current.adminIds)) {
    merged.adminIds = current.adminIds;
  }
  if (stringArraysEqual(incoming.mutedUserIds, current.mutedUserIds)) {
    merged.mutedUserIds = current.mutedUserIds;
  }

  return merged;
}
