import { useEffect, useRef, useCallback } from 'react';

import { io, Socket } from 'socket.io-client';

import { useRoomStore } from '../stores/roomStore';
import { useChatStore } from '../stores/chatStore';
import { useSongHistoryStore } from '../stores/songHistoryStore';
import { useAudioStore } from '../stores/audioStore';
import { songKey } from '../api/music';

import type { ChatMention, ChatReplyRef, ChatMessage, FavoriteSong, PlaybackState, RoomState, Song, SongHistoryItem } from '../types';

import { stopSharedAudio } from '../lib/audioElement';
import { resetDriftController } from '../lib/driftController';
import { resetPhaseSync } from '../lib/playbackSync';
import { resetSyncStateMachine } from '../lib/syncStateMachine';
import { prefetchUpcomingFromRoom } from '../lib/songPreloadCache';
import { resetPlaybackStateCache } from '../lib/playbackState';
import {
  schedulePlaybackState,
  seedPlaybackFromRoom,
  resetPlaybackScheduling,
} from '../lib/playbackSchedule';
import { rememberClientIdentity } from '../lib/clientId';
import { requireSessionBootstrap, resetSessionBootstrap } from '../lib/sessionBootstrap';
import { mergeRoomState } from '../lib/mergeRoomState';
import { debugLog, setDebugSocketProvider } from '../lib/debugTools';
import { bindReportTrackDurationSocket } from '../lib/reportTrackDuration';



let socket: Socket | null = null;
let socketListenersAttached = false;
let socketConnectRequested = false;

const SOCKET_ACK_TIMEOUT_MS = 8000;

type JoinSession = {
  roomId: string;
  nickname: string;
  password?: string;
  readOnly?: boolean;
};

let lastJoinSession: JoinSession | null = null;
let lastTvJoinSession: JoinSession | null = null;
let activeJoinMode: 'normal' | 'tv' | null = null;
let rejoinInFlight = false;
let joinGeneration = 0;



function getSocket(): Socket {

  if (!socket) {

    socket = io({

      transports: ['websocket', 'polling'],

      autoConnect: false,

      withCredentials: true,

    });

  }

  return socket;

}

function waitForSocketConnect(s: Socket, timeoutMs = SOCKET_ACK_TIMEOUT_MS): Promise<void> {
  if (s.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      s.off('connect', onConnect);
      reject(new Error('连接超时，请检查网络'));
    }, timeoutMs);
    const onConnect = () => {
      window.clearTimeout(timer);
      resolve();
    };
    s.once('connect', onConnect);
    if (!s.active) s.connect();
  });
}

/** 确保会话已 bootstrap，并在需要时建立 socket 连接（不无故重连） */
async function ensureSocketReady(forceBootstrap = false): Promise<Socket> {
  await requireSessionBootstrap(forceBootstrap);
  const s = getSocket();
  if (s.connected) return s;
  socketConnectRequested = true;
  await waitForSocketConnect(s);
  return s;
}

/** 仅在会话失效时重建 socket，确保握手携带 Cookie */
async function reconnectSocketSession(forceBootstrap = false): Promise<Socket> {
  await requireSessionBootstrap(forceBootstrap);
  const s = getSocket();
  if (s.connected || s.active) {
    await new Promise<void>((resolve) => {
      s.once('disconnect', () => resolve());
      s.disconnect();
    });
  }
  socketConnectRequested = true;
  await waitForSocketConnect(s);
  return s;
}

/** 应用启动后预热 socket，缩短首次进房等待 */
export async function warmUpSocketSession(): Promise<void> {
  try {
    await ensureSocketReady(false);
  } catch {
    // 首次预热失败不影响后续进房重试
  }
}

bindReportTrackDurationSocket(getSocket);


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
  };
}

type JoinAckResponse = {
  success: boolean;
  error?: string;
  needsPassword?: boolean;
  room?: RoomState;
  messages?: ChatMessage[];
  chatHasMore?: boolean;
  playbackState?: PlaybackState;
  socketId?: string;
  connectionId?: string;
  clientId?: string;
  clientToken?: string;
  needsSession?: boolean;
  isOwner?: boolean;
  isAdmin?: boolean;
  canControlPlayback?: boolean;
  isPlaybackLeader?: boolean;
  nickname?: string;
};

function applyJoinResponse(session: JoinSession, res: JoinAckResponse) {
  if (!res.success || !res.room) return;

  applyRoomSnapshot(res.room, true);
  applyJoinSnapshot(res.room, res.playbackState);
  applyJoinExtras(res.room, { messages: res.messages, chatHasMore: res.chatHasMore });

  const isTvSession = Boolean(session.readOnly);
  if (isTvSession) {
    activeJoinMode = 'tv';
    lastTvJoinSession = session;
  } else {
    activeJoinMode = 'normal';
    lastJoinSession = session;
    lastTvJoinSession = null;
    rememberClientIdentity(res.socketId);
  }

  const resolvedNickname = res.nickname?.trim()
    || res.room.users.find((user) => user.id === res.socketId)?.nickname?.trim();
  if (!isTvSession && resolvedNickname) {
    useRoomStore.getState().setNickname(resolvedNickname);
    lastJoinSession = { ...session, nickname: resolvedNickname };
  }

  if (res.socketId) {
    useRoomStore.getState().setConnectionInfo(
      res.socketId,
      Boolean(res.isOwner),
      res.connectionId || null,
      Boolean(res.isAdmin),
      Boolean(res.isPlaybackLeader),
    );
  }
  if (res.room.current || res.room.nextRandom || (res.room.queue?.length ?? 0) > 0) {
    prefetchUpcomingFromRoom(res.room);
  }
}

function applyRoomSnapshot(room: RoomState, force = false) {
  const current = useRoomStore.getState().room;
  useRoomStore.getState().setRoom(force ? room : mergeRoomState(room, current));
  useRoomStore.getState().syncRolesFromRoom(room);
}

function applyJoinSnapshot(room: RoomState, playbackState?: PlaybackState) {
  if (playbackState) {
    schedulePlaybackState(playbackState);
  } else {
    seedPlaybackFromRoom(room);
  }
}

function applyJoinChat(room: RoomState, messages?: ChatMessage[], chatHasMore?: boolean) {
  useChatStore.getState().reset(
    room.id,
    messages || [],
    Boolean(chatHasMore),
    room.chatVisibleSince ?? null,
  );
}

function prefetchSongHistory(roomId: string) {
  void emitWithAck<{ success: boolean; songs?: SongHistoryItem[] }>(
    'load_song_history',
    { limit: 150 },
    { success: false },
  ).then((res) => {
    if (useRoomStore.getState().room?.id !== roomId) return;
    if (res.success && res.songs) {
      useSongHistoryStore.getState().setSongs(roomId, res.songs);
    }
  });
}

function applyJoinExtras(
  room: RoomState,
  extras: { messages?: ChatMessage[]; chatHasMore?: boolean },
) {
  applyJoinChat(room, extras.messages, extras.chatHasMore);
  prefetchSongHistory(room.id);
}

function rejoinActiveRoom() {
  const session = activeJoinMode === 'tv'
    ? lastTvJoinSession
    : lastJoinSession;
  const currentRoom = useRoomStore.getState().room;
  if (!session || !currentRoom || rejoinInFlight) return;

  rejoinInFlight = true;
  const doRejoin = () => {
    getSocket().timeout(SOCKET_ACK_TIMEOUT_MS).emit(
      'join_room',
      joinPayload(session),
      (err: Error | null, res: JoinAckResponse | undefined) => {
        rejoinInFlight = false;
        if (err || !res?.success || !res.room) return;
        applyJoinResponse(session, res);
      },
    );
  };

  if (session.readOnly) {
    doRejoin();
    return;
  }

  ensureSocketReady(false)
    .then(() => {
      doRejoin();
    })
    .catch(() => {
      rejoinInFlight = false;
    });
}



export function useSocket() {

  const setConnectionInfo = useRoomStore((s) => s.setConnectionInfo);

  const resetSession = useRoomStore((s) => s.resetSession);

  const connected = useRef(false);



  useEffect(() => {

    const s = getSocket();

        setDebugSocketProvider(() => ({
      id: s.id,
      connected: s.connected,
      transport: s.io.engine?.transport?.name,
    }));
if (socketListenersAttached) return;
    socketListenersAttached = true;



let prefetchDebounceTimer = 0;

    const onRoomUpdate = (room: RoomState) => {
      debugLog('room_update', {
        roomId: room.id,
        current: room.current?.queueId || null,
        isPlaying: room.isPlaying,
        currentTime: room.currentTime,
        users: room.users?.length ?? 0,
        randomLoading: room.randomLoading,
      });
      const { mySocketId, room: prevRoom } = useRoomStore.getState();

      if (prevRoom?.id === room.id && room.current) {
        const prevKey = prevRoom.current ? songKey(prevRoom.current) : null;
        const nextKey = songKey(room.current);
        if (prevKey !== nextKey) {
          const current = room.current;
          useSongHistoryStore.getState().appendSong(room.id, {
            id: current.id,
            source: current.source,
            name: current.name,
            artist: current.artist,
            album: current.album,
            pic: current.pic,
            duration: current.duration,
            requestedBy: current.requestedBy,
            requestedById: current.requestedById,
            requestedAt: Date.now(),
          });
        }
      }

      applyRoomSnapshot(room);

      if (mySocketId) {
        useRoomStore.getState().syncRolesFromRoom(room);
      }

      window.clearTimeout(prefetchDebounceTimer);
      prefetchDebounceTimer = window.setTimeout(() => {
        prefetchUpcomingFromRoom(room);
      }, 400);
    };

    const onPlaybackState = (state: PlaybackState) => {
      schedulePlaybackState(state);
    };



    const onChatMessage = (message: ChatMessage) => {
      useChatStore.getState().append(message);
    };

    const onChatReactionUpdate = ({
      messageId,
      reactions,
    }: {
      messageId: string;
      reactions: ChatMessage['reactions'];
    }) => {
      useChatStore.getState().updateReactions(messageId, reactions);
    };

    const onKicked = ({ message }: { message?: string }) => {
      joinGeneration += 1;
      lastJoinSession = null;
      lastTvJoinSession = null;
      activeJoinMode = null;
      useChatStore.getState().clear();
      useSongHistoryStore.getState().clear();
      stopSharedAudio();
      resetSyncStateMachine();
      resetPhaseSync();
      resetDriftController();
      resetPlaybackScheduling();
      resetPlaybackStateCache();
      useAudioStore.getState().setPlaybackVersion(0);
      useAudioStore.getState().setTrackLoading(false);
      useAudioStore.getState().setNeedsAudioUnlock(false);
      useAudioStore.getState().setSmoothPlaybackTime(0);
      resetSession();
      useRoomStore.getState().setExitReason(
        message || '你已被房主移出房间，无法再次进入',
      );
    };



    s.on('room_update', onRoomUpdate);

    s.on('playback_state', onPlaybackState);

    s.on('chat_message', onChatMessage);

    s.on('chat_reaction_update', onChatReactionUpdate);

    s.on('kicked', onKicked);

    s.on('connect', () => {
      debugLog('socket_connect', { id: s.id, transport: s.io.engine?.transport?.name });
      rejoinActiveRoom();
    });
    s.on('disconnect', (reason) => {
      debugLog('socket_disconnect', { reason });
      useRoomStore.getState().setConnectionInfo(useRoomStore.getState().mySocketId, false, null);
    });
    s.on('connect_error', (err) => {
      debugLog('socket_connect_error', { message: err?.message });
      useRoomStore.getState().setConnectionInfo(useRoomStore.getState().mySocketId, false, null);
    });

  }, [setConnectionInfo, resetSession]);



  const connect = useCallback(() => {

    const s = getSocket();

        setDebugSocketProvider(() => ({
      id: s.id,
      connected: s.connected,
      transport: s.io.engine?.transport?.name,
    }));
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
      const session: JoinSession = {
        roomId,
        nickname,
        password,
        readOnly: Boolean(options.readOnly),
      };
      const generation = ++joinGeneration;

      const attemptJoin = () => emitWithAck<JoinAckResponse>(
        'join_room',
        joinPayload(session),
        { success: false, error: '连接超时，请检查网络' },
      );

      const runJoin = async () => {
        try {
          await ensureSocketReady(false);
        } catch {
          resetSessionBootstrap();
          try {
            await reconnectSocketSession(true);
          } catch (err) {
            const message = err instanceof Error ? err.message : '会话未就绪，请刷新页面后重试';
            return { success: false, error: message, needsSession: true };
          }
        }

        let res = await attemptJoin();
        if (!res.success && res.needsSession && !options.readOnly) {
          resetSessionBootstrap();
          try {
            await reconnectSocketSession(true);
          } catch (err) {
            const message = err instanceof Error ? err.message : '会话未就绪，请刷新页面后重试';
            return { success: false, error: message, needsSession: true };
          }
          res = await attemptJoin();
        }
        if (res.success && res.room) {
          if (generation !== joinGeneration) return res;
          applyJoinResponse(session, res);
        }
        return res;
      };

      return runJoin();
    },

    [connect, setConnectionInfo],

  );



  const leaveRoom = useCallback((): Promise<void> => {
    joinGeneration += 1;
    lastJoinSession = null;
    lastTvJoinSession = null;
    activeJoinMode = null;
    useChatStore.getState().clear();
    useSongHistoryStore.getState().clear();
    stopSharedAudio();
    resetSyncStateMachine();
    resetPhaseSync();
    resetDriftController();
    resetPlaybackScheduling();
    resetPlaybackStateCache();
    useAudioStore.getState().setPlaybackVersion(0);
    useAudioStore.getState().setTrackLoading(false);
    useAudioStore.getState().setNeedsAudioUnlock(false);
    useAudioStore.getState().setSmoothPlaybackTime(0);
    resetSession();

    const s = getSocket();
        setDebugSocketProvider(() => ({
      id: s.id,
      connected: s.connected,
      transport: s.io.engine?.transport?.name,
    }));
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

  const clearQueue = useCallback((): Promise<{ success: boolean; error?: string }> => {
    return emitWithAck('clear_queue', {}, { success: false, error: '连接超时，请重试' });
  }, []);



  const requestJump = useCallback((queueId: string): Promise<{ success: boolean; error?: string }> => {
    return emitWithAck('request_jump', { queueId }, { success: false, error: '连接超时，请重试' });

  }, []);

  const toggleQueueLike = useCallback((queueId: string): Promise<{ success: boolean; liked?: boolean; error?: string }> => {
    return emitWithAck('toggle_queue_like', { queueId }, { success: false, error: '连接超时，请重试' });

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



  const sendChat = useCallback((
    text: string,
    options: {
      mentions?: ChatMention[];
      replyTo?: ChatReplyRef | null;
      imageUrl?: string;
      imageKey?: string;
    } = {},
  ): Promise<{ success: boolean; error?: string }> => {
    return emitWithAck('send_chat', { text, ...options }, { success: false, error: '连接超时，请重试' });

  }, []);

  const toggleChatReaction = useCallback((
    messageId: string,
    emoji: string,
  ): Promise<{ success: boolean; error?: string }> => {
    return emitWithAck(
      'toggle_chat_reaction',
      { messageId, emoji },
      { success: false, error: '连接超时，请重试' },
    );
  }, []);

  const listFavorites = useCallback((): Promise<{ success: boolean; favorites?: FavoriteSong[]; error?: string }> => {
    return emitWithAck('list_favorites', {}, { success: false, error: '连接超时，请重试' });
  }, []);

  const setFavorite = useCallback((song: Song, favorite: boolean): Promise<{ success: boolean; favorites?: FavoriteSong[]; favorite?: boolean; error?: string }> => {
    return emitWithAck('set_favorite', { song, favorite }, { success: false, error: '连接超时，请重试' });
  }, []);

  const importFavorites = useCallback((songs: Song[]): Promise<{ success: boolean; favorites?: FavoriteSong[]; imported?: number; dropped?: number; maxFavorites?: number; error?: string }> => {
    return emitWithAck('import_favorites', { songs }, { success: false, error: '导入超时，请稍后重试' });
  }, []);



  const renameUser = useCallback((nickname: string): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'rename_user',
      { nickname },
      { success: false, error: '连接超时，请重试' },
    )
      .then((res) => {
        if (res.success && res.room) {
          applyRoomSnapshot(res.room);
          const myUserId = useRoomStore.getState().mySocketId;
          const resolvedNickname = (myUserId
            ? res.room.users.find((user) => user.id === myUserId)?.nickname
            : undefined)?.trim() || nickname.trim();
          useRoomStore.getState().setNickname(resolvedNickname);
          if (lastJoinSession) {
            lastJoinSession = { ...lastJoinSession, nickname: resolvedNickname };
          }
        }
        return res;
      });

  }, []);

  const transferOwner = useCallback((userId: string): Promise<{ success: boolean; error?: string; message?: string }> => {
    return emitWithAck<{ success: boolean; error?: string; message?: string; room?: RoomState }>(
      'transfer_owner',
      { userId },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setRoomAdmin = useCallback((userId: string, admin: boolean): Promise<{ success: boolean; error?: string; message?: string }> => {
    return emitWithAck<{ success: boolean; error?: string; message?: string; room?: RoomState }>(
      'set_room_admin',
      { userId, admin },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const kickUser = useCallback((userId: string): Promise<{ success: boolean; error?: string; message?: string }> => {
    return emitWithAck<{ success: boolean; error?: string; message?: string; room?: RoomState }>(
      'kick_user',
      { userId },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const renameRoomName = useCallback((name: string): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'rename_room',
      { name },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setRoomLock = useCallback((locked: boolean, password?: string): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_lock',
      { locked, password },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setRoomFmMode = useCallback((mode: string): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_fm_mode',
      { mode },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setRoomAnnouncement = useCallback((options: { enabled?: boolean; text?: string }): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_announcement',
      options,
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setSongRequestEnabled = useCallback((options: {
    enabled?: boolean;
    minStaySec?: number;
    maxPerUser?: number;
  }): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_song_request',
      options,
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setRoomAudioQuality = useCallback((quality: { netease: string; tencent: string }): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_audio_quality',
      quality,
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setRoomMemberTier = useCallback((
    userId: string,
    tier: { badgeLabel: string; badgeColor: string; borderStyleId: string; borderColor: string },
  ): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_member_tier',
      { userId, tier },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const removeRoomMemberTier = useCallback((userId: string): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'remove_room_member_tier',
      { userId },
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setRoomMemberSettings = useCallback((settings: {
    welcomeEnabled: boolean;
    welcomeTemplateId: string;
    welcomeCustomText?: string;
  }): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_room_member_settings',
      settings,
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);

  const setChatMute = useCallback((options: { muteAll?: boolean; userId?: string; muted?: boolean }): Promise<{ success: boolean; error?: string; room?: RoomState }> => {
    return emitWithAck<{ success: boolean; error?: string; room?: RoomState }>(
      'set_chat_mute',
      options,
      { success: false, error: '连接超时，请重试' },
    ).then((res) => {
      if (res.success && res.room) {
        applyRoomSnapshot(res.room);
      }
      return res;
    });
  }, []);



  const loadChatHistory = useCallback((before: number, beforeId: string): Promise<{
    success: boolean;
    messages?: ChatMessage[];
    hasMore?: boolean;
    error?: string;
  }> => {
    return emitWithAck<{ success: boolean; messages?: ChatMessage[]; hasMore?: boolean; error?: string }>(
      'load_chat_history',
      { before, beforeId, limit: 50 },
      { success: false, error: '连接超时，请重试' },
    );
  }, []);

  const loadSongHistory = useCallback((): Promise<{
    success: boolean;
    songs?: SongHistoryItem[];
    error?: string;
  }> => {
    const roomId = useRoomStore.getState().room?.id;
    if (!roomId) return Promise.resolve({ success: false, error: '未加入房间' });
    useSongHistoryStore.getState().setLoading(true);
    return emitWithAck<{ success: boolean; songs?: SongHistoryItem[]; error?: string }>(
      'load_song_history',
      { limit: 150 },
      { success: false, error: '连接超时，请重试' },
    )
      .then((res) => {
        if (useRoomStore.getState().room?.id !== roomId) {
          if (useSongHistoryStore.getState().roomId === roomId) {
            useSongHistoryStore.getState().setLoading(false);
          }
          return res;
        }
        if (res.success && res.songs) {
          useSongHistoryStore.getState().setSongs(roomId, res.songs);
        } else {
          useSongHistoryStore.getState().setLoading(false);
        }
        return res;
      });
  }, []);

  return {

    joinRoom,

    leaveRoom,

    addSong,

    skipSong,
    finishSong,

    togglePlay,

    seek,

    removeSong,

    clearQueue,

    requestJump,
    toggleQueueLike,

    approveJump,

    rejectJump,

    requestSkip,

    approveSkip,

    rejectSkip,

    sendChat,

    toggleChatReaction,


    listFavorites,

    setFavorite,
    importFavorites,
    renameUser,

    kickUser,

    transferOwner,

    setRoomAdmin,

    renameRoomName,

    setRoomLock,

    setRoomFmMode,

    setRoomAnnouncement,

    setSongRequestEnabled,

    setRoomAudioQuality,

    setRoomMemberTier,

    removeRoomMemberTier,

    setRoomMemberSettings,

    setChatMute,

    loadChatHistory,

    loadSongHistory,

    connect,

  };

}
