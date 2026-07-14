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
- 降低元数据供应链风险：为了保持设计简单可控，每部作品同一时间只会关联一个上游元数据供应商，避免静默混合不同来源的数据。如果需要切换供应商，ani-tracker 提供了迁移观看记录的方式。
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

默认 UI Logo 是项目自绘的 `web/public/app-logo.svg`。部署时可以通过提供自己的静态文件和运行时环境变量替换 Logo 与移动端桌面图标，不需要修改应用代码：

| 变量 | 说明 |
| --- | --- |
| `APP_LOGO_URL` | 登录/注册页和应用导航中显示的 Logo，支持 SVG、PNG 或 WebP，默认 `/app-logo.svg`。 |
| `APP_PWA_ICON_192_URL` | Web App Manifest 使用的 192x192 PNG 图标，默认 `/icon-192x192.png`。 |
| `APP_PWA_ICON_512_URL` | Web App Manifest 使用的 512x512 PNG 图标，默认 `/icon-512x512.png`。 |
| `APP_PWA_ICON_MASKABLE_URL` | Android 启动器使用的 512x512 maskable PNG 图标，默认 `/icon-maskable-512x512.png`。 |
| `APP_APPLE_TOUCH_ICON_URL` | iOS “添加到主屏幕”使用的 180x180 PNG 图标，默认 `/apple-touch-icon.png`。 |

自托管部署时，可以把自定义图片挂载到 Web 服务的 public/static 路径，或由反向代理提供静态文件，然后把变量指向这些同源路径。例如：

```env
APP_LOGO_URL=/custom/logo.svg
APP_PWA_ICON_192_URL=/custom/icon-192x192.png
APP_PWA_ICON_512_URL=/custom/icon-512x512.png
APP_PWA_ICON_MASKABLE_URL=/custom/icon-maskable-512x512.png
APP_APPLE_TOUCH_ICON_URL=/custom/apple-touch-icon.png
```

应用会暴露稳定的内部 URL（`/app-logo`、`/pwa-icon-192`、`/pwa-icon-512`、`/pwa-icon-maskable` 和 `/apple-touch-icon-custom`），并在请求时重定向到配置的文件，因此这些变量可以在部署配置中修改。PWA 图标建议使用同源 URL。修改 PWA 图标后，移动端浏览器可能仍缓存旧图标；需要删除已添加到桌面的应用后重新添加，或清理站点数据。

官方容器镜像中，Next.js public 目录是 `/opt/ani-tracker/web/public`。一个常见的 Docker Compose 用法是把宿主机目录挂载到 `/opt/ani-tracker/web/public/custom`，然后把变量指向 `/custom/...` URL：

```text
/opt/ani-tracker-branding/
  logo.svg
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
      APP_LOGO_URL: /custom/logo.svg
      APP_PWA_ICON_192_URL: /custom/icon-192x192.png
      APP_PWA_ICON_512_URL: /custom/icon-512x512.png
      APP_PWA_ICON_MASKABLE_URL: /custom/icon-maskable-512x512.png
      APP_APPLE_TOUCH_ICON_URL: /custom/apple-touch-icon.png
    volumes:
      - ani_tracker_data:/var/lib/ani-tracker
      - /opt/ani-tracker-branding:/opt/ani-tracker/web/public/custom:ro
```

在这个例子中，容器文件 `/opt/ani-tracker/web/public/custom/logo.svg` 会以浏览器 URL `/custom/logo.svg` 对外提供。

## 非目标

- ani-tracker 不管理本地媒体文件。
- ani-tracker 不是下载、流媒体或媒体服务器应用。
- ani-tracker 不以社交网络为目标。

## 已知限制

- 早期开发阶段，元数据供应商行为仍可能变化。
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
