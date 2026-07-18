# ani-tracker

[![状态](https://img.shields.io/badge/status-early%20stage-orange)](#项目状态)
[![Docker Compose](https://img.shields.io/badge/docker-compose-blue)](../docker-compose.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](../LICENSE)

ani-tracker 是一个本地优先的动画剧集追踪器，也可以用来追踪影视剧和电影。

ani-tracker 的设计目标是开发一个可以本地部署的 [TV Time](https://tvtime.com/) 替代品。
项目在交互逻辑上受到 TV Time 和 Apple Music 的启发。

ani-tracker的用户界面使用统一的设计语言*Twilight Iris*, 呈现平静、精确、尊重媒体内容且具有个性化的感受。
ani-tracker从TV Time和电影票中获得灵感，设计了电影票式整票滑动剧集观看交互方式。
所有的用户交互方式都充分参考了 [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/), 确保用户获得极致的体验和视觉感受。
有关设计的更多内容请参考[Design Style](design_style.zh-CN.md)。

## 界面截图

### 桌面端

| 登陆 | 搜索 | 资料库 |
| --- | --- | --- |
| ![登陆](images/login-desktop.png) | ![桌面端搜索](images/search-desktop.png) | ![桌面端资料库](images/library-desktop.png) |

| 观看列表 | 统计 | 选择TVDB季度 |
| --- | --- |  --- |
| ![桌面端观看列表](images/watchlist-desktop.png) | ![桌面端统计](images/stats-desktop.png) | ![选择TVDB季度](images/select-tvdb-season.png) |

<details>
<summary>查看深色模式截图</summary>

| 登录 | 搜索 | 资料库 |
| --- | --- | --- |
| ![登陆(dark mode)](images/login-desktop-dark.png) | ![桌面端搜索(dark mode)](images/search-desktop-dark.png) | ![桌面端资料库(dark mode)](images/library-desktop-dark.png) |

| 观看列表 | 统计 |
| --- | --- |
| ![桌面端观看列表(dark mode)](images/watchlist-desktop-dark.png)| ![桌面端统计(dark mode)](images/stats-dark.png) |

</details>


### 移动端

<details>
<summary>查看移动端截图</summary>
<p>
  <img src="images/search-mobile.png" alt="移动端搜索" width="180">
  <img src="images/library-mobile.png" alt="移动端资料库" width="180">
  <img src="images/watchlist-mobile-0.png" alt="移动端观看列表" width="180">
  <img src="images/watchlist-mobile-1.png" alt="移动端观看列表详情" width="180">
  <img src="images/stats-mobile.png" alt="移动端统计" width="180">
</p>
</details>

## 项目状态

ani-tracker 当前处于早期开发阶段，但核心追踪功能已经可用。API、数据库迁移、UI 细节和元数据供应商行为仍可能发生变化。

项目开发过程中使用了 AI 辅助工具。架构设计、功能决策、代码审查和最终合并均由维护者负责。
项目使用了 Ruff、mypy 和 pytest 进行静态检查与自动化测试。

## 特性

- **自托管优先：** 账户、观看记录和个人资料库存储在部署者控制的数据库中。
- **多元数据供应商：** 支持 [Bangumi](https://bangumi.tv/)、[TheTVDB](https://www.thetvdb.com/) 和 [TMDB](https://www.themoviedb.org/)。
- **明确的数据来源：** 每部作品同时只关联一个元数据供应商，避免静默混合不同来源的数据。
- **本地元数据快照：** 可以冻结当前作品和剧集结构，减少上游数据变化的影响。
- **响应式交互：** 针对桌面端和移动端分别优化操作方式。
- **统一身份认证：** 支持可选的 OIDC / SSO 集成。
- **自动更新：** 支持从上游发现和导入新剧集、新季度及相关动画。
- **自定义品牌：** 支持替换 Logo、favicon、PWA 图标和应用背景。
- **多用户支持：** 每个用户都有自己的数据空间，互不干扰。

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

## 非目标

- ani-tracker 不管理本地媒体文件。
- ani-tracker 不是下载、流媒体或媒体服务器应用。
- ani-tracker 不以社交网络为目标。

## 已知限制

- 早期开发阶段，元数据供应商行为仍可能变化。
- 切换元数据供应商是尽力迁移。未匹配的旧剧集观看记录不会被主动删除，但只有本地快照被设计为长期保留旧剧集视图。
- 部分 UI 交互可能会在后续版本中继续调整。

## 路线图

- [x] TV Time 数据导入
- [ ] 数据导出
- [x] 支持用户自定义背景图片，改进前端交互体验
- [ ] AniList 元数据供应商
- [ ] 为作品配置观看平台和外部播放链接

## 自定义品牌

参考 [自定义品牌](branding.zh-CN.md)

## 开发

参考 [Development](development.md)

## 重设用户密码

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
