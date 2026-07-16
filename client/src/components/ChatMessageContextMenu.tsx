import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Reply, Smile, Trash2 } from 'lucide-react';

export type ChatMessageMenuPos = { x: number; y: number };

interface Props {
  open: boolean;
  pos: ChatMessageMenuPos | null;
  canRecall: boolean;
  chatMuted: boolean;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onRecall: () => void;
  onReaction: () => void;
  onReply: () => void;
}

const MENU_WIDTH = 148;

export default function ChatMessageContextMenu({
  open,
  pos,
  canRecall,
  chatMuted,
  containerRef,
  onClose,
  onRecall,
  onReaction,
  onReply,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (panelRef.current?.contains(target)) return;
      onClose();
    };
    const onScroll = () => onClose();

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown, { passive: true });
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, onClose]);

  if (!open || !pos) return null;

  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const left = Math.min(Math.max(8, pos.x), viewportW - MENU_WIDTH - 8);
  const top = Math.min(Math.max(8, pos.y), viewportH - 140);

  const host = containerRef?.current || document.body;

  const itemClass =
    'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-white/90 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      aria-label="消息菜单"
      className="fixed z-[90] min-w-[9.25rem] rounded-xl border border-white/10 bg-netease-dark/95 p-1 shadow-2xl backdrop-blur-md animate-fade-in"
      style={{ left, top }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        disabled={!canRecall}
        className={`${itemClass} ${canRecall ? 'hover:text-rose-300' : ''}`}
        onClick={() => {
          if (!canRecall) return;
          onRecall();
          onClose();
        }}
      >
        <Trash2 className="h-3.5 w-3.5 shrink-0" />
        撤回
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={chatMuted}
        className={itemClass}
        onClick={() => {
          if (chatMuted) return;
          onReaction();
          onClose();
        }}
      >
        <Smile className="h-3.5 w-3.5 shrink-0" />
        表情回复
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={() => {
          onReply();
          onClose();
        }}
      >
        <Reply className="h-3.5 w-3.5 shrink-0" />
        回复
      </button>
    </div>,
    host,
  );
}
