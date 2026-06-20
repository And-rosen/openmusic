import { useMemo, useState, useRef, useEffect } from 'react';
import { MessageCircle, Send, Smile } from 'lucide-react';
import { useRoomStore } from '../stores/roomStore';
import { useSocket } from '../hooks/useSocket';
import {
  getInitialQQFaces,
  loadQQFaces,
  parseQQFaceTokens,
  preloadQQFaceImages,
  qqFaceToken,
  type QFaceItem,
} from '../lib/qface';

const MAX_CHAT_LENGTH = 500;

export default function ChatPanel() {
  const room = useRoomStore((s) => s.room);
  const nickname = useRoomStore((s) => s.nickname);
  const mySocketId = useRoomStore((s) => s.mySocketId);
  const { sendChat } = useSocket();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [qqFaces, setQQFaces] = useState<QFaceItem[]>(() => getInitialQQFaces());
  const [loadingFaces, setLoadingFaces] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const emojiPanelRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const roomIdRef = useRef<string | null>(null);
  const stickToBottomRef = useRef(true);

  const faceMap = useMemo(() => {
    return new Map(qqFaces.map((face) => [face.id, face]));
  }, [qqFaces]);

  useEffect(() => {
    if (!room?.id) return;
    if (roomIdRef.current !== room.id) {
      roomIdRef.current = room.id;
      stickToBottomRef.current = true;
    }
  }, [room?.id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const scrollToBottom = (behavior: ScrollBehavior) => {
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior, block: 'end' });
      });
    };

    if (stickToBottomRef.current) {
      scrollToBottom('instant');
      return;
    }

    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceToBottom < 120) {
      scrollToBottom('smooth');
    }
  }, [room?.messages.length, room?.id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distanceToBottom < 120;
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [room?.id]);

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

  useEffect(() => {
    let cancelled = false;

    setLoadingFaces(true);
    loadQQFaces()
      .then((faces) => {
        if (cancelled) return;
        setQQFaces(faces);
        preloadQQFaceImages(faces);
      })
      .finally(() => {
        if (!cancelled) setLoadingFaces(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!room) return null;

  const serializeEditor = () => {
    const editor = inputRef.current;
    if (!editor) return text;

    const readNode = (node: ChildNode): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
      if (!(node instanceof HTMLElement)) return '';
      if (node.dataset.qqFaceId) return qqFaceToken(node.dataset.qqFaceId);
      if (node.tagName === 'BR') return '';
      return Array.from(node.childNodes).map(readNode).join('');
    };

    return Array.from(editor.childNodes).map(readNode).join('');
  };

  const syncEditorText = () => {
    setText(serializeEditor());
  };

  const getSelectedTextLength = () => {
    const editor = inputRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount || !selection.anchorNode || !editor.contains(selection.anchorNode)) {
      return 0;
    }

    return selection.toString().length;
  };

  const clearEditor = () => {
    if (inputRef.current) inputRef.current.textContent = '';
    setText('');
  };

  const handleSend = async () => {
    const messageText = serializeEditor().trim();
    if (!messageText || sending) return;

    setText(messageText);
    setSending(true);
    setError('');
    const res = await sendChat(messageText);
    if (res.success) {
      clearEditor();
    } else {
      setError(res.error || '发送失败');
    }
    setSending(false);
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
      return;
    }

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
      syncEditorText();
    });
  };

  const renderMessageText = (messageText: string) => {
    return parseQQFaceTokens(messageText).map((part, index) => {
      if (typeof part === 'string') {
        return <span key={`text-${index}`}>{part}</span>;
      }

      const face = faceMap.get(part.id);
      if (!face) {
        return <span key={`face-${index}`} className="text-netease-muted">[QQ表情]</span>;
      }

      return (
        <img
          key={`face-${part.id}-${index}`}
          src={face.url}
          alt={face.text}
          title={face.text}
          className="mx-0.5 inline-block h-7 w-auto max-w-8 object-contain align-middle"
          loading="lazy"
        />
      );
    });
  };

  return (
    <div className="flex flex-col h-full bg-netease-card/30 border border-netease-border/50 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-netease-border/50 flex-shrink-0">
        <MessageCircle className="w-4 h-4 text-netease-muted" />
        <h3 className="text-sm font-medium">聊天室</h3>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0">
        {room.messages.length === 0 ? (
          <p className="text-xs text-netease-muted text-center py-8">暂无消息，打个招呼吧</p>
        ) : (
          room.messages.map((msg) => {
            const isMe = msg.userId === mySocketId;
            const isOwner = msg.userId === room.ownerId;
            return (
              <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className={`text-[10px] ${isMe ? 'text-netease-red/80' : 'text-netease-muted'}`}>
                    {msg.nickname}
                    {isOwner && <span className="ml-1 text-amber-400/80">房主</span>}
                  </span>
                </div>
                <div
                  className={`max-w-[90%] px-3 py-1.5 rounded-2xl text-sm leading-7 break-words ${
                    isMe
                      ? 'bg-netease-red/20 text-white rounded-br-md'
                      : 'bg-netease-dark/80 text-white/90 rounded-bl-md'
                  }`}
                >
                  {renderMessageText(msg.text)}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <div className="p-2 border-t border-netease-border/50 flex-shrink-0">
        {error && <p className="text-xs text-netease-red mb-1">{error}</p>}
        <div className="relative flex items-center gap-2" ref={emojiPanelRef}>
          {showEmoji && (
            <div className="absolute bottom-full left-0 mb-2 w-72 rounded-2xl border border-netease-border/70 bg-netease-dark/95 p-2 shadow-2xl backdrop-blur z-20">
              <div className="mb-1.5 flex items-center justify-between px-1">
                <span className="text-[11px] text-netease-muted">QQNT 表情</span>
                <span className="text-[10px] text-netease-muted/60">
                  {loadingFaces ? '正在补全...' : '点击插入'}
                </span>
              </div>
              <div className="grid max-h-64 grid-cols-8 gap-1 overflow-y-auto pr-0.5">
                {qqFaces.map((face) => (
                  <button
                    key={face.id}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertEmoji(face)}
                    className="flex h-8 items-center justify-center rounded-lg hover:bg-white/10 active:bg-white/15 transition-colors"
                    title={face.text}
                    aria-label={`插入表情 ${face.text}`}
                  >
                    <img src={face.url} alt="" className="h-6 w-auto max-w-7 object-contain" loading="lazy" />
                  </button>
                ))}
              </div>
              {!loadingFaces && qqFaces.length === 0 && (
                <p className="py-4 text-center text-xs text-netease-muted">表情加载失败，请稍后重试</p>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowEmoji((value) => !value)}
            className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-netease-border/50 transition-colors ${
              showEmoji
                ? 'bg-netease-red/15 text-netease-red border-netease-red/30'
                : 'bg-netease-dark text-netease-muted hover:text-white hover:bg-white/5'
            }`}
            title="QQ 表情"
            aria-label="打开 QQ 表情面板"
          >
            <Smile className="w-4 h-4" />
          </button>
          <div className="relative min-w-0 flex-1">
            {!text && (
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-netease-muted/50">
                {nickname || '你'}说点什么...
              </span>
            )}
            <div
              ref={inputRef}
              role="textbox"
              aria-label="聊天输入框"
              contentEditable
              suppressContentEditableWarning
              onBeforeInput={(event) => {
                const nativeEvent = event.nativeEvent as InputEvent;
                if (nativeEvent.inputType.startsWith('delete') || nativeEvent.isComposing) return;

                const data = nativeEvent.data || '';
                if (serializeEditor().length - getSelectedTextLength() + data.length > MAX_CHAT_LENGTH) {
                  event.preventDefault();
                  setError(`消息最多 ${MAX_CHAT_LENGTH} 字`);
                }
              }}
              onInput={syncEditorText}
              onPaste={(event) => {
                event.preventDefault();
                const remaining = MAX_CHAT_LENGTH - serializeEditor().length + getSelectedTextLength();
                if (remaining <= 0) {
                  setError(`消息最多 ${MAX_CHAT_LENGTH} 字`);
                  return;
                }

                const plainText = event.clipboardData.getData('text/plain').slice(0, remaining);
                document.execCommand('insertText', false, plainText);
                syncEditorText();
              }}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={() => {
                composingRef.current = false;
                syncEditorText();
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                if (e.nativeEvent.isComposing || composingRef.current) return;
                e.preventDefault();
                void handleSend();
              }}
              className="h-9 overflow-x-auto overflow-y-hidden whitespace-nowrap bg-netease-dark border border-netease-border/50 rounded-xl px-3 py-1.5 text-sm leading-6 text-white focus:outline-none focus:border-netease-red/40"
            />
          </div>
          <button
            onClick={handleSend}
            disabled={sending || !text.trim()}
            className="px-3 py-1.5 rounded-xl bg-netease-red text-white disabled:opacity-40 hover:bg-red-500 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
