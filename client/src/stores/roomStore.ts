import { create } from 'zustand';
import type { RoomState } from '../types';

interface RoomStore {
  room: RoomState | null;
  nickname: string;
  mySocketId: string | null;
  myConnectionId: string | null;
  /** 初创房主身份（creatorId） */
  isOwner: boolean;
  isAdmin: boolean;
  /** 可操控播放（房主或管理员） */
  canControlPlayback: boolean;
  /** 当前播放引擎主控（ownerId，初创房主离线时可能为管理员） */
  isPlaybackLeader: boolean;
  showPlayer: boolean;
  exitReason: string | null;
  isReconnecting: boolean;
  setRoom: (room: RoomState | null) => void;
  setNickname: (name: string) => void;
  setConnectionInfo: (
    socketId: string | null,
    isOwner: boolean,
    connectionId?: string | null,
    isAdmin?: boolean,
    isPlaybackLeader?: boolean,
    canControlPlayback?: boolean,
  ) => void;
  syncRolesFromRoom: (room: RoomState) => void;
  setShowPlayer: (show: boolean) => void;
  setExitReason: (reason: string | null) => void;
  setReconnecting: (reconnecting: boolean) => void;
  resetSession: () => void;
}

export const useRoomStore = create<RoomStore>((set, get) => ({
  room: null,
  nickname: localStorage.getItem('sjb_nickname') || '',
  mySocketId: null,
  myConnectionId: null,
  isOwner: false,
  isAdmin: false,
  canControlPlayback: false,
  isPlaybackLeader: false,
  showPlayer: false,
  exitReason: null,
  isReconnecting: false,
  setRoom: (room) => set({ room }),
  setNickname: (nickname) => {
    localStorage.setItem('sjb_nickname', nickname);
    set({ nickname });
  },
  setConnectionInfo: (
    mySocketId,
    isOwner,
    myConnectionId = null,
    isAdmin = false,
    isPlaybackLeader = false,
    canControlPlayback,
  ) => set({
    mySocketId,
    myConnectionId,
    isOwner,
    isAdmin,
    canControlPlayback: canControlPlayback ?? (isOwner || isAdmin),
    isPlaybackLeader,
  }),
  syncRolesFromRoom: (room) => {
    const { mySocketId, myConnectionId, isOwner, isAdmin, canControlPlayback, isPlaybackLeader } = get();
    if (!mySocketId) return;
    const nextIsOwner = room.creatorId === mySocketId;
    const nextIsAdmin = (room.adminIds || []).includes(mySocketId);
    const nextCanControl = nextIsOwner
      || nextIsAdmin
      || (room.autoPromotedAdminIds || []).includes(mySocketId);
    const nextIsLeader = room.ownerId === mySocketId;
    if (
      nextIsOwner === isOwner
      && nextIsAdmin === isAdmin
      && nextCanControl === canControlPlayback
      && nextIsLeader === isPlaybackLeader
    ) {
      return;
    }
    set({
      isOwner: nextIsOwner,
      isAdmin: nextIsAdmin,
      canControlPlayback: nextCanControl,
      isPlaybackLeader: nextIsLeader,
      myConnectionId,
    });
  },
  setShowPlayer: (showPlayer) => set({ showPlayer }),
  setExitReason: (exitReason) => set({ exitReason }),
  setReconnecting: (isReconnecting) => set({ isReconnecting }),
  resetSession: () => set({
    room: null,
    mySocketId: null,
    myConnectionId: null,
    isOwner: false,
    isAdmin: false,
    canControlPlayback: false,
    isPlaybackLeader: false,
    showPlayer: false,
    exitReason: null,
    isReconnecting: false,
  }),
}));
