# OpenMusic

多人实时在线点歌系统。

支持网易云、QQ 音乐、酷狗搜索点歌，房间成员实时同步播放、歌词同步、聊天互动；可选星河 / 声波地形等 3D 视觉背景与桌面端沉浸模式。

---

## ✨ 特性

* 🎵 多平台音乐搜索（网易云 / QQ / 酷狗）
* 👥 多人实时同步听歌
* 📜 歌词同步滚动
* 🏠 房间大厅与在线人数展示
* 🔐 房间密码保护
* 📋 歌单导入（网易云 / QQ）与推荐歌单、歌单渠道筛选
* 🔥 网易云热榜与全站点歌热榜
* ❤️ 个人收藏与点歌历史（支持 JSON 导入 / 导出）
* 📺 TV 大屏模式（`/tv/:roomId`）
* 💬 实时聊天、QQNT 表情、消息点评、回复 / @ 提及与 @全体成员
* 🔍 聊天表情包搜索（接口盒子 API，可选）
* 😊 微信表情包（扫码采集文件传输助手，本机存储，房间内发送）
* 📷 聊天发图（七牛云 OSS，可选；房间空置销毁后自动清理）
* 🧘 纯净模式（隐藏动效与热榜、标签页低调伪装；聊天图默认不加载，点击后在消息内展示）
* ⚙️ 房间设置：公告、FM 漫游、贵宾、点歌规则与禁播
* 🛡️ 点歌防刷：冷却间隔、每人待播上限、队列长度上限
* 🚫 禁播歌曲（按歌名匹配，同名跨平台均不可点入）
* 🎨 房间视觉背景（星河、唱片、封面、声波地形等预设与参数调节）
* 🌌 沉浸模式（全屏视觉、边缘滑出点歌 / 队列 / 聊天、玻璃态控制台）
* 🎚️ 自选音质
* 👑 成员等级、贵宾与管理员角色标识
* 📢 房间公告
* 📻 FM 模式与插队请求
* 🔗 房间分享（含邀请者、当前歌曲；密码房链接可带密码直达进房）
* 🕐 最近访问房间
* 🔄 Redis 持久化支持（可选）
* 📱 Android 客户端（Capacitor 远程 URL 壳，桌面端首页可下载 APK）

### 房间点歌规则（房主 / 管理员）

在 **房间设置 → 点歌** 中可配置：

| 规则 | 说明 |
|------|------|
| 允许成员点歌 | 关闭后仅房主与管理员可点歌 |
| 进房等待时间 | 新成员需停留一定时间后才能点歌 |
| 每人最多点歌 | 队列中每人最多保留几首（含正在播放），0 为不限制 |
| 点歌冷却 | 不限制 / 10秒 / 30秒 / 60秒 / 120秒，防连续刷歌 |
| 队列长度上限 | 50 / 100 / 200 首 |
| 禁播歌曲 | 按歌名禁播，队列中可一键禁播并移出；同名歌曲任意平台均无法点入 |

### 微信表情包

聊天输入框表情面板提供 **微信表情包** Tab，可将手机微信里的表情采集到本机，并在房间内像 QQ 表情一样发送。

**使用步骤**

1. 打开聊天表情面板，切换到「微信表情包」
2. 点击「开始采集」，用微信扫一扫登录「文件传输助手」
3. 在手机微信中把表情发给「文件传输助手」，网页端会自动保存
4. 采集完成后可关闭弹窗，在表情面板中点击即可发送

**说明**

| 项目 | 说明 |
|------|------|
| 存储位置 | 本机浏览器 IndexedDB，按客户端 ID 隔离；换浏览器或清缓存后需重新采集 |
| 大小限制 | 单张表情发送上限 **5MB**，超出会显示当前文件大小 |
| 不支持类型 | 部分商店表情、特殊动图在网页版返回「该类型暂不支持，请在手机上查看」，无法自动下载；可改发普通 GIF / 图片表情 |
| 服务端 | 内置 `/wx-proxy`（登录域名）与 `/cgi-bin`（文件传输助手 API）代理，**无需额外环境变量** |
| CDN / Nginx | `/wx-proxy/*` 登录轮询勿缓存；`/cgi-bin/*` 需反代到 Node（与 `/api` 相同） |

---

## 📷 项目截图

### 房间大厅

![大厅](docs/screenshots/home.png)

### 房间点歌

![房间](docs/screenshots/room.png)

### 歌词播放

![歌词](docs/screenshots/lyrics.png)

---

## 🚀 快速部署

**要求**：Node.js >= 18

### Docker（Meting-API）

```bash
docker pull ghcr.io/mikus-loli/meting-api:latest
docker run -d --name meting -p 3000:3000 ghcr.io/mikus-loli/meting-api:latest
```

### 启动 OpenMusic

```bash
git clone https://github.com/qq01-hub/openmusic.git
cd openmusic

npm run install:all
cp server/.env.example server/.env
npm run build
npm start
```

生产环境由同一 Node 进程托管 API、WebSocket 与前端静态资源，默认监听 `http://0.0.0.0:4000`。

开发模式：

```bash
npm run dev
```

| 服务 | 地址 |
|------|------|
| 前端（Vite） | http://localhost:5173 |
| 后端 | http://localhost:4000 |

### 环境变量

```env
PORT=4000
CLIENT_URL=https://your-domain.com
CLIENT_ID_SECRET=your-secret
METING_API_URL=http://127.0.0.1:3000
METING_API_AUTH=your-meting-token
CYAPI_KEY=your-cyapi-key          # 可选，酷狗 + 随机推荐
REDIS_URL=redis://127.0.0.1:6379/0 # 可选，房间持久化

# 聊天发图（可选）
# QINIU_ACCESS_KEY=
# QINIU_SECRET_KEY=
# QINIU_BUCKET=
# QINIU_DOMAIN=https://cdn.example.com

# 聊天表情包搜索（可选，接口盒子）
# APIHZ_IMG_ID=
# APIHZ_IMG_KEY=
```

完整配置见：[docs/DEPLOY.md](docs/DEPLOY.md)

### SEO 与 sitemap

前端已内置 `meta` / Open Graph / Twitter Card / JSON-LD，页面标签按**当前访问域名**自动写入；房间与 TV 页为 `noindex`。

`/sitemap.xml` 与 `/robots.txt` 由服务端动态生成，优先使用 `CLIENT_URL`，否则按请求域名推断，**无需额外配置**。

---

## 📱 Android 客户端

采用 **Capacitor 远程 URL 模式**：App 内 WebView 直接打开线上站点（与 `server/.env` 中的 `CLIENT_URL` 一致）。前端更新只需部署服务器，**不必每次改代码都重打 APK**。

### 1. 配置远程地址

```bash
cd client
cp .env.capacitor.example .env.capacitor
```

编辑 `client/.env.capacitor`：

```env
CAPACITOR_SERVER_URL=https://your-domain.com
```

须为 **HTTPS**（局域网调试可用 `http://`，会自动开启 cleartext）。

### 2. GitHub Actions 云端打包（推荐，无需 Android Studio）

工作流文件：`.github/workflows/android-apk.yml`

1. 将代码 push 到 GitHub
2. 打开仓库 **Actions** → **Android APK** → **Run workflow**
3. 填写参数：
   - `server_url`：与 `CLIENT_URL` 一致，例如 `https://your-domain.com`
   - `build_type`：选 **`debug`**（可直接安装；`release` 未签名，部分手机装不了）
4. 等待构建完成，在运行结果底部 **Artifacts** 下载 `openmusic-*.zip`
5. **解压 zip**，得到 `openmusic.apk`（不要直接把 zip 当 APK 安装）

> Artifacts 默认保留约 90 天，不会自动上传到你的服务器。

### 3. 部署 APK 供用户下载

将解压后的 APK 上传到服务器：

```text
server/downloads/openmusic.apk
```

重启 Node 服务后，下载地址为：

`https://your-domain.com/downloads/openmusic.apk`

首页右上角 **Android** 按钮指向此地址，且仅在**桌面端**显示，手机浏览器访问时不显示。


## 🛠 技术栈

### Frontend

* React
* Vite
* TailwindCSS
* Socket.IO Client
* Three.js / React Three Fiber（房间视觉背景、沉浸模式 3D 场景）
* Capacitor（Android 远程 URL 壳）

### Backend

* Node.js
* Express
* Socket.IO
* Redis（可选）

---

## 🙏 致谢

本项目的房间视觉与沉浸体验，参考并融合了以下开源作品的设计与实现思路，在此向作者表示感谢：

| 项目 | 作者 | 说明 |
|------|------|------|
| [Mineradio](https://github.com/XxHuberrr/Mineradio) | [@XxHuberrr](https://github.com/XxHuberrr) | 星河粒子、3D 歌单架、沉浸玻璃质感、舞台歌词等视觉方案的重要参考 |
| [sonic-topography](https://github.com/yin-yizhen/sonic-topography) | [@yin-yizhen](https://github.com/yin-yizhen) | 「声波地形」预设的着色器与音频地形逻辑参考（请遵循其原项目许可，仅限个人 / 非商业使用） |

感谢以上作者的开源分享。若使用相关视觉能力，请同时阅读并遵守对应仓库的许可证与使用说明。

---

## 📄 免责声明

本项目仅供学习与技术交流使用。

本项目不存储任何音频文件，音乐版权归相关权利人所有。

请遵守相关法律法规及平台服务协议，不得用于商业用途。

---

## License

MIT
