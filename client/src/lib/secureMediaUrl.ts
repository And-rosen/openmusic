/** 兼容旧路径；实现见 mediaProxyUrl */
export {
  isProxiedMediaUrl,
  unwrapProxiedMediaUrl,
  isSameOriginMediaUrl,
  shouldProxyMediaUrl,
  toProxiedMediaUrl,
  toProxiedMediaUrl as toSecureMediaUrl,
  toVisualMediaUrl,
  VISUAL_COVER_PIXEL_SIZE,
} from './mediaProxyUrl';
