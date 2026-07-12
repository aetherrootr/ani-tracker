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
  <img src="search-mobile.png" alt="移动端搜索" width="180">
  <img src="library-mobile.png" alt="移动端资料库" width="180">
  <img src="watchlist-mobile-0.png" alt="移动端观看列表" width="180">
  <img src="watchlist-mobile-1.png" alt="移动端观看列表详情" width="180">
  <img src="stats-mobile.png" alt="移动端统计" width="180">
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

Compose 会启动应用容器、PostgreSQL 和 Redis。默认访问地址为 `http://localhost:8080`。如果需要使用其他端口，可以修改 `.env` 中的 `APP_PORT`。

## 元数据供应商

| 供应商 | 状态 | 说明 |
| --- | --- | --- |
| [Bangumi](https://bangumi.tv/) | 已支持 | 偏动画的元数据 |
| [TheTVDB](https://www.thetvdb.com/) | 已支持 | 电视剧元数据 |
| [TMDB](https://www.themoviedb.org/) | 已支持 | 电视剧和电影元数据 |

## 配置

使用 Docker Compose 前，请先复制 `env.example` 为 `.env`。常用配置项：

| 变量 | 说明 |
| --- | --- |
| `APP_PORT` | 对外 HTTP 端口，默认为 `8080`。 |
| `SECRET_KEY` | Flask session 密钥，部署前请修改。 |
| `POSTGRES_DB` | PostgreSQL 数据库名。 |
| `POSTGRES_USER` | PostgreSQL 用户名。 |
| `POSTGRES_PASSWORD` | PostgreSQL 密码，部署前请修改。 |
| `TMDB_API_KEY` | 可选的 TMDB API key。 |
| `TMDB_ACCESS_TOKEN` | 可选的 TMDB access token。 |
| `TVDB_API_KEY` | 可选的 TheTVDB API key。 |
| `OIDC_ENABLED` | 启用可选的 OIDC / SSO 集成。 |

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
uv run python -m app.main
```

后端默认以 Gunicorn 生产模式运行。可以使用 `--prod` 显式选择生产模式，或使用 `--dev` 启动 Flask 开发服务器：

```bash
uv run python -m app.main --prod
uv run python -m app.main --dev
```

运行本地前后端集成开发环境：

```bash
./launch_dev_service.sh
```

运行检查和测试：

```bash
uv run ruff check app tests migrations
uv run mypy app
uv run pytest
```

## 贡献

欢迎提交 issue 和参与讨论。项目仍在快速演进，如果准备进行较大的改动，请先打开 issue 进行讨论。

## 许可证

ani-tracker 使用 [Apache License 2.0](../LICENSE) 许可证。
