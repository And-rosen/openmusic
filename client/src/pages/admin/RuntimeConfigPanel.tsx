import { useEffect, useState } from 'react';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import {
  App,
  Button,
  Card,
  Col,
  Empty,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import AdminLoading from './AdminLoading';
import SettingsSection from './SettingsSection';
import type { RuntimeConfig } from './types';
import { adminFetch } from './utils';

type RuntimeTextField = Exclude<
  keyof RuntimeConfig,
  'roomEmptyTtlMs' | 'configuredSecrets' | 'metingApiUrl' | 'metingApiAuth' | 'metingSources'
>;

interface RuntimeFieldDef {
  key: RuntimeTextField;
  label: string;
  placeholder?: string;
  secret?: boolean;
  tip?: string;
}

interface RuntimeFieldGroup {
  id: string;
  title: string;
  purpose: string;
  fields: RuntimeFieldDef[];
  includeQiniuZone?: boolean;
}

const RUNTIME_FIELD_GROUPS: RuntimeFieldGroup[] = [
  {
    id: 'cyapi',
    title: '迟言 API',
    purpose: '酷狗（蓝点）音乐搜索与播放；也可用于部分图片审核能力。不配置则蓝点音源不可用。',
    fields: [
      { key: 'cyapiBase', label: 'API 地址', placeholder: 'https://cyapi.top/API' },
      { key: 'cyapiKey', label: 'API 密钥', secret: true },
    ],
  },
  {
    id: 'lyrics',
    title: '歌词备用',
    purpose: '主音源拿不到歌词时，按歌名向该接口兜底拉取。一般保持默认即可。',
    fields: [
      { key: 'vmyLrcUrl', label: '备用歌词 API', placeholder: 'https://api.52vmy.cn/api/music/lrc' },
    ],
  },
  {
    id: 'qiniu',
    title: '七牛云存储',
    purpose: '房间聊天发图依赖此项。四项齐全后才能上传图片；缺一则无法发送图片消息。',
    includeQiniuZone: true,
    fields: [
      { key: 'qiniuAccessKey', label: 'Access Key', secret: true },
      { key: 'qiniuSecretKey', label: 'Secret Key', secret: true },
      { key: 'qiniuBucket', label: 'Bucket', tip: '对象存储空间名称' },
      { key: 'qiniuDomain', label: 'CDN 域名', placeholder: 'https://cdn.example.com', tip: '对外访问图片用的域名，需带 https://' },
    ],
  },
  {
    id: 'apihz',
    title: '接口盒子',
    purpose: '表情包搜索与聊天敏感词检测共用。不配置则表情搜索 / 敏感词过滤不可用。',
    fields: [
      { key: 'apihzBaseUrl', label: 'API 地址', placeholder: 'https://cn.apihz.cn/api' },
      { key: 'apihzId', label: '用户 ID', secret: true },
      { key: 'apihzKey', label: '密钥', secret: true },
    ],
  },
];

export default function RuntimeConfigPanel({ onError }: { onError: (message: string) => void }) {
  const { message } = App.useApp();
  const [draft, setDraft] = useState<RuntimeConfig | null>(null);
  const [dirtySecrets, setDirtySecrets] = useState<Set<string>>(new Set());
  const [dirtyMetingAuth, setDirtyMetingAuth] = useState<Set<number>>(new Set());
  const [baselineSecrets, setBaselineSecrets] = useState<Record<string, string>>({});
  const [baselineMetingAuth, setBaselineMetingAuth] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const applyLoadedConfig = (config: RuntimeConfig) => {
    setDraft(config);
    setDirtySecrets(new Set());
    setDirtyMetingAuth(new Set());
    const secrets: Record<string, string> = {};
    for (const group of RUNTIME_FIELD_GROUPS) {
      for (const field of group.fields) {
        if (field.secret) secrets[field.key] = config[field.key] || '';
      }
    }
    setBaselineSecrets(secrets);
    setBaselineMetingAuth(config.metingSources.map((source) => source.auth || ''));
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch<{ config: RuntimeConfig }>('/api/admin/runtime-config');
        if (!cancelled) applyLoadedConfig(res.config);
      } catch (err) {
        if (!cancelled) onError(err instanceof Error ? err.message : '加载运行配置失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onError]);

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      const clearSecrets: string[] = [];
      const payload: RuntimeConfig & { clearSecrets: string[] } = {
        ...draft,
        clearSecrets,
        metingSources: draft.metingSources.map((source, index) => {
          if (!dirtyMetingAuth.has(index)) {
            return { ...source, auth: '', clearAuth: false };
          }
          if (!String(source.auth || '').trim()) {
            return { ...source, auth: '', clearAuth: true };
          }
          return { ...source, clearAuth: false };
        }),
      };

      for (const group of RUNTIME_FIELD_GROUPS) {
        for (const field of group.fields) {
          if (!field.secret) continue;
          if (!dirtySecrets.has(field.key)) {
            payload[field.key] = '';
            continue;
          }
          if (!String(payload[field.key] || '').trim()) {
            clearSecrets.push(field.key);
            payload[field.key] = '';
          }
        }
      }

      const res = await adminFetch<{ config: RuntimeConfig }>('/api/admin/runtime-config', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      applyLoadedConfig(res.config);
      message.success('已保存并立即生效');
    } catch (err) {
      onError(err instanceof Error ? err.message : '保存运行配置失败');
    } finally {
      setSaving(false);
    }
  };

  if (!draft) {
    return <AdminLoading tip="加载运行配置…" minHeight={200} />;
  }

  const markSecretDirty = (key: RuntimeTextField, nextValue: string) => {
    setDirtySecrets((prev) => {
      const next = new Set(prev);
      if (nextValue === (baselineSecrets[key] || '')) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderField = (field: RuntimeFieldDef) => {
    const configured = Boolean(draft.configuredSecrets[field.key]);
    const dirty = dirtySecrets.has(field.key);
    return (
      <Col xs={24} sm={12} key={field.key}>
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
          {field.label}
          {field.secret && configured && !dirty && (
            <Tag color="success" style={{ marginLeft: 6 }}>已配置</Tag>
          )}
          {field.secret && dirty && !String(draft[field.key] || '').trim() && (
            <Tag color="warning" style={{ marginLeft: 6 }}>保存后关闭</Tag>
          )}
        </Typography.Text>
        <Input
          value={draft[field.key]}
          onChange={(e) => {
            const nextValue = e.target.value;
            setDraft({ ...draft, [field.key]: nextValue });
            if (field.secret) markSecretDirty(field.key, nextValue);
          }}
          placeholder={field.secret
            ? (configured ? '清空保存则关闭该功能' : '填入后启用')
            : field.placeholder}
          autoComplete="off"
          spellCheck={false}
          style={{ fontFamily: 'monospace' }}
        />
        {field.tip && (
          <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
            {field.tip}
          </Typography.Text>
        )}
      </Col>
    );
  };

  const updateMetingSource = (
    index: number,
    patch: Partial<RuntimeConfig['metingSources'][number]>,
  ) => {
    const metingSources = draft.metingSources.map((source, sourceIndex) => (
      sourceIndex === index ? { ...source, ...patch } : source
    ));
    setDraft({ ...draft, metingSources });
  };

  return (
    <>
      <SettingsSection
        title="房间"
        description="无人房间保留多久后自动销毁；设为 0 表示最后一人离开立即销毁。"
      >
        <Space>
          <InputNumber
            min={0}
            max={1440}
            step={1}
            value={Math.round(draft.roomEmptyTtlMs / 60000)}
            onChange={(val) => setDraft({ ...draft, roomEmptyTtlMs: Math.max(0, Number(val) || 0) * 60000 })}
            aria-label="空房销毁时间（分钟）"
            style={{ width: 100 }}
          />
          <Typography.Text type="secondary">分钟后销毁空房</Typography.Text>
        </Space>
      </SettingsSection>

      <SettingsSection
        title="Meting 音源"
        description={(
          <>
            网易云 / QQ 音乐的搜索、播放、歌词与歌单导入。多个源轮询使用，故障自动切换。
            <br />
            <Typography.Text type="secondary" style={{ color: '#1677ff' }}>
              ChKSz 源仅支持网易云，无需 Auth。
            </Typography.Text>
          </>
        )}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          {draft.metingSources.length === 0 && (
            <Empty description="暂无音源，点击下方按钮添加" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
          {draft.metingSources.map((source, index) => (
            <Card key={`${index}-${source.type}`} size="small" style={{ background: '#fafafa' }}>
              <Row gutter={[8, 8]} align="middle">
                <Col xs={24} sm={6}>
                  <Select
                    value={source.type}
                    aria-label={`音源 ${index + 1} 类型`}
                    style={{ width: '100%' }}
                    options={[
                      { value: 'meting', label: 'Meting' },
                      { value: 'chksz', label: 'ChKSz' },
                    ]}
                    onChange={(type) => updateMetingSource(index, {
                      type,
                      url: type === 'chksz' && !source.url ? 'https://api.chksz.com' : source.url,
                    })}
                  />
                </Col>
                <Col xs={24} sm={16}>
                  <Input
                    value={source.url}
                    onChange={(e) => updateMetingSource(index, { url: e.target.value })}
                    placeholder={source.type === 'chksz' ? 'https://api.chksz.com' : 'API 地址，如 https://music-api.example.com'}
                    aria-label={`音源 ${index + 1} 地址`}
                    spellCheck={false}
                    style={{ fontFamily: 'monospace' }}
                  />
                </Col>
                <Col xs={24} sm={2} style={{ textAlign: 'right' }}>
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label={`删除音源 ${index + 1}`}
                    onClick={() => {
                      setDraft({
                        ...draft,
                        metingSources: draft.metingSources.filter((_, sourceIndex) => sourceIndex !== index),
                      });
                      setDirtyMetingAuth((prev) => {
                        const next = new Set<number>();
                        for (const dirtyIndex of prev) {
                          if (dirtyIndex < index) next.add(dirtyIndex);
                          else if (dirtyIndex > index) next.add(dirtyIndex - 1);
                        }
                        return next;
                      });
                      setBaselineMetingAuth((prev) => prev.filter((_, sourceIndex) => sourceIndex !== index));
                    }}
                  />
                </Col>
              </Row>
              <Space wrap style={{ marginTop: 8, width: '100%' }}>
                <Input
                  value={source.auth || ''}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    updateMetingSource(index, { auth: nextValue, clearAuth: false });
                    setDirtyMetingAuth((prev) => {
                      const next = new Set(prev);
                      if (nextValue === (baselineMetingAuth[index] || '')) next.delete(index);
                      else next.add(index);
                      return next;
                    });
                  }}
                  placeholder={source.configuredAuth
                    ? '清空保存则关闭 Auth'
                    : `Auth 密钥${source.type === 'chksz' ? '（通常不需要）' : '，没有则留空'}`}
                  aria-label={`音源 ${index + 1} Auth 密钥`}
                  autoComplete="off"
                  spellCheck={false}
                  style={{ fontFamily: 'monospace', flex: 1, minWidth: 200 }}
                />
                {source.configuredAuth && !dirtyMetingAuth.has(index) && (
                  <Tag color="success">已配置</Tag>
                )}
                {dirtyMetingAuth.has(index) && !String(source.auth || '').trim() && (
                  <Tag color="warning">保存后关闭</Tag>
                )}
              </Space>
            </Card>
          ))}
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() => {
              if (draft.metingSources.length >= 20) return;
              setDraft({
                ...draft,
                metingSources: [
                  ...draft.metingSources,
                  { type: 'meting', url: '', auth: '', configuredAuth: false },
                ],
              });
            }}
            disabled={draft.metingSources.length >= 20}
          >
            添加音源
          </Button>
        </Space>
      </SettingsSection>

      {RUNTIME_FIELD_GROUPS.map((group) => (
        <SettingsSection key={group.id} title={group.title} description={group.purpose}>
          <Row gutter={[16, 16]}>
            {group.fields.map(renderField)}
            {group.includeQiniuZone && (
              <Col xs={24} sm={12}>
                <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                  存储区域
                </Typography.Text>
                <Select
                  value={draft.qiniuZone}
                  aria-label="七牛存储区域"
                  style={{ width: '100%' }}
                  options={[
                    { value: 'z0', label: '华东 z0' },
                    { value: 'z1', label: '华北 z1' },
                    { value: 'z2', label: '华南 z2' },
                    { value: 'na0', label: '北美 na0' },
                    { value: 'as0', label: '东南亚 as0' },
                  ]}
                  onChange={(zone) => setDraft({ ...draft, qiniuZone: zone })}
                />
                <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                  须与创建 Bucket 时选的区域一致
                </Typography.Text>
              </Col>
            )}
          </Row>
        </SettingsSection>
      ))}

      <div
        style={{
          position: 'sticky',
          bottom: 0,
          zIndex: 10,
          marginTop: 'auto',
          marginLeft: -20,
          marginRight: -20,
          padding: '12px 20px',
          background: 'rgba(255,255,255,0.96)',
          backdropFilter: 'blur(8px)',
          borderTop: '1px solid #f0f0f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          boxShadow: '0 -4px 16px rgba(15, 23, 42, 0.04)',
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          密钥回显为首尾片段；未改动保持原值，清空保存则关闭，填入则更新
        </Typography.Text>
        <Button type="primary" onClick={() => void save()} loading={saving}>
          保存配置
        </Button>
      </div>
    </>
  );
}
