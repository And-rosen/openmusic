const loaded = new Map<string, Promise<void>>();

/** 动态加载 CDN 脚本（Mineradio loadScriptOnce） */
export function loadScriptOnce(src: string): Promise<void> {
  const existing = loaded.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    const found = document.querySelector(`script[src="${src}"]`);
    if (found) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
  loaded.set(src, promise);
  return promise;
}
