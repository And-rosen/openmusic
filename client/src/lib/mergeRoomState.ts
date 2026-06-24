import type { RoomState } from '../types';

/** 受限聊天用户忽略广播里的全量历史，只保留自己可见的消息。 */
export function mergeRoomState(incoming: RoomState, current: RoomState | null): RoomState {
  if (!current || current.id !== incoming.id) {
    return incoming;
  }
  if (current.chatVisibleSince != null) {
    return {
      ...incoming,
      messages: current.messages,
      chatVisibleSince: current.chatVisibleSince,
    };
  }
  return incoming;
}
