import { useEffect, useRef, useCallback } from 'react';

import { io, Socket } from 'socket.io-client';

import { useRoomStore } from '../stores/roomStore';
import { useAudioStore } from '../stores/audioStore';

import type { ChatMessage, RoomState, Song } from '../types';

import { stopSharedAudio, getSharedAudio } from '../lib/audioElement';
import { getTrackKey } from '../api/music';
import { prefetchCurrentSong } from '../lib/songPreloadCache';
import { resolveDisplayDurationSeconds, clampPlaybackTime } from '../hooks/useTrackDuration';
import { snapPlaybackAnchor, resetPlaybackAnchor } from '../lib/playbackSync';
import { isMobileDevice } from '../lib/audioUnlock';



let socket: Socket | null = null;
let socketListenersAttached = false;
let socketConnectRequested = false;

const SOCKET_ACK_TIMEOUT_MS = 8000;
const CLIENT_ID_KEY = 'openmusic_client_id';
const CLIENT_TOKEN_KEY = 'openmusic_client_token';
let currentClientId: string | null = null;
let currentClientToken: string | null = null;
let legacyClientIdCleared = false;

type JoinSession = {
  roomId: string;
  nickname: string;
  password?: string;
  readOnly?: boolean;
};

let lastJoinSession: JoinSession | null = null;
let rejoinInFlight = false;
let joinGeneration = 0;
let lastListenerRoomTickAt = 0;



function getSocket(): Socket {

  if (!socket) {

    socket = io({

      transports: ['websocket', 'polling'],

      autoConnect: false,

    });

  }

  return socket;

}

function createClientId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function isReloadNavigation() {
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  return navigation?.type === 'reload';
}

function getClientId() {
  if (currentClientId) return currentClientId;

  try {
    if (!legacyClientIdCleared) {
      legacyClientIdCleared = true;
      localStorage.removeItem(CLIENT_ID_KEY);
    }

    const existing = sessionStorage.getItem(CLIENT_ID_KEY);
    currentClientId = existing && isReloadNavigation() ? existing : createClientId();
    sessionStorage.setItem(CLIENT_ID_KEY, currentClientId);
    return currentClientId;
  } catch {
    currentClientId = createClientId();
    return currentClientId;
  }
}

function getClientToken() {
  if (currentClientToken) return currentClientToken;
  try {
    currentClientToken = sessionStorage.getItem(CLIENT_TOKEN_KEY);
    return currentClientToken || undefined;
  } catch {
    return undefined;
  }
}

function rememberClientIdentity(clientId?: string, clientToken?: string) {
  if (!clientId || !clientToken) return;
  currentClientId = clientId;
  currentClientToken = clientToken;
  try {
    sessionStorage.setItem(CLIENT_ID_KEY, clientId);
    sessionStorage.setItem(CLIENT_TOKEN_KEY, clientToken);
  } catch {
    // sessionStorage may be unavailable.
  }
}

function emitWithAck<TResponse>(
  event: string,
  payload: unknown,
  fallback: TResponse,
): Promise<TResponse> {
  return new Promise((resolve) => {
    getSocket().timeout(SOCKET_ACK_TIMEOUT_MS).emit(
      event,
      payload,
      (err: Error | null, res: TResponse | undefined) => {
        resolve(err || !res ? fallback : res);
      },
    );
  });
}

function joinPayload(session: JoinSession) {
  return {
    roomId: session.roomId,
    nickname: session.nickname,
    password: session.password?.trim() || undefined,
    readOnly: Boolean(session.readOnly),
    clientId: getClientId(),
    clientToken: getClientToken(),
  };
}

function rejoinLastRoom() {
  const session = lastJoinSession;
  const currentRoom = useRoomStore.getState().room;
  if (!session || !currentRoom || rejoinInFlight) return;

  rejoinInFlight = true;
  getSocket().timeout(SOCKET_ACK_TIMEOUT_MS).emit(
    'join_room',
    joinPayload(session),
    (
      err: Error | null,
      res: {
        success: boolean;
        room?: RoomState;
        socketId?: string;
        connectionId?: string;
        clientId?: string;
        clientToken?: string;
        isOwner?: boolean;
      } | undefined,
    ) => {
      rejoinInFlight = false;
      if (err || !res?.success || !res.room) return;

      useRoomStore.getState().setRoom(res.room);
      snapPlaybackAnchor(res.room.currentTime, res.room.isPlaying);
      rememberClientIdentity(res.clientId || res.socketId, res.clientToken);
      if (res.socketId) {
        useRoomStore.getState().setConnectionInfo(res.socketId, Boolean(res.isOwner), res.connectionId || null);
      }
      if (res.room.current) {
        prefetchCurrentSong(res.room.current);
      }
    },
  );
}



export function useSocket() {

  const setRoom = useRoomStore((s) => s.setRoom);

  const setConnectionInfo = useRoomStore((s) => s.setConnectionInfo);

  const resetSession = useRoomStore((s) => s.resetSession);

  const connected = useRef(false);



  useEffect(() => {

    const s = getSocket();

    if (socketListenersAttached) return;
    socketListenersAttached = true;



    const onRoomUpdate = (room: RoomState) => {
      const { mySocketId, myConnectionId, room: prevRoom } = useRoomStore.getState();
      const isOwner = Boolean(
        mySocketId
        && room.ownerId === mySocketId
        && (!room.ownerConnectionId || room.ownerConnectionId === myConnectionId),
      );

      let merged = room;
      if (
        isOwner
        && room.isPlaying
        && room.current
        && prevRoom?.current?.queueId === room.current.queueId
        && !useAudioStore.getState().trackLoading
        && useAudioStore.getState().mediaTrackKey === getTrackKey(room.current)
      ) {
        const audio = getSharedAudio();
        if (
          audio.src
          && isFinite(audio.currentTime)
          && audio.currentTime >= 0
          && Math.abs(audio.currentTime - room.currentTime) < 0.75
        ) {
          merged = { ...room, currentTime: audio.currentTime };
        }
      }

      useRoomStore.getState().setRoom(merged);
      snapPlaybackAnchor(merged.currentTime, merged.isPlaying);

      if (mySocketId) {
        useRoomStore.getState().setConnectionInfo(mySocketId, isOwner, myConnectionId);
      }
    };



    const onPlaybackTick = (state: { currentTime: number; isPlaying: boolean }) => {
      const { room: current, mySocketId, myConnectionId } = useRoomStore.getState();
      if (!current) return;

      const isOwner = Boolean(
        mySocketId
        && current.ownerId === mySocketId
        && (!current.ownerConnectionId || current.ownerConnectionId === myConnectionId),
      );
      let currentTime = state.currentTime;

      if (isOwner && state.isPlaying && current.current) {
        const { trackLoading, mediaTrackKey } = useAudioStore.getState();
        const expectedKey = getTrackKey(current.current);
        if (!trackLoading && mediaTrackKey === expectedKey) {
          const audio = getSharedAudio();
          if (audio.src && isFinite(audio.currentTime) && audio.currentTime >= 0) {
            currentTime = audio.currentTime;
          }
        }
      }

      if (current.current) {
        const { lrcDurationMs, lrcTrackKey, mediaDurationMs, mediaTrackKey } = useAudioStore.getState();
        const dur = resolveDisplayDurationSeconds(current.current, {
          lrcDurationMs,
          lrcTrackKey,
          mediaDurationMs,
          mediaTrackKey,
        });
        currentTime = clampPlaybackTime(currentTime, dur);
      }

      snapPlaybackAnchor(currentTime, state.isPlaying);

      if (!isOwner && isMobileDevice()) {
        const now = Date.now();
        const prev = current.currentTime ?? 0;
        if (now - lastListenerRoomTickAt < 900 && Math.abs(currentTime - prev) < 1.5) {
          return;
        }
        lastListenerRoomTickAt = now;
      }

      useRoomStore.getState().setRoom({ ...current, currentTime, isPlaying: state.isPlaying });
    };



    const onChatMessage = (message: ChatMessage) => {

      const current = useRoomStore.getState().room;

      if (!current) return;

      if (current.messages.some((m) => m.id === message.id)) return;

      useRoomStore.getState().setRoom({ ...current, messages: [...current.messages, message] });

    };



    s.on('room_update', onRoomUpdate);

    s.on('playback_tick', onPlaybackTick);

    s.on('chat_message', onChatMessage);

    s.on('connect', rejoinLastRoom);
    s.on('disconnect', () => {
      useRoomStore.getState().setConnectionInfo(useRoomStore.getState().mySocketId, false, null);
    });
    s.on('connect_error', () => {
      useRoomStore.getState().setConnectionInfo(useRoomStore.getState().mySocketId, false, null);
    });

  }, [setRoom, setConnectionInfo]);



  const connect = useCallback(() => {

    const s = getSocket();

    if (!connected.current && !socketConnectRequested) {

      s.connect();

      connected.current = true;
      socketConnectRequested = true;

    }

  }, []);



  const joinRoom = useCallback(

    (
      roomId: string,
      nickname: string,
      password?: string,
      options: { readOnly?: boolean } = {},
    ): Promise<{ success: boolean; error?: string; needsPassword?: boolean; room?: RoomState }> => {
      connect();
      const session: JoinSession = {
        roomId,
        nickname,
        password,
        readOnly: Boolean(options.readOnly),
      };
      const generation = ++joinGeneration;

      return emitWithAck<{
        success: boolean;
        error?: string;
        needsPassword?: boolean;
        room?: RoomState;
        socketId?: string;
        connectionId?: string;
        clientId?: string;
        clientToken?: string;
        isOwner?: boolean;
      }>('join_room', joinPayload(session), { success: false, error: '连接超时，请检查网络' })
        .then((res) => {
          if (res.success && res.room) {
            if (generation !== joinGeneration) return res;
            lastJoinSession = session;
            setRoom(res.room);
            snapPlaybackAnchor(res.room.currentTime, res.room.isPlaying);
            rememberClientIdentity(res.clientId || res.socketId, res.clientToken);

            if (res.socketId) {
              setConnectionInfo(res.socketId, Boolean(res.isOwner), res.connectionId || null);
            }
            if (res.room.current) {
              prefetchCurrentSong(res.room.current);
            }
          }

          return res;
        });

    },

    [connect, setRoom, setConnectionInfo],

  );



  const leaveRoom = useCallback((): Promise<void> => {
    joinGeneration += 1;
    lastJoinSession = null;
    stopSharedAudio();
    resetPlaybackAnchor(0);
    useAudioStore.getState().setTrackLoading(false);
    useAudioStore.getState().setNeedsAudioUnlock(false);
    useAudioStore.getState().setSmoothPlaybackTime(0);
    resetSession();

    const s = getSocket();
    if (s.connected) {
      s.timeout(SOCKET_ACK_TIMEOUT_MS).emit('leave_room', {}, () => {});
    }
    return Promise.resolve();
  }, [resetSession]);



  const addSong = useCallback((song: Song): Promise<{ success: boolean; error?: string }> => {
    return emitWithAck('add_song', { song }, { success: false, error: '连接超时，请重试' });

  }, []);



  const skipSong = useCallback((): Promise<{ success: boolean; error?: string }> => {
    return emitWithAck('skip_song', {}, { success: false, error: '连接超时，请重试' });

  }, []);

  const finishSong = useCallback((queueId: string): Promise<{ success: boolean; error?: string }> => {
    return emitWithAck('finish_song', { queueId }, { success: false, error: '连接超时，请重试' });
  }, []);



  const togglePlay = useCallback((isPlaying: boolean): Promise<boolean> => {
    return emitWithAck('toggle_play', { isPlaying }, { success: false }).then((res) => res.success);

  }, []);



  const seek = useCallback((time: number): Promise<boolean> => {
    return emitWithAck('seek', { time }, { success: false }).then((res) => res.success);

  }, []);



  const removeSong = useCallback((queueId: string): Promise<boolean> => {
    return emitWithAck('remove_song', { queueId }, { success: false }).then((res) => res.success);

  }, []);



  const requestJump = useCallback((queueId: string): Promise<{ success: boolean; error?: string }> => {
    return emitWithAck('request_jump', { queueId }, { success: false, error: '连接超时，请重试' });

  }, []);



  const approveJump = useCallback((requestId: string): Promise<boolean> => {
    return emitWithAck('approve_jump', { requestId }, { success: false }).then((res) => res.success);

  }, []);



  const rejectJump = useCallback((requestId: string): Promise<boolean> => {
    return emitWithAck('reject_jump', { requestId }, { success: false }).then((res) => res.success);

  }, []);



  const requestSkip = useCallback((): Promise<{ success: boolean; error?: string }> => {
    return emitWithAck('request_skip', {}, { success: false, error: '连接超时，请重试' });

  }, []);



  const approveSkip = useCallback((requestId: string): Promise<boolean> => {
    return emitWithAck('approve_skip', { requestId }, { success: false }).then((res) => res.success);

  }, []);



  const rejectSkip = useCallback((requestId: string): Promise<boolean> => {
    return emitWithAck('reject_skip', { requestId }, { success: false }).then((res) => res.success);

  }, []);



  const sendChat = useCallback((text: string): Promise<{ success: boolean; error?: string }> => {
    return emitWithAck('send_chat', { text }, { success: false, error: '连接超时，请重试' });

  }, []);



  const renameUser = useCallback((nickname: string): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'rename_user',
      { nickname },
      { success: false, error: '连接超时，请重试' },
    )
      .then((res) => {
        if (res.success && res.room) {
          setRoom(res.room);
          const nextNickname = nickname.trim();
          useRoomStore.getState().setNickname(nextNickname);
          if (lastJoinSession) {
            lastJoinSession = { ...lastJoinSession, nickname: nextNickname };
          }
        }
        return res;
      });

  }, [setRoom]);



  const syncTime = useCallback((time: number) => {

    getSocket().emit('sync_time', { time });

  }, []);



  return {

    joinRoom,

    leaveRoom,

    addSong,

    skipSong,
    finishSong,

    togglePlay,

    seek,

    syncTime,

    removeSong,

    requestJump,

    approveJump,

    rejectJump,

    requestSkip,

    approveSkip,

    rejectSkip,

    sendChat,

    renameUser,

    connect,

  };

}


