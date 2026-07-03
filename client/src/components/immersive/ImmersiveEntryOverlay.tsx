import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';

interface Props {
  visible: boolean;
  revealing?: boolean;
  coverUrl?: string | null;
}

export default function ImmersiveEntryOverlay({ visible, revealing = false, coverUrl }: Props) {
  if (!visible) return null;

  return createPortal(
    <div
      className={`immersive-entry-overlay${revealing ? ' is-revealing' : ''}`}
      role="status"
      aria-live="polite"
      aria-busy={!revealing}
    >
      {coverUrl ? (
        <div
          className="immersive-entry-cover"
          style={{ backgroundImage: `url(${coverUrl})` }}
          aria-hidden
        />
      ) : null}
      <div className="immersive-entry-scrim" aria-hidden />
      <div className="immersive-entry-content">
        <Loader2 className="immersive-entry-spinner" aria-hidden />
        <p className="immersive-entry-label">
          {revealing ? '沉浸视界已就绪' : '正在准备沉浸视界…'}
        </p>
        <p className="immersive-entry-hint">
          {revealing ? '即将呈现' : '加载视觉场景与音频分析'}
        </p>
      </div>
    </div>,
    document.body,
  );
}
