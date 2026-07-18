# ani-tracker

[![状态](https://img.shields.io/badge/status-early%20stage-orange)](#项目状态)
[![Docker Compose](https://img.shields.io/badge/docker-compose-blue)](../docker-compose.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](../LICENSE)

ani-tracker 是一个本地优先的动画剧集追踪器，也可以用来追踪影视剧和电影。

ani-tracker 的设计目标是开发一个可以本地部署的 [TV Time](https://tvtime.com/) 替代品。
项目在交互逻辑上受到 TV Time 和 Apple Music 的启发。

## 界面截图

### 桌面端

| 搜索 | 资料库 |
| --- | --- |
| ![桌面端搜索](search-desktop.png) | ![桌面端资料库](library-desktop.png) |

| 观看列表 | 统计 |
| --- | --- |
| ![桌面端观看列表](watchlist-desktop.png) | ![桌面端统计](stats-desktop.png) |

### 移动端

<p>
  <img src="images/search-mobile.png" alt="移动端搜索" width="180">
  <img src="images/library-mobile.png" alt="移动端资料库" width="180">
  <img src="images/watchlist-mobile-0.png" alt="移动端观看列表" width="180">
  <img src="images/watchlist-mobile-1.png" alt="移动端观看列表详情" width="180">
  <img src="images/stats-mobile.png" alt="移动端统计" width="180">
</p>

## 项目状态

ani-tracker 当前处于早期开发阶段，但核心追踪功能已经可用。API、数据库迁移、UI 细节和元数据供应商行为仍可能发生变化。

项目在 AI 的帮助下完成，由人类负责架构设计和代码检查。

## 特性

- 本地优先：所有用户数据均存储在本地，仅依赖网络从上游服务器获取元数据。
- 多个元数据供应来源：用户可以选择自己喜欢的元数据服务商。当前支持 [Bangumi](https://bangumi.tv/)、[TheTVDB](https://www.thetvdb.com/) 和 [TMDB](https://www.themoviedb.org/)。
- 降低元数据供应链风险：为了保持设计简单可控，每部作品同一时间只会关联一个上游元数据供应商，避免静默混合不同来源的数据。如果需要切换供应商，ani-tracker 会尽量按集数迁移可匹配的观看记录。
- 本地元数据快照：当上游元数据变化，或你希望保留当前剧集视图时，可以把条目切换到本地快照。切换供应商时，目标供应商缺失的旧剧集观看记录可能会在内部静默保留，但 ani-tracker 不保证这些未匹配记录之后仍可见、可恢复或可管理。如果需要保留当前剧集上下文，请在切换前使用本地快照。
- 多端交互体验：ani-tracker 单独为桌面端和移动设备实现了前端交互。
- 支持 OIDC / SSO。

## 快速开始

使用 Docker Compose 启动完整生产栈：

```bash
cp env.example .env
docker compose up --build
```

Compose 会启动 Web 应用、Celery worker、PostgreSQL 和 Redis。默认访问地址为 `http://localhost:8080`。如果需要使用其他端口，可以修改 `.env` 中的 `APP_PORT`。

## 元数据供应商

| 供应商 | 状态 | 说明 |
| --- | --- | --- |
| [Bangumi](https://bangumi.tv/) | 已支持 | 偏动画的元数据 |
| [TheTVDB](https://www.thetvdb.com/) | 已支持 | 电视剧元数据 |
| [TMDB](https://www.themoviedb.org/) | 已支持 | 电视剧和电影元数据 |

使用 TheTVDB 数据需要购买 TheTVDB 订阅。请前往 [TheTVDB Subscribe](https://www.thetvdb.com/subscribe) 获取用于访问 TheTVDB API 的 API PIN。依赖 TheTVDB 的功能，包括从 TV Time 导入数据，需要有效的 API PIN。ani-tracker 不提供 TheTVDB API PIN。

## 配置

使用 Docker Compose 前，请先复制 `env.example` 为 `.env`。常用配置项：

| 变量 | 说明 |
| --- | --- |
| `APP_PORT` | 对外 HTTP 端口，默认为 `8080`。 |
| `SECRET_KEY` | Flask session 密钥，部署前请修改。 |
| `POSTGRES_DB` | PostgreSQL 数据库名。 |
| `POSTGRES_USER` | PostgreSQL 用户名。 |
| `POSTGRES_PASSWORD` | PostgreSQL 密码，部署前请修改。 |
| `ANIME_TRACKER_INSTANCE_PATH` | 应用实例持久化目录，生产容器默认 `/var/lib/ani-tracker`。 |
| `TMDB_API_KEY` | 可选的 TMDB API key。 |
| `TMDB_ACCESS_TOKEN` | 可选的 TMDB access token。 |
| `TVDB_API_KEY` | 可选的 TheTVDB API key。依赖 TheTVDB 的功能还需要用户自行提供 API PIN。 |
| `TVDB_API_PIN` | 可选的 TheTVDB API PIN。需要通过 TheTVDB 订阅自行获取，ani-tracker 不提供。 |
| `AUTO_IMPORT_TVDB_SEASONS_ENABLED` | 为符合条件的用户库条目自动导入发现到的 TVDB 季。 |
| `AUTO_IMPORT_BANGUMI_RELATED_ANIME_ENABLED` | 为符合条件的用户库条目自动导入保守筛选的 Bangumi 相关动画（`续集`/`前传`）。 |
| `OIDC_ENABLED` | 启用可选的 OIDC / SSO 集成。 |

### 自定义应用 Logo 和 PWA 图标

默认 UI Logo 和网页图标使用 `web/public/liquid-glass-play-icon.svg`。部署时可以把自定义图片挂载进容器，并通过运行时环境变量指定图片在容器内的绝对路径，不需要修改或重新构建应用：

| 变量 | 说明 |
| --- | --- |
| `APP_LOGO_FILE` | 登录/注册页、应用导航和“关于”设置中显示的 Logo，支持 SVG、PNG 或 WebP。 |
| `APP_FAVICON_FILE` | 浏览器标签页图标，支持 SVG、PNG 或 ICO。 |
| `APP_PWA_ICON_192_FILE` | Web App Manifest 使用的 192x192 PNG 图标。 |
| `APP_PWA_ICON_512_FILE` | Web App Manifest 使用的 512x512 PNG 图标。 |
| `APP_PWA_ICON_MASKABLE_FILE` | Android 启动器使用的 512x512 maskable PNG 图标。 |
| `APP_APPLE_TOUCH_ICON_FILE` | iOS“添加到主屏幕”使用的 180x180 PNG 图标。 |

所有变量都是可选的；未设置时使用应用自带图片。配置值必须是应用进程可读的绝对文件路径，而不是浏览器 URL：

```env
APP_LOGO_FILE=/opt/ani-tracker/branding/logo.svg
APP_FAVICON_FILE=/opt/ani-tracker/branding/favicon.svg
APP_PWA_ICON_192_FILE=/opt/ani-tracker/branding/icon-192x192.png
APP_PWA_ICON_512_FILE=/opt/ani-tracker/branding/icon-512x512.png
APP_PWA_ICON_MASKABLE_FILE=/opt/ani-tracker/branding/icon-maskable-512x512.png
APP_APPLE_TOUCH_ICON_FILE=/opt/ani-tracker/branding/apple-touch-icon.png
```

应用在服务端读取这些文件，并通过稳定的内部 URL（`/app-logo`、`/favicon-custom`、`/pwa-icon-192`、`/pwa-icon-512`、`/pwa-icon-maskable` 和 `/apple-touch-icon-custom`）返回内容。容器文件路径不会发送给浏览器。修改网页或 PWA 图标后，应清理站点数据；对于已添加到桌面的应用，还需要删除后重新添加，因为浏览器会积极缓存这些资源。

使用官方容器镜像时，建议把宿主机目录只读挂载到 `/opt/ani-tracker/branding`：

```text
/opt/ani-tracker-branding/
  logo.svg
  favicon.svg
  icon-192x192.png
  icon-512x512.png
  icon-maskable-512x512.png
  apple-touch-icon.png
```

```yaml
services:
  app:
    image: ghcr.io/aetherrootr/ani-tracker:latest
    environment:
      APP_LOGO_FILE: /opt/ani-tracker/branding/logo.svg
      APP_FAVICON_FILE: /opt/ani-tracker/branding/favicon.svg
      APP_PWA_ICON_192_FILE: /opt/ani-tracker/branding/icon-192x192.png
      APP_PWA_ICON_512_FILE: /opt/ani-tracker/branding/icon-512x512.png
      APP_PWA_ICON_MASKABLE_FILE: /opt/ani-tracker/branding/icon-maskable-512x512.png
      APP_APPLE_TOUCH_ICON_FILE: /opt/ani-tracker/branding/apple-touch-icon.png
    volumes:
      - ani_tracker_data:/var/lib/ani-tracker
      - /opt/ani-tracker-branding:/opt/ani-tracker/branding:ro
```

在这个例子中，应用读取容器文件 `/opt/ani-tracker/branding/logo.svg`，浏览器只会请求稳定的 `/app-logo` 地址。

## 非目标

- ani-tracker 不管理本地媒体文件。
- ani-tracker 不是下载、流媒体或媒体服务器应用。
- ani-tracker 不以社交网络为目标。

## 已知限制

- 早期开发阶段，元数据供应商行为仍可能变化。
- 切换元数据供应商是尽力迁移。未匹配的旧剧集观看记录不会被主动删除，但只有本地快照被设计为长期保留旧剧集视图。
- 导入和导出工具仍在开发中。
- 部分 UI 交互可能会在后续版本中继续调整。

## 路线图

- 支持 TV Time 数据导入
- 支持数据导出
- 支持自定义背景图片，美化前端体验
- 支持 AniList 作为元数据供应商
- 支持在动画中配置观看平台，允许从 ani-tracker 跳转到观看剧集的流媒体平台

## 开发

运行后端应用：

```bash
uv run python -m app.main server
```

后端默认以 Gunicorn 生产模式运行。可以使用 `--prod` 显式选择生产模式，或使用 `--dev` 启动 Flask 开发服务器：

```bash
uv run python -m app.main server --prod
uv run python -m app.main server --dev
```

启动用于后台任务的 Celery worker：

```bash
uv run python -m app.main worker
```

额外的 Celery worker 参数会继续透传，例如 `uv run python -m app.main worker --pool=solo`。

运行本地前后端集成开发环境：

```bash
./launch_dev_service.sh
```

运行检查和测试：

```bash
uv run ruff check .
uv run mypy .
uv run pytest
```

## 重设密码

进入容器后，可以使用 CLI 按用户名重设密码：

```bash
ani-tracker reset-password <用户名>
```

默认会生成一个随机的 12 位密码并输出到标准输出。

## 贡献

欢迎提交 issue 和参与讨论。项目仍在快速演进，如果准备进行较大的改动，请先打开 issue 进行讨论。

## 许可证

ani-tracker 使用 [Apache License 2.0](../LICENSE) 许可证。

## 合规信息

ani-tracker 是一个用于记录观看进度和管理个人资料库的自托管追踪工具。项目不提供下载、流媒体播放、媒体服务器或本地媒体文件管理功能。

动画、剧集、图片和说明等元数据可能来自 Bangumi、TheTVDB、TMDB 等第三方服务。部署和使用者应自行确认并遵守所在地区适用的法律法规、第三方 API 条款、授权要求、数据处理要求和隐私合规义务。
