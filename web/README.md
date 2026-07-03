# Ani Tracker Web

动画追番进度管理 Web App。它关注个人追番列表、动画更新集数、个人已看进度和未看更新，不包含本地媒体文件管理、评分、评论或社交功能。

## 技术栈

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- shadcn/ui 风格组件与主题变量
- lucide-react
- pnpm

## 启动方式

安装依赖：

```bash
pnpm install
```

启动开发服务器：

```bash
pnpm dev
```

然后访问 [http://localhost:3000](http://localhost:3000)。

如果当前系统没有全局 `pnpm`，可以先安装 pnpm，或临时使用 `npx pnpm install`。

## 目录结构

```txt
src/
  app/                  Next.js App Router 页面、布局与 providers
    tracking-list/      Tracking List 页面
    search/             搜索入口占位
    settings/           设置占位
  components/layout/    AppShell、桌面侧边栏、移动顶部导航
  components/ui/        shadcn/ui 风格基础组件
```

## 主要路由

- `/tracking-list`：Tracking List，个人追番列表
- `/search`：搜索入口占位
- `/settings`：设置占位

## 后端接入方式

当前不请求真实后端，也不内置 mock 追番数据。Tracking List 的具体数据结构和页面内容后续独立设计。

## 图片系统

动画海报和横幅后续可以在前端类型中分别设计为 `posterImage` 与 `bannerImage`。如果需要使用远程图片，需要在 `next.config.ts` 中配置对应图片域名。

## 桌面端 / 移动端共用 API

项目不是两套前端，也没有 `/mobile` 或 `/desktop` 路由。`md` 及以上显示桌面侧边栏，`md` 以下显示移动顶部导航，同一路由负责不同设备下的展示。
