import { X } from 'lucide-react';
import type { RoomVisualFxSettings } from '../lib/roomVisualPreset';
import { DEFAULT_ROOM_VISUAL_FX } from '../lib/roomVisualPreset';

interface Props {
  open: boolean;
  value: RoomVisualFxSettings;
  onChange: (next: RoomVisualFxSettings) => void;
  onClose: () => void;
}

function SliderRow({
  label,
  min,
  max,
  step,
  value,
  onChange,
  formatValue,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  formatValue?: (v: number) => string;
}) {
  const display = formatValue ? formatValue(value) : value.toFixed(2);
  return (
    <label className="block space-y-1.5">
      <div className="flex items-center justify-between text-xs text-white/70">
        <span>{label}</span>
        <span className="tabular-nums text-white/45">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-cyan-300"
      />
    </label>
  );
}

export default function RoomVisualFxPanel({ open, value, onChange, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[55] flex items-end justify-center p-4 sm:items-center">
      <button type="button" className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-label="关闭" />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-white/10 bg-black/55 p-4 shadow-2xl backdrop-blur-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-medium text-white">视觉参数</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4">
          <SliderRow
            label="镜头远近"
            min={0.55}
            max={1.65}
            step={0.01}
            value={value.cameraDistance}
            onChange={(cameraDistance) => onChange({ ...value, cameraDistance })}
            formatValue={(v) => (v < 0.9 ? '较近' : v > 1.1 ? '较远' : '默认')}
          />
          <SliderRow label="强度" min={0.2} max={1.6} step={0.01} value={value.intensity} onChange={(intensity) => onChange({ ...value, intensity })} />
          <SliderRow label="深度" min={0.2} max={1.8} step={0.01} value={value.depth} onChange={(depth) => onChange({ ...value, depth })} />
          <SliderRow label="粒子大小" min={0.5} max={2.2} step={0.01} value={value.point} onChange={(point) => onChange({ ...value, point })} />
          <SliderRow label="速度" min={0.2} max={2.5} step={0.01} value={value.speed} onChange={(speed) => onChange({ ...value, speed })} />
          <SliderRow label="色彩" min={0.5} max={2} step={0.01} value={value.colorBoost} onChange={(colorBoost) => onChange({ ...value, colorBoost })} />
          <SliderRow label="光晕" min={0} max={1.6} step={0.01} value={value.bloomStrength} onChange={(bloomStrength) => onChange({ ...value, bloomStrength })} />
        </div>
        <button
          type="button"
          onClick={() => onChange({ ...DEFAULT_ROOM_VISUAL_FX })}
          className="mt-4 w-full rounded-xl border border-white/10 px-3 py-2 text-xs text-white/70 hover:bg-white/5 hover:text-white"
        >
          恢复默认
        </button>
      </div>
    </div>
  );
}
