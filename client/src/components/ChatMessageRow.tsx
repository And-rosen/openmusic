import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Reply, Smile } from 'lucide-react';
import type { ChatMessage, ChatReplyRef, RoomMemberTier, RoomUser } from '../types';
import QFaceImage from './QFaceImage';
import Tooltip from './Tooltip';
import MemberTierBadge from './MemberTierBadge';
import RoleBadge from './RoleBadge';
import { ChatMessageReactions } from './ChatMessageReactions';
import ChatMessageContextMenu, { type ChatMessageMenuPos } from './ChatMessageContextMenu';
import {
  CHAT_PHOTO_CLASS,
  CHAT_STICKER_CLASS,
  canRecallChatMessage,
  formatChatTime,
  isChatStickerMessage,
  tokenizeMentionSegments,
} from '../lib/chatPanelUtils';
import { parseQQFaceTokens, QFaceLoadPriority } from '../lib/qface';

export type ChatRoomMeta = {
  id: string;
  creatorId: string;
  adminIds: string[];
  users: RoomUser[];
  memberTiers?: Record<string, RoomMemberTier>;
  muteAll?: boolean;
};

function renderMessageText(
  messageText: string,
  variant: 'message' | 'reply',
  chatScrollRoot: HTMLDivElement | null,
  nicknames: string[],
) {
  const isReply = variant === 'reply';
  const faceClass = isReply
    ? 'mx-0.5 inline-block h-4 w-auto max-w-5 object-contain align-middle'
    : 'mx-0.5 inline-block h-7 w-auto max-w-8 object-contain align-middle';
  const facePlaceholderClass = isReply
    ? 'mx-0.5 inline-block h-4 w-4 align-middle'
    : 'mx-0.5 inline-block h-7 w-6 align-middle';
  const keyPrefix = isReply ? 'reply' : 'msg';

    return parseQQFaceTokens(messageText).map((part, index) => {
      if (typeof part === 'string') {
        return tokenizeMentionSegments(part, nicknames).map((segment, segIndex) => (
          segment.type === 'mention'
            ? <span key={`${keyPrefix}-mention-${index}-${segIndex}`} className="break-words text-sky-300 [overflow-wrap:anywhere]">{segment.value}</span>
            : <span key={`${keyPrefix}-text-${index}-${segIndex}`} className="break-words [overflow-wrap:anywhere]">{segment.value}</span>
        ));
      }
    return (
      <QFaceImage
        key={`${keyPrefix}-face-${part.id}-${index}`}
        id={part.id}
        priority={QFaceLoadPriority.MESSAGE}
        nearPriority={QFaceLoadPriority.NEAR}
        observeRoot={chatScrollRoot}
        className={faceClass}
        placeholderClassName={facePlaceholderClass}
      />
    );
  });
}

function renderReplyRefContent(
  reply: ChatReplyRef,
  chatScrollRoot: HTMLDivElement | null,
  nicknames: string[],
  alignEnd = false,
) {
  const hasText = reply.text.trim().length > 0;
  const isSticker = isChatStickerMessage(reply.imageUrl, reply.imageKey, reply.asSticker);
  const isPhoto = Boolean(reply.imageUrl && !isSticker);

  return (
    <span className={`inline-flex min-w-0 max-w-full flex-wrap items-center gap-1 ${alignEnd ? 'justify-end' : ''}`}>
      {hasText && renderMessageText(reply.text, 'reply', chatScrollRoot, nicknames)}
      {isSticker && reply.imageUrl && (
        <img
          src={reply.imageUrl}
          alt="表情包"
          loading="lazy"
          className="max-h-8 max-w-[3.5rem] shrink-0 rounded object-contain"
        />
      )}
      {isSticker && !reply.imageUrl && !hasText && <span>[表情包]</span>}
      {isPhoto && !hasText && <span>[图片]</span>}
    </span>
  );
}

export interface ChatMessageRowProps {
  msg: ChatMessage;
  room: ChatRoomMeta;
  myUserId: string;
  pureMode: boolean;
  pureImageRevealed: boolean;
  reactionPickerOpen: boolean;
  chatMuted: boolean;
  canModerate?: boolean;
  chatScrollRoot: HTMLDivElement | null;
  chatPanelRef: React.RefObject<HTMLDivElement | null>;
  onReply: (msg: ChatMessage) => void;
  onRecall?: (msg: ChatMessage) => void;
  onMentionUser: (user: RoomUser) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onOpenReactionPicker: (messageId: string | null) => void;
  onRevealPureImage: (messageId: string) => void;
  onPreviewImage: (url: string) => void;
  onContentResize?: () => void;
}

function ChatMessageRow({
  msg,
  room,
  myUserId,
  pureMode,
  pureImageRevealed,
  reactionPickerOpen,
  chatMuted,
  canModerate = false,
  chatScrollRoot,
  chatPanelRef,
  onReply,
  onRecall,
  onMentionUser,
  onToggleReaction,
  onOpenReactionPicker,
  onRevealPureImage,
  onPreviewImage,
  onContentResize,
}: ChatMessageRowProps) {
  const [menuPos, setMenuPos] = useState<ChatMessageMenuPos | null>(null);
  const userMap = useMemo(
    () => new Map(room.users.map((user) => [user.id, user])),
    [room.users],
  );
  const nicknames = useMemo(() => room.users.map((user) => user.nickname), [room.users]);
  const canRecall = canRecallChatMessage(msg, myUserId, {
    canModerate,
    isOwner: Boolean(room.creatorId && myUserId === room.creatorId),
    creatorId: room.creatorId,
    adminIds: room.adminIds,
  });

  const closeMenu = useCallback(() => setMenuPos(null), []);

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuPos({ x: event.clientX, y: event.clientY });
  }, []);

  if (msg.kind === 'welcome') {
    if (pureMode) return null;
    return (
      <WelcomeChatRow msg={msg} onContentResize={onContentResize} />
    );
  }

  if (msg.kind === 'recall') {
    return (
      <div className="flex justify-center px-2 py-1">
        <p className="max-w-[92%] text-center text-[11px] leading-5 text-netease-muted/80">
          {msg.text}
        </p>
      </div>
    );
  }

  const isMe = msg.userId === myUserId;
  const isRoomCreator = msg.userId === room.creatorId;
  const isRoomAdmin = room.adminIds.includes(msg.userId);
  const userMemberTier = room.memberTiers?.[msg.userId];
  const user = userMap.get(msg.userId);
  const isStickerImage = isChatStickerMessage(msg.imageUrl, msg.imageKey, msg.asSticker);
  const isPureStickerHidden = pureMode && isStickerImage && !pureImageRevealed;
  const isPhotoOnly = Boolean(
    msg.imageUrl && !msg.text && !isStickerImage && (!pureMode || pureImageRevealed),
  );
  const bubbleClass = `min-w-0 max-w-full rounded-2xl text-sm leading-7 break-words [overflow-wrap:anywhere] ${isPhotoOnly ? 'p-1' : 'px-3 py-1.5'} ${isMe ? 'rounded-br-md bg-netease-red/20 text-white' : 'rounded-bl-md bg-netease-dark/80 text-white/90'}`;
  const replyBubbleClass = `min-w-0 max-w-full rounded-2xl px-3 py-1.5 text-sm ${isMe ? 'rounded-br-md bg-netease-red/20 text-white' : 'rounded-bl-md bg-netease-dark/80 text-white/90'}`;

  const renderReplyPreview = () => {
    if (!msg.replyTo) return null;
    const borderClass = isMe ? 'border-r-2 border-white/20' : 'border-l-2 border-white/20';
    return (
      <div className={`min-w-0 max-w-full rounded-lg bg-black/20 px-2 py-1 text-xs leading-5 text-netease-muted ${borderClass}`}>
        <div className={`flex min-w-0 max-w-full flex-col gap-0.5 ${isMe ? 'items-end text-right' : 'items-start'}`}>
          <span>回复 {msg.replyTo.nickname}：</span>
          {renderReplyRefContent(msg.replyTo, chatScrollRoot, nicknames, isMe)}
        </div>
      </div>
    );
  };

  const renderStickerContent = () => {
    if (!isStickerImage) return null;
    if (!msg.imageUrl) {
      return <span className="text-white/70">[表情包]</span>;
    }
    if (isPureStickerHidden) {
      return (
        <button
          type="button"
          onClick={() => onRevealPureImage(msg.id)}
          className="text-sky-300/90 transition-colors hover:text-sky-200"
          aria-label="加载表情包"
        >
          表情包
        </button>
      );
    }
    return (
      <img
        src={msg.imageUrl}
        alt="表情包"
        loading={onContentResize ? 'eager' : 'lazy'}
        className={CHAT_STICKER_CLASS}
        onLoad={onContentResize}
      />
    );
  };

  const renderPhotoContent = () => {
    if (!msg.imageUrl || isStickerImage) return null;
    if (pureMode && !pureImageRevealed) {
      return (
        <button
          type="button"
          onClick={() => onRevealPureImage(msg.id)}
          className="text-sky-300/90 transition-colors hover:text-sky-200"
          aria-label="加载查看图片"
        >
          图片
        </button>
      );
    }
    if (pureMode && pureImageRevealed) {
      return (
        <div className="overflow-hidden rounded-lg">
          <img
            src={msg.imageUrl}
            alt="聊天图片"
            loading={onContentResize ? 'eager' : 'lazy'}
            className={CHAT_PHOTO_CLASS}
            onLoad={onContentResize}
          />
        </div>
      );
    }
    return (
      <Tooltip content="点击查看大图">
        <button
          type="button"
          onClick={() => onPreviewImage(msg.imageUrl!)}
          className="block cursor-zoom-in overflow-hidden rounded-lg"
          aria-label="查看聊天图片"
        >
          <img
            src={msg.imageUrl}
            alt="聊天图片"
            loading={onContentResize ? 'eager' : 'lazy'}
            className={CHAT_PHOTO_CLASS}
            onLoad={onContentResize}
          />
        </button>
      </Tooltip>
    );
  };

  return (
    <div className={`group flex w-full min-w-0 max-w-full flex-col ${isMe ? 'items-end' : 'items-start'}`}>
      <div className={`mb-0.5 flex max-w-full min-w-0 items-center gap-1.5 ${isMe ? 'flex-row-reverse' : ''}`}>
        <button
          type="button"
          onClick={() => user && onMentionUser(user)}
          className={`max-w-full truncate text-[10px] ${isMe ? 'text-netease-red/80' : 'text-netease-muted'} hover:text-sky-300`}
        >
          {msg.nickname}
        </button>
        {isRoomCreator && <RoleBadge role="owner" />}
        {isRoomAdmin && !isRoomCreator && <RoleBadge role="admin" />}
        {userMemberTier && <MemberTierBadge tier={userMemberTier} />}
        {msg.timestamp > 0 && (
          <Tooltip content={new Date(msg.timestamp).toLocaleString('zh-CN')} side="bottom">
            <time
              dateTime={new Date(msg.timestamp).toISOString()}
              className="text-[10px] text-netease-muted/65 tabular-nums whitespace-nowrap"
            >
              {formatChatTime(msg.timestamp)}
            </time>
          </Tooltip>
        )}
      </div>
      <div className={`flex min-w-0 max-w-[90%] items-start gap-1.5 ${isMe ? 'flex-row-reverse justify-end' : ''}`}>
        <div className={`flex min-w-0 max-w-full flex-col ${isMe ? 'items-end' : 'items-start'}`}>
          {isStickerImage ? (
            <div className={`flex min-w-0 max-w-full flex-col gap-1 ${isMe ? 'items-end' : 'items-start'}`}>
              {msg.replyTo && (
                <div className={replyBubbleClass} onContextMenu={handleContextMenu}>
                  {renderReplyPreview()}
                </div>
              )}
              <div className="min-w-0 max-w-full" onContextMenu={handleContextMenu}>
                {renderStickerContent()}
              </div>
            </div>
          ) : (
            <div className={bubbleClass} onContextMenu={handleContextMenu}>
              {msg.replyTo && (
                <div className={`mb-1 ${isPhotoOnly ? 'mx-1 mt-1' : ''}`}>
                  {renderReplyPreview()}
                </div>
              )}
              {renderPhotoContent()}
              {msg.text ? renderMessageText(msg.text, 'message', chatScrollRoot, nicknames) : null}
            </div>
          )}
          <ChatMessageReactions
            reactions={msg.reactions}
            myUserId={myUserId}
            alignEnd={isMe}
            onToggle={(emoji) => onToggleReaction(msg.id, emoji)}
            containerRef={chatPanelRef}
            scrollRoot={chatScrollRoot}
          />
        </div>
        <div
          className={`relative mt-1 flex flex-col gap-0.5 transition-opacity ${
            reactionPickerOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <Tooltip content="回复">
            <button
              type="button"
              onClick={() => onReply(msg)}
              className="rounded p-0.5 text-netease-muted hover:bg-white/10 hover:text-white"
              aria-label="回复"
            >
              <Reply className="h-3 w-3" />
            </button>
          </Tooltip>
          <Tooltip content="点评表情">
            <button
              type="button"
              disabled={chatMuted}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onOpenReactionPicker(reactionPickerOpen ? null : msg.id)}
              className="rounded p-0.5 text-netease-muted hover:bg-white/10 hover:text-white disabled:opacity-40"
              aria-label="点评表情"
            >
              <Smile className="h-3 w-3" />
            </button>
          </Tooltip>
        </div>
      </div>

      <ChatMessageContextMenu
        open={menuPos !== null}
        pos={menuPos}
        canRecall={Boolean(canRecall && onRecall)}
        chatMuted={chatMuted}
        containerRef={chatPanelRef}
        onClose={closeMenu}
        onRecall={() => onRecall?.(msg)}
        onReaction={() => onOpenReactionPicker(msg.id)}
        onReply={() => onReply(msg)}
      />
    </div>
  );
}

function WelcomeChatRow({
  msg,
  onContentResize,
}: {
  msg: ChatMessage;
  onContentResize?: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!onContentResize) return;
    const el = rowRef.current;
    if (!el) return;
    onContentResize();
    const ro = new ResizeObserver(() => onContentResize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [msg.id, msg.text, onContentResize]);

  return (
    <div ref={rowRef} className="flex justify-center py-1">
      <div className="welcome-chat-card max-w-[92%] rounded-2xl px-4 py-3 text-center">
        <div className="mb-2 flex flex-wrap items-center justify-center gap-2">
          {msg.memberTier && <MemberTierBadge tier={msg.memberTier} />}
          {msg.targetNickname && (
            <span className="text-sm font-medium text-white">{msg.targetNickname}</span>
          )}
        </div>
        <p className="break-words text-sm leading-6 text-white/95 [overflow-wrap:anywhere]">{msg.text}</p>
        {msg.timestamp > 0 && (
          <p className="mt-2 text-[10px] text-netease-muted/70">{formatChatTime(msg.timestamp)}</p>
        )}
      </div>
    </div>
  );
}

function reactionsKey(reactions: ChatMessage['reactions']) {
  return (reactions || [])
    .map((r) => `${r.emoji}:${r.users.length}`)
    .join(',');
}

export default memo(ChatMessageRow, (prev, next) => (
  prev.msg.id === next.msg.id
  && prev.msg.kind === next.msg.kind
  && prev.msg.text === next.msg.text
  && prev.msg.imageUrl === next.msg.imageUrl
  && prev.msg.imageKey === next.msg.imageKey
  && prev.msg.asSticker === next.msg.asSticker
  && reactionsKey(prev.msg.reactions) === reactionsKey(next.msg.reactions)
  && prev.pureMode === next.pureMode
  && prev.pureImageRevealed === next.pureImageRevealed
  && prev.reactionPickerOpen === next.reactionPickerOpen
  && prev.chatMuted === next.chatMuted
  && prev.canModerate === next.canModerate
  && prev.myUserId === next.myUserId
  && prev.room.creatorId === next.room.creatorId
  && prev.room.adminIds === next.room.adminIds
  && prev.room.memberTiers === next.room.memberTiers
  && prev.chatScrollRoot === next.chatScrollRoot
));

export { renderReplyRefContent };
