import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Plus, Sparkles, X } from 'lucide-react';
import { NETEASE_FM_MODE_OPTIONS, getFmModeLabel, normalizeFmMode } from '../api/music/fmMode';

const ANNOUNCEMENT_MAX_LENGTH = 2000;
const MIN_STAY_MINUTES_MAX = 24 * 60;
const MAX_PER_USER_MAX = 50;

type SettingsTab = 'fm' | 'member' | 'announcement' | 'songRequest';

export interface SongRequestSettings {
  enabled: boolean;
  minStayMinutes: number;
  maxPerUser: number;
}

interface Props {
  open: boolean;
  isOwner: boolean;
  canModerate: boolean;
  fmMode: string;
  fmSaving?: boolean;
  announcementEnabled: boolean;
  announcementText: string;
  announcementSaving?: boolean;
  songRequest: SongRequestSettings;
  songRequestSaving?: boolean;
  memberTierCount: number;
  onClose: () => void;
  onSaveFmMode: (mode: string) => void;
  onOpenMemberModal: () => void;
  onSaveAnnouncement: (options: { enabled: boolean; text: string }) => void;
  onSaveSongRequest: (settings: SongRequestSettings) => void;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function Toggle({
  checked,
  disabled,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div>
        <p className="text-sm font-medium text-white">{label}</p>
        {description && <p className="mt-0.5 text-xs text-netease-muted">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${
          checked ? 'bg-netease-red' : 'bg-white/20'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </label>
  );
}

function NumberStepper({
  id,
  value,
  min,
  max,
  disabled,
  suffix,
  onChange,
}: {
  id?: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  suffix?: string;
  onChange: (next: number) => void;
}) {
  const setValue = (next: number) => onChange(clampInt(next, min, max));

  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="inline-flex items-stretch overflow-hidden rounded-lg border border-netease-border/60 bg-netease-dark">
        <button
          type="button"
          disabled={disabled || value <= min}
          onClick={() => setValue(value - 1)}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-netease-muted transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="减少"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '');
            if (!digits) {
              setValue(min);
              return;
            }
            setValue(Number(digits));
          }}
          className="h-8 w-14 flex-shrink-0 border-x border-netease-border/60 bg-transparent text-center text-sm tabular-nums text-white outline-none disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          disabled={disabled || value >= max}
          onClick={() => setValue(value + 1)}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-netease-muted transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="增加"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {suffix && <span className="text-sm text-netease-muted">{suffix}</span>}
    </div>
  );
}

export default function RoomSettingsModal({
  open,
  isOwner,
  canModerate,
  fmMode,
  fmSaving = false,
  announcementEnabled,
  announcementText,
  announcementSaving = false,
  songRequest,
  songRequestSaving = false,
  memberTierCount,
  onClose,
  onSaveFmMode,
  onOpenMemberModal,
  onSaveAnnouncement,
  onSaveSongRequest,
}: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('announcement');
  const [draftAnnouncementEnabled, setDraftAnnouncementEnabled] = useState(announcementEnabled);
  const [draftAnnouncementText, setDraftAnnouncementText] = useState(announcementText);
  const [draftSongRequest, setDraftSongRequest] = useState(songRequest);

  const tabs = useMemo(() => {
    const items: { id: SettingsTab; label: string }[] = [];
    if (isOwner) {
      items.push({ id: 'fm', label: '漫游' });
      items.push({ id: 'member', label: '贵宾' });
    }
    if (canModerate) {
      items.push({ id: 'announcement', label: '公告' });
      items.push({ id: 'songRequest', label: '点歌' });
    }
    return items;
  }, [isOwner, canModerate]);

  useEffect(() => {
    if (!open) return;
    setDraftAnnouncementEnabled(announcementEnabled);
    setDraftAnnouncementText(announcementText);
    setDraftSongRequest(songRequest);
    setActiveTab(tabs[0]?.id ?? 'announcement');
  }, [open, announcementEnabled, announcementText, songRequest, tabs]);

  if (!open) return null;

  const currentFm = normalizeFmMode(fmMode);
  const announcementDirty = draftAnnouncementEnabled !== announcementEnabled
    || draftAnnouncementText.trim() !== announcementText.trim();
  const songRequestDirty = draftSongRequest.enabled !== songRequest.enabled
    || draftSongRequest.minStayMinutes !== songRequest.minStayMinutes
    || draftSongRequest.maxPerUser !== songRequest.maxPerUser;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-label="关闭"
      />
      <div
        className="relative flex max-h-[min(88vh,640px)] w-full max-w-lg animate-fade-in flex-col rounded-2xl border border-white/10 bg-netease-dark shadow-2xl backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">房间设置</h2>
            <p className="mt-0.5 text-xs text-netease-muted">漫游、贵宾、公告与点歌规则</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {tabs.length > 1 && (
          <div className="flex flex-shrink-0 gap-1 overflow-x-auto border-b border-white/10 px-4 py-2.5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex-shrink-0 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'bg-white/10 font-medium text-white'
                    : 'text-netease-muted hover:bg-white/5 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {activeTab === 'fm' && isOwner && (
            <section>
              <p className="mb-3 text-xs text-netease-muted">
                队列为空时通过网易云私人漫游自动推荐下一首
              </p>
              <div className="space-y-1.5">
                {NETEASE_FM_MODE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={fmSaving}
                    onClick={() => onSaveFmMode(opt.value)}
                    className={`w-full rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                      currentFm === opt.value
                        ? 'border-netease-red/25 bg-netease-red/[0.08]'
                        : 'border-transparent bg-white/[0.03] hover:bg-white/[0.06]'
                    }`}
                  >
                    <p className={`text-sm font-medium ${currentFm === opt.value ? 'text-white' : 'text-white/90'}`}>
                      {opt.label}
                      {currentFm === opt.value && (
                        <span className="ml-2 text-[10px] font-normal text-netease-red">当前</span>
                      )}
                    </p>
                    {opt.description && (
                      <p className="mt-0.5 text-xs text-netease-muted">{opt.description}</p>
                    )}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-netease-muted">
                当前：{getFmModeLabel(currentFm)}
              </p>
            </section>
          )}

          {activeTab === 'member' && isOwner && (
            <section>
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-400" />
                <h3 className="text-sm font-medium text-white">贵宾角标</h3>
              </div>
              <p className="mb-3 text-xs text-netease-muted">
                为在线用户赋予角标，进房欢迎与点歌边框自动生效
              </p>
              <button
                type="button"
                onClick={onOpenMemberModal}
                className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.06]"
              >
                <span className="text-sm text-white">管理贵宾</span>
                <span className="text-xs text-netease-muted">
                  {memberTierCount > 0 ? `已设置 ${memberTierCount} 人` : '未设置'}
                </span>
              </button>
            </section>
          )}

          {activeTab === 'announcement' && canModerate && (
            <section>
              <div className="space-y-3">
                <Toggle
                  checked={draftAnnouncementEnabled}
                  disabled={announcementSaving}
                  onChange={setDraftAnnouncementEnabled}
                  label="开启公告"
                  description="新进房间的用户将弹窗展示公告"
                />
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label htmlFor="settings-announcement-text" className="text-xs text-netease-muted">
                      公告内容
                    </label>
                    <span className="text-[10px] text-netease-muted">
                      {draftAnnouncementText.length}/{ANNOUNCEMENT_MAX_LENGTH}
                    </span>
                  </div>
                  <textarea
                    id="settings-announcement-text"
                    value={draftAnnouncementText}
                    onChange={(e) => setDraftAnnouncementText(e.target.value.slice(0, ANNOUNCEMENT_MAX_LENGTH))}
                    disabled={announcementSaving}
                    rows={6}
                    placeholder="输入房间公告…"
                    className="w-full resize-none rounded-xl border border-netease-border/60 bg-netease-dark px-3 py-2 text-sm text-white outline-none focus:border-netease-red/50 disabled:opacity-50"
                  />
                </div>
                {announcementDirty && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={announcementSaving}
                      onClick={() => onSaveAnnouncement({
                        enabled: draftAnnouncementEnabled,
                        text: draftAnnouncementText.trim(),
                      })}
                      className="rounded-xl bg-netease-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-netease-red/90 disabled:opacity-50"
                    >
                      {announcementSaving ? '保存中…' : '保存公告'}
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}

          {activeTab === 'songRequest' && canModerate && (
            <section>
              <div className="space-y-3">
                <Toggle
                  checked={draftSongRequest.enabled}
                  disabled={songRequestSaving}
                  onChange={(enabled) => setDraftSongRequest((prev) => ({ ...prev, enabled }))}
                  label="允许成员点歌"
                  description="关闭后仅房主与管理员可点歌"
                />

                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <label htmlFor="settings-min-stay" className="text-sm font-medium text-white">
                    进房等待时间
                  </label>
                  <p className="mt-0.5 text-xs text-netease-muted">
                    新成员需待在房间一定时间后才能点歌，0 表示不限制
                  </p>
                  <NumberStepper
                    id="settings-min-stay"
                    value={draftSongRequest.minStayMinutes}
                    min={0}
                    max={MIN_STAY_MINUTES_MAX}
                    disabled={songRequestSaving}
                    suffix="分钟"
                    onChange={(minStayMinutes) => setDraftSongRequest((prev) => ({ ...prev, minStayMinutes }))}
                  />
                </div>

                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <label htmlFor="settings-max-per-user" className="text-sm font-medium text-white">
                    每人最多点歌
                  </label>
                  <p className="mt-0.5 text-xs text-netease-muted">
                    队列中每人最多保留几首（含正在播放），0 表示不限制
                  </p>
                  <NumberStepper
                    id="settings-max-per-user"
                    value={draftSongRequest.maxPerUser}
                    min={0}
                    max={MAX_PER_USER_MAX}
                    disabled={songRequestSaving}
                    suffix="首"
                    onChange={(maxPerUser) => setDraftSongRequest((prev) => ({ ...prev, maxPerUser }))}
                  />
                </div>

                {songRequestDirty && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={songRequestSaving}
                      onClick={() => onSaveSongRequest(draftSongRequest)}
                      className="rounded-xl bg-netease-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-netease-red/90 disabled:opacity-50"
                    >
                      {songRequestSaving ? '保存中…' : '保存点歌规则'}
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
