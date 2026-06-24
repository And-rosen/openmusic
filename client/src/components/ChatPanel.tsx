import { useMemo, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, MicOff, Reply, Send, Smile, X } from 'lucide-react';
import { useRoomStore } from '../stores/roomStore';
import { getClientId } from '../lib/clientId';
import { useSocket } from '../hooks/useSocket';
import type { ChatMessage, ChatReplyRef, RoomUser } from '../types';
import { isChatMutedForUser } from '../lib/chatMute';
import QFaceImage from './QFaceImage';
import {
  ensureQQFacesLoaded,
  getInitialQQFaces,
  hasFullQQFaces,
  parseQQFaceTokens,
  QFaceLoadPriority,
  qqFaceToken,
  requestQFaceImage,
  subscribeQQFaces,
  type QFaceItem,
} from '../lib/qface';

const MAX_CHAT_LENGTH = 500;

function compactReplyText(text: string) {
  return text.replace(/\s+/g, ' ').slice(0, 48);
}

export default function ChatPanel() {
  const room = useRoomStore((s) => s.room);
  const nickname = useRoomStore((s) => s.nickname);
  const mySocketId = useRoomStore((s) => s.mySocketId);
  const isOwner = useRoomStore((s) => s.isOwner);
  const { sendChat, setChatMute } = useSocket();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [replyTo, setReplyTo] = useState<ChatReplyRef | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showMutePicker, setShowMutePicker] = useState(false);
  const [muteSaving, setMuteSaving] = useState(false);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [qqFaces, setQQFaces] = useState<QFaceItem[]>(() => getInitialQQFaces());
  const [loadingFaces, setLoadingFaces] = useState(() => !hasFullQQFaces());
  const bottomRef = useRef<HTMLDivElement>(null);
  const [chatScrollRoot, setChatScrollRoot] = useState<HTMLDivElement | null>(null);
  const [emojiGridRoot, setEmojiGridRoot] = useState<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const emojiPanelRef = useRef<HTMLDivElement>(null);
  const bindEmojiGridRef = (el: HTMLDivElement | null) => {
    setEmojiGridRoot(el);
  };  const notifiedMessageIdsRef = useRef<Set<string>>(new Set());
  const composingRef = useRef(false);
  const roomIdRef = useRef<string | null>(null);
  const stickToBottomRef = useRef(true);
  const mentionQueryRef = useRef('');

  const mutedSet = useMemo(() => new Set(room?.mutedUserIds || []), [room?.mutedUserIds]);
  const myUserId = mySocketId || getClientId();
  const chatMuted = isChatMutedForUser(room, myUserId);

  const orderedMuteUsers = useMemo(() => {
    if (!room) return [];
    return room.users
      .filter((user) => user.id !== myUserId)
      .sort((a, b) => a.joinedAt - b.joinedAt);
  }, [room, myUserId]);

  const toggleMuteAll = async () => {
    if (muteSaving || !room) return;
    setMuteSaving(true);
    const res = await setChatMute({ muteAll: !room.muteAll });
    setMuteSaving(false);
    if (!res.success) setError(res.error || '操作失败');
  };

  const toggleUserMute = async (user: RoomUser) => {
    if (muteSaving || user.id === myUserId) return;
    setMuteSaving(true);
    const muted = !mutedSet.has(user.id);
    const res = await setChatMute({ userId: user.id, muted });
    setMuteSaving(false);
    if (!res.success) setError(res.error || '操作失败');
  };

  const userMap = useMemo(() => new Map((room?.users || []).map((user) => [user.id, user])), [room?.users]);
  const [mentionQuery, setMentionQuery] = useState('');
  const mentionUsers = useMemo(() => {
    const myUserId = mySocketId || getClientId();
    const query = mentionQuery.trim().toLowerCase();
    return (room?.users || [])
      .filter((user) => user.id !== myUserId)
      .filter((user) => !query || user.nickname.toLowerCase().includes(query))
      .slice(0, 8);
  }, [mentionQuery, mySocketId, room?.users]);

  useEffect(() => {
    if (!room?.id) return;
    if (roomIdRef.current !== room.id) {
      roomIdRef.current = room.id;
      stickToBottomRef.current = true;
      setReplyTo(null);
      setShowMentionPicker(false);
      setMentionQuery('');
      mentionQueryRef.current = '';
      setMentionIndex(0);
      notifiedMessageIdsRef.current.clear();
    }
  }, [room?.id]);

  useEffect(() => {
    const el = chatScrollRoot;
    if (!el) return;
    const scrollToBottom = (behavior: ScrollBehavior) => requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior, block: 'end' }));
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (stickToBottomRef.current) scrollToBottom('instant');
    else if (distanceToBottom < 120) scrollToBottom('smooth');
  }, [chatScrollRoot, room?.messages.length, room?.id]);

  useEffect(() => {
    if (!room?.messages.length || typeof Notification === 'undefined') return;
    const myUserId = mySocketId || getClientId();
    const myName = nickname.trim();
    const latestMessages = room.messages.slice(-5);

    for (const msg of latestMessages) {
      if (notifiedMessageIdsRef.current.has(msg.id) || msg.userId === myUserId) continue;
      const mentionedById = msg.mentions?.some((mention) => mention.id === myUserId);
      const mentionedByName = myName ? msg.text.includes(`@${myName}`) : false;
      if (!mentionedById && !mentionedByName) continue;

      notifiedMessageIdsRef.current.add(msg.id);
      const notify = () => {
        if (Notification.permission !== 'granted') return;
        const notification = new Notification(`${msg.nickname} 提到了你`, {
          body: compactReplyText(msg.text),
          tag: `openmusic-mention-${room.id}-${msg.id}`,
          silent: false,
        });
        notification.onclick = () => window.focus();
      };

      if (Notification.permission === 'default') {
        void Notification.requestPermission().then(notify);
      } else {
        notify();
      }
    }
  }, [mySocketId, nickname, room?.id, room?.messages]);

  useEffect(() => {
    const el = chatScrollRoot;
    if (!el) return;
    const onScroll = () => {
      stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [chatScrollRoot, room?.id]);

  useEffect(() => {
    if (!showEmoji) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (emojiPanelRef.current?.contains(target)) return;
      setShowEmoji(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [showEmoji]);

  useEffect(() => subscribeQQFaces((faces) => {
    setQQFaces(faces);
    setLoadingFaces(!hasFullQQFaces());
  }), []);

  useEffect(() => {
    if (!showEmoji) return;
    ensureQQFacesLoaded();
  }, [showEmoji]);

  if (!room) return null;

  const readEditorNode = (node: ChildNode): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (!(node instanceof HTMLElement)) return '';
    if (node.dataset.qqFaceId) return qqFaceToken(node.dataset.qqFaceId);
    if (node.tagName === 'BR') return '';
    return Array.from(node.childNodes).map(readEditorNode).join('');
  };

  const serializeEditorNodes = (nodes: Iterable<ChildNode>) => {
    return Array.from(nodes).map(readEditorNode).join('');
  };

  const serializeEditor = () => {
    const editor = inputRef.current;
    if (!editor) return text;
    return serializeEditorNodes(editor.childNodes);
  };

  const getTextBeforeCursor = () => {
    const editor = inputRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return serializeEditor();
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return serializeEditor();
    const preRange = document.createRange();
    preRange.selectNodeContents(editor);
    preRange.setEnd(range.startContainer, range.startOffset);
    const container = document.createElement('div');
    container.appendChild(preRange.cloneContents());
    return serializeEditorNodes(container.childNodes);
  };

  const getActiveMentionQuery = (beforeCursor: string) => {
    const match = beforeCursor.match(/@([^\s@]*)$/);
    return match ? match[1] : null;
  };

  const syncEditorState = () => {
    const nextText = serializeEditor();
    setText(nextText);
    const activeQuery = getActiveMentionQuery(getTextBeforeCursor());
    if (activeQuery === null) {
      setShowMentionPicker(false);
      setMentionQuery('');
      mentionQueryRef.current = '';
      return;
    }
    const queryChanged = mentionQueryRef.current !== activeQuery;
    mentionQueryRef.current = activeQuery;
    setMentionQuery(activeQuery);
    const filtered = (room?.users || [])
      .filter((user) => user.id !== (mySocketId || getClientId()))
      .filter((user) => !activeQuery || user.nickname.toLowerCase().includes(activeQuery.toLowerCase()));
    setShowMentionPicker(filtered.length > 0);
    if (queryChanged) setMentionIndex(0);
  };

  const getSelectedTextLength = () => {
    const editor = inputRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount || !selection.anchorNode || !editor.contains(selection.anchorNode)) return 0;
    return selection.toString().length;
  };

  const insertPlainText = (value: string) => {
    const editor = inputRef.current;
    if (!editor) {
      setText((current) => `${current}${value}`.slice(0, MAX_CHAT_LENGTH));
      setShowMentionPicker(false);
      return;
    }
    editor.focus();
    document.execCommand('insertText', false, value);
    syncEditorState();
  };

  const clearEditor = () => {
    if (inputRef.current) inputRef.current.textContent = '';
    setText('');
    setShowMentionPicker(false);
    setMentionQuery('');
    mentionQueryRef.current = '';
    setMentionIndex(0);
  };

  const buildMentions = (messageText: string) => {
    return room.users
      .filter((user) => messageText.includes(`@${user.nickname}`))
      .slice(0, 10)
      .map((user) => ({ id: user.id, nickname: user.nickname }));
  };

  const handleSend = async () => {
    const messageText = serializeEditor().trim();
    if (!messageText || sending) return;

    const mentions = buildMentions(messageText);
    const currentReplyTo = replyTo;

    clearEditor();
    setReplyTo(null);
    setSending(true);
    setError('');

    const res = await sendChat(messageText, { mentions, replyTo: currentReplyTo });
    if (!res.success) {
      insertPlainText(messageText);
      setReplyTo(currentReplyTo);
      setError(res.error || '发送失败');
    }
    setSending(false);
  };

  const handleReply = (msg: ChatMessage) => {
    setReplyTo({ id: msg.id, userId: msg.userId, nickname: msg.nickname, text: compactReplyText(msg.text) });
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const deleteTextBeforeCursor = (count: number) => {
    const editor = inputRef.current;
    if (!editor || count <= 0) return;
    editor.focus();
    for (let i = 0; i < count; i += 1) {
      document.execCommand('delete', false, 'Backward');
    }
  };

  const handleAt = (user: RoomUser) => {
    const partialMention = getTextBeforeCursor().match(/@([^\s@]*)$/);
    if (partialMention) deleteTextBeforeCursor(partialMention[0].length);
    insertPlainText(`@${user.nickname} `);
    setShowMentionPicker(false);
    setMentionQuery('');
    mentionQueryRef.current = '';
    setMentionIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const insertEmoji = (face: QFaceItem) => {
    const editor = inputRef.current;
    const token = qqFaceToken(face.id);
    if (!editor) {
      setText((value) => `${value}${token}`.slice(0, MAX_CHAT_LENGTH));
      return;
    }
    if (serializeEditor().length - getSelectedTextLength() + token.length > MAX_CHAT_LENGTH) {
      setError(`消息最多 ${MAX_CHAT_LENGTH} 字`);
      editor.focus();
      setShowMentionPicker(false);
      return;
    }
    void requestQFaceImage(face.id, QFaceLoadPriority.MESSAGE).then(() => {
      const img = document.createElement('img');
      img.src = face.url;
      img.alt = face.text;
      img.title = face.text;
      img.dataset.qqFaceId = face.id;
      img.contentEditable = 'false';
      img.className = 'mx-0.5 inline-block h-5 w-auto max-w-6 object-contain align-[-0.2em]';
      const selection = window.getSelection();
      let range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const anchorNode = selection?.anchorNode;
      if (!range || !anchorNode || !editor.contains(anchorNode)) {
        range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
      }
      range.deleteContents();
      range.insertNode(img);
      range.setStartAfter(img);
      range.collapse(true);
      requestAnimationFrame(() => {
        editor.focus();
        selection?.removeAllRanges();
        selection?.addRange(range);
        syncEditorState();
      });
    });
  };

  const renderMessageText = (messageText: string) => {
    return parseQQFaceTokens(messageText).map((part, index) => {
      if (typeof part === 'string') {
        const pieces = part.split(/(@[^\s@]{1,24})/g);
        return pieces.map((piece, pieceIndex) => piece.startsWith('@')
          ? <span key={`mention-${index}-${pieceIndex}`} className="text-sky-300">{piece}</span>
          : <span key={`text-${index}-${pieceIndex}`}>{piece}</span>);
      }
      return (
        <QFaceImage
          key={`face-${part.id}-${index}`}
          id={part.id}
          priority={QFaceLoadPriority.MESSAGE}
          nearPriority={QFaceLoadPriority.NEAR}
          observeRoot={chatScrollRoot}
          className="mx-0.5 inline-block h-7 w-auto max-w-8 object-contain align-middle"
          placeholderClassName="mx-0.5 inline-block h-7 w-6 align-middle"
        />
      );
    });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-netease-border/50 bg-netease-card/30">
      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-netease-border/50 px-4 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <MessageCircle className="h-4 w-4 text-netease-muted" />
          <h3 className="text-sm font-medium">聊天室</h3>
          {room.muteAll && (
            <span className="text-[10px] text-amber-400/90 bg-amber-400/10 px-1.5 py-0.5 rounded-full">全体禁言</span>
          )}
        </div>
        {isOwner && (
          <button
            type="button"
            onClick={() => setShowMutePicker(true)}
            className={`rounded-lg p-1.5 transition-colors ${room.muteAll || mutedSet.size > 0 ? 'text-amber-400 hover:bg-amber-400/10' : 'text-netease-muted hover:bg-white/10 hover:text-white'}`}
            title="禁言管理"
          >
            <MicOff className="h-4 w-4" />
          </button>
        )}
      </div>

      <div ref={setChatScrollRoot} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {room.messages.length === 0 ? (
          <p className="py-8 text-center text-xs text-netease-muted">暂无消息，打个招呼吧</p>
        ) : room.messages.map((msg) => {
          const myUserId = mySocketId || getClientId();
          const isMe = msg.userId === myUserId;
          const isOwner = msg.userId === room.ownerId;
          const user = userMap.get(msg.userId);
          return (
            <div key={msg.id} className={`group flex flex-col ${isMe ? 'items-end' : 'items-start'}`} onContextMenu={(event) => { event.preventDefault(); handleReply(msg); }}>
              <div className="mb-0.5 flex items-center gap-1.5">
                <button type="button" onClick={() => user && handleAt(user)} className={`text-[10px] ${isMe ? 'text-netease-red/80' : 'text-netease-muted'} hover:text-sky-300`}>
                  {msg.nickname}{isOwner && <span className="ml-1 text-amber-400/80">房主</span>}
                </button>
              </div>
              <div className={`flex max-w-[90%] items-start gap-1.5 ${isMe ? 'justify-end' : ''}`}>
                <div className={`rounded-2xl px-3 py-1.5 text-sm leading-7 break-words ${isMe ? 'rounded-br-md bg-netease-red/20 text-white' : 'rounded-bl-md bg-netease-dark/80 text-white/90'}`}>
                  {msg.replyTo && (
                    <div className="mb-1 rounded-lg border-l-2 border-white/20 bg-black/20 px-2 py-1 text-xs leading-4 text-netease-muted">
                      回复 {msg.replyTo.nickname}：{compactReplyText(msg.replyTo.text)}
                    </div>
                  )}
                  {renderMessageText(msg.text)}
                </div>
                <button type="button" onClick={() => handleReply(msg)} className="mt-1 rounded p-0.5 text-netease-muted opacity-0 transition-opacity hover:bg-white/10 hover:text-white group-hover:opacity-100" title="回复">
                  <Reply className="h-3 w-3" />
                </button>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="flex-shrink-0 border-t border-netease-border/50 p-2">
        {chatMuted && (
          <p className="mb-1.5 text-center text-xs text-amber-400/90">
            {room.muteAll ? '房主已开启全体禁言' : '你已被禁言，无法发送消息'}
          </p>
        )}
        {replyTo && (
          <div className="mb-1.5 flex items-center justify-between rounded-xl bg-white/5 px-2 py-1 text-xs text-netease-muted">
            <span className="min-w-0 truncate">回复 {replyTo.nickname}：{compactReplyText(replyTo.text)}</span>
            <button type="button" onClick={() => setReplyTo(null)} className="ml-2 rounded p-0.5 hover:bg-white/10"><X className="h-3 w-3" /></button>
          </div>
        )}
        {error && <p className="mb-1 text-xs text-netease-red">{error}</p>}
        <div className="relative flex items-center gap-2" ref={emojiPanelRef}>
          {showEmoji && (
            <div className="absolute bottom-full left-0 z-20 mb-2 w-72 rounded-2xl border border-netease-border/70 bg-netease-dark/95 p-2 shadow-2xl backdrop-blur">
              <div className="mb-1.5 flex items-center justify-between px-1"><span className="text-[11px] text-netease-muted">QQNT 表情</span><span className="text-[10px] text-netease-muted/60">{loadingFaces ? '正在补全...' : '点击插入'}</span></div>
              <div ref={bindEmojiGridRef} className="grid max-h-64 grid-cols-8 gap-1 overflow-y-auto pr-0.5">
                {qqFaces.map((face) => (
                  <button
                    key={face.id}
                    type="button"
                    data-face-id={face.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertEmoji(face)}
                    className="flex h-8 items-center justify-center rounded-lg transition-colors hover:bg-white/10 active:bg-white/15"
                    title={face.text}
                  >
                    <QFaceImage
                      id={face.id}
                      priority={QFaceLoadPriority.PANEL}
                      nearPriority={QFaceLoadPriority.NEAR}
                      observeRoot={emojiGridRoot}
                      className="h-6 w-auto max-w-7 object-contain"
                      placeholderClassName="h-6 w-6"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
          <button type="button" onClick={() => setShowEmoji((value) => !value)} disabled={chatMuted} className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-netease-border/50 transition-colors disabled:opacity-40 ${showEmoji ? 'border-netease-red/30 bg-netease-red/15 text-netease-red' : 'bg-netease-dark text-netease-muted hover:bg-white/5 hover:text-white'}`} title="QQ 表情"><Smile className="h-4 w-4" /></button>
          <div className="relative min-w-0 flex-1">
            {showMentionPicker && (
              <div className="absolute bottom-full left-0 z-20 mb-2 w-56 overflow-hidden rounded-2xl border border-netease-border/70 bg-netease-dark/95 p-1.5 shadow-2xl backdrop-blur">
                {mentionUsers.map((user, index) => (
                  <button
                    key={user.id}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setMentionIndex(index)}
                    onClick={() => handleAt(user)}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors ${index === mentionIndex ? 'bg-white/10 text-white' : 'text-white/85 hover:bg-white/10'}`}
                  >
                    <span className="min-w-0 truncate">{user.nickname}</span>
                    {user.id === room.ownerId && <span className="ml-2 flex-shrink-0 text-[10px] text-amber-400/80">房主</span>}
                  </button>
                ))}
              </div>
            )}
            {!text && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-netease-muted/50">{nickname || '你'}说点什么...</span>}
            <div
              ref={inputRef}
              role="textbox"
              aria-label="聊天输入框"
              contentEditable={!chatMuted}
              suppressContentEditableWarning
              onBeforeInput={(event) => {
                const nativeEvent = event.nativeEvent as InputEvent;
                const inputType = nativeEvent.inputType ?? '';
                if (inputType.startsWith('delete') || nativeEvent.isComposing) return;
                const data = nativeEvent.data || '';
                if (serializeEditor().length - getSelectedTextLength() + data.length > MAX_CHAT_LENGTH) {
                  event.preventDefault();
                  setError(`消息最多 ${MAX_CHAT_LENGTH} 字`);
                }
              }}
              onInput={syncEditorState}
              onPaste={(event) => {
                event.preventDefault();
                const remaining = MAX_CHAT_LENGTH - serializeEditor().length + getSelectedTextLength();
                if (remaining <= 0) return setError(`消息最多 ${MAX_CHAT_LENGTH} 字`);
                document.execCommand('insertText', false, event.clipboardData.getData('text/plain').slice(0, remaining));
                syncEditorState();
              }}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => { composingRef.current = false; syncEditorState(); }}
              onKeyDown={(event) => {
                if (showMentionPicker && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                  event.preventDefault();
                  setMentionIndex((current) => {
                    const delta = event.key === 'ArrowDown' ? 1 : -1;
                    return (current + delta + mentionUsers.length) % mentionUsers.length;
                  });
                  return;
                }
                if (showMentionPicker && (event.key === 'Tab' || event.key === 'Enter')) {
                  event.preventDefault();
                  const user = mentionUsers[mentionIndex];
                  if (user) handleAt(user);
                  return;
                }
                if (event.key === 'Escape' && showMentionPicker) {
                  event.preventDefault();
                  setShowMentionPicker(false);
                  setMentionIndex(0);
                  return;
                }
                if (event.key !== 'Enter') return;
                if (event.nativeEvent.isComposing || composingRef.current) return;
                event.preventDefault();
                void handleSend();
              }}
              className={`h-9 overflow-x-auto overflow-y-hidden whitespace-nowrap rounded-xl border border-netease-border/50 bg-netease-dark px-3 py-1.5 text-sm leading-6 text-white focus:border-netease-red/40 focus:outline-none ${chatMuted ? 'opacity-50 pointer-events-none' : ''}`}
            />
          </div>
          <button onClick={handleSend} disabled={sending || !text.trim() || chatMuted} className="rounded-xl bg-netease-red px-3 py-1.5 text-white transition-colors hover:bg-red-500 disabled:opacity-40"><Send className="h-4 w-4" /></button>
        </div>
      </div>

      {showMutePicker && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowMutePicker(false)} aria-label="关闭" />
          <div className="relative w-full max-w-sm glass rounded-2xl border border-white/10 shadow-2xl p-4 animate-fade-in">
            <div className="flex items-center justify-between mb-3 px-1">
              <h2 className="text-base font-semibold text-white">禁言管理</h2>
              <button type="button" onClick={() => setShowMutePicker(false)} className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10"><X className="w-5 h-5" /></button>
            </div>
            <div className="max-h-72 overflow-y-auto space-y-1 pr-0.5">
              <button
                type="button"
                disabled={muteSaving}
                onClick={() => void toggleMuteAll()}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-colors disabled:opacity-50 ${room.muteAll ? 'bg-amber-400/15 text-amber-300' : 'text-white/90 hover:bg-white/10'}`}
              >
                <span className="font-medium">全体禁言</span>
                <span className="text-xs text-netease-muted">{room.muteAll ? '点击解禁' : '点击禁言'}</span>
              </button>
              {orderedMuteUsers.map((user) => {
                const isMuted = mutedSet.has(user.id);
                return (
                  <button
                    key={user.id}
                    type="button"
                    disabled={muteSaving}
                    onClick={() => void toggleUserMute(user)}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-colors disabled:opacity-40 ${isMuted ? 'bg-amber-400/15 text-amber-300' : 'text-white/90 hover:bg-white/10'}`}
                  >
                    <span className="min-w-0 truncate">{user.nickname}</span>
                    <span className="ml-2 flex-shrink-0 text-xs text-netease-muted">
                      {isMuted ? '点击解禁' : '点击禁言'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
