import { useCallback, useRef, useState } from 'react';
import type { RoomVisualFxSettings } from '../../lib/roomVisualPreset';
import { DEFAULT_ROOM_VISUAL_FX } from '../../lib/roomVisualPreset';
import { FxSectionLabel, FxMineradioSlider } from '../RoomVisualFxSettingsBody';
import CoverColorPickerPopover from './CoverColorPickerPopover';

interface Props {
  value: RoomVisualFxSettings;
  onPatch: (patch: Partial<RoomVisualFxSettings>) => void;
  coverUrl?: string | null;
  dragging: boolean;
  draggingKey: string | null;
  setDraggingKey: (key: string | null) => void;
}

function ColorRow({
  label,
  color,
  small,
  onChange,
  onReset,
  resetLabel = '默认',
  extraButton,
  disabled,
}: {
  label: string;
  color: string;
  small: string;
  onChange: (hex: string) => void;
  onReset: () => void;
  resetLabel?: string;
  extraButton?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className={`lyric-color-row ${disabled ? 'pointer-events-none opacity-40' : ''}`}>
      <input
        type="color"
        className="lyric-color-picker"
        value={color}
        title={label}
        onChange={(e) => onChange(e.target.value.toLowerCase())}
      />
      <div className="fx-color-row-label">
        {label}
        <small>{small}</small>
      </div>
      {extraButton}
      <button type="button" className="fx-mini-btn ghost" onClick={onReset}>
        {resetLabel}
      </button>
    </div>
  );
}

export default function ImmersiveAppearanceControls({
  value,
  onPatch,
  coverUrl,
  dragging,
  draggingKey,
  setDraggingKey,
}: Props) {
  const [coverPickerTarget, setCoverPickerTarget] = useState<'visualTint' | 'backgroundColor' | null>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);

  const hidden = dragging ? 'pointer-events-none invisible' : '';

  const applyCoverColor = useCallback(
    (hex: string) => {
      if (coverPickerTarget === 'visualTint') {
        onPatch({ visualTintColor: hex, visualTintMode: 'custom' });
      } else if (coverPickerTarget === 'backgroundColor') {
        onPatch({ backgroundColor: hex, backgroundColorMode: 'custom' });
      }
      setCoverPickerTarget(null);
    },
    [coverPickerTarget, onPatch],
  );

  const onBgFile = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      if (dataUrl.length > 4_000_000) {
        window.dispatchEvent(
          new CustomEvent('openmusic:visual-toast', {
            detail: { message: '背景图片过大，请选择 3MB 以内的文件', type: 'error' },
          }),
        );
        return;
      }
      onPatch({ backgroundMedia: dataUrl });
    };
    reader.readAsDataURL(file);
  };

  return (
    <>
      <FxSectionLabel>自定义颜色</FxSectionLabel>
      <div className={hidden}>
        <ColorRow
          label="界面高亮"
          color={value.uiAccentColor}
          small={value.uiAccentColor.toUpperCase()}
          onChange={(uiAccentColor) => onPatch({ uiAccentColor })}
          onReset={() => onPatch({ uiAccentColor: DEFAULT_ROOM_VISUAL_FX.uiAccentColor })}
        />
        <ColorRow
          label="视觉主色"
          color={value.visualTintColor}
          small={value.visualTintMode === 'auto' ? '封面取色' : value.visualTintColor.toUpperCase()}
          onChange={(visualTintColor) => onPatch({ visualTintColor, visualTintMode: 'custom' })}
          onReset={() =>
            onPatch({
              visualTintMode: 'auto',
              visualTintColor: DEFAULT_ROOM_VISUAL_FX.visualTintColor,
            })
          }
          resetLabel="默认"
          extraButton={
            <button
              type="button"
              className="fx-mini-btn ghost"
              onClick={() => setCoverPickerTarget('visualTint')}
              disabled={!coverUrl}
            >
              封面
            </button>
          }
        />
        <ColorRow
          label="Home 填充"
          color={value.homeAccentColor}
          small={value.homeAccentColor.toUpperCase()}
          onChange={(homeAccentColor) => onPatch({ homeAccentColor })}
          onReset={() => onPatch({ homeAccentColor: DEFAULT_ROOM_VISUAL_FX.homeAccentColor })}
        />
        <ColorRow
          label="主页图标"
          color={value.homeIconColor}
          small={value.homeIconColor.toUpperCase()}
          onChange={(homeIconColor) => onPatch({ homeIconColor })}
          onReset={() => onPatch({ homeIconColor: DEFAULT_ROOM_VISUAL_FX.homeIconColor })}
        />
        <ColorRow
          label="视觉图标"
          color={value.visualIconColor}
          small={value.visualIconColor.toUpperCase()}
          onChange={(visualIconColor) => onPatch({ visualIconColor })}
          onReset={() => onPatch({ visualIconColor: DEFAULT_ROOM_VISUAL_FX.visualIconColor })}
        />
        <ColorRow
          label="背景颜色"
          color={value.backgroundColor}
          small={value.backgroundColorMode === 'cover' ? '封面' : value.backgroundColor.toUpperCase()}
          onChange={(backgroundColor) => onPatch({ backgroundColor, backgroundColorMode: 'custom' })}
          onReset={() =>
            onPatch({
              backgroundColorMode: 'cover',
              backgroundColor: DEFAULT_ROOM_VISUAL_FX.backgroundColor,
            })
          }
          resetLabel="封面"
          extraButton={
            <button
              type="button"
              className="fx-mini-btn ghost"
              onClick={() => setCoverPickerTarget('backgroundColor')}
              disabled={!coverUrl}
            >
              取色
            </button>
          }
        />
        <div className="lyric-color-row image-pick-row">
          <button type="button" className="fx-mini-btn ghost" onClick={() => bgInputRef.current?.click()}>
            选择
          </button>
          <div className="fx-color-row-label">
            背景媒体
            <small>{value.backgroundMedia ? '已设置' : '未设置'}</small>
          </div>
          <button
            type="button"
            className="fx-mini-btn ghost"
            onClick={() => onPatch({ backgroundMedia: null })}
            disabled={!value.backgroundMedia}
          >
            清除
          </button>
          <input
            ref={bgInputRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => {
              onBgFile(e.target.files?.[0] || null);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <FxSectionLabel>背景与玻璃</FxSectionLabel>
      <div
        className={
          draggingKey !== null && draggingKey !== 'backgroundOpacity'
            ? 'pointer-events-none invisible'
            : ''
        }
      >
        <FxMineradioSlider
          def={{
            key: 'backgroundOpacity' as never,
            label: '背景透明度',
            min: 0,
            max: 1,
            step: 0.01,
            formatValue: (v) => `${Math.round(v * 100)}%`,
          }}
          value={value.backgroundOpacity}
          defaultValue={DEFAULT_ROOM_VISUAL_FX.backgroundOpacity}
          onDragStart={() => setDraggingKey('backgroundOpacity')}
          onLiveChange={(backgroundOpacity) => onPatch({ backgroundOpacity })}
          onReset={() => onPatch({ backgroundOpacity: DEFAULT_ROOM_VISUAL_FX.backgroundOpacity })}
        />
      </div>
      <div
        className={
          draggingKey !== null && draggingKey !== 'controlGlassChromaticOffset'
            ? 'pointer-events-none invisible'
            : ''
        }
      >
        <FxMineradioSlider
          def={{
            key: 'controlGlassChromaticOffset' as never,
            label: '控制台玻璃色差',
            min: 0,
            max: 140,
            step: 1,
          }}
          value={value.controlGlassChromaticOffset}
          defaultValue={DEFAULT_ROOM_VISUAL_FX.controlGlassChromaticOffset}
          onDragStart={() => setDraggingKey('controlGlassChromaticOffset')}
          onLiveChange={(controlGlassChromaticOffset) => onPatch({ controlGlassChromaticOffset })}
          onReset={() =>
            onPatch({ controlGlassChromaticOffset: DEFAULT_ROOM_VISUAL_FX.controlGlassChromaticOffset })
          }
        />
      </div>

      {coverPickerTarget && coverUrl ? (
        <CoverColorPickerPopover
          coverUrl={coverUrl}
          onPick={applyCoverColor}
          onClose={() => setCoverPickerTarget(null)}
        />
      ) : null}
    </>
  );
}
