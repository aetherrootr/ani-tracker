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