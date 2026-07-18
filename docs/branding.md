### Custom app logo and PWA icons

The default UI logo and favicon use `web/public/liquid-glass-play-icon.svg`. You can replace the branding at deployment time without rebuilding application code by mounting image files into the container and setting these runtime environment variables to their absolute container paths:

| Variable | Description |
| --- | --- |
| `APP_LOGO_FILE` | Logo shown in the login/register pages, app navigation, and About settings. SVG, PNG, or WebP are supported. |
| `APP_FAVICON_FILE` | Browser tab icon. SVG, PNG, or ICO are supported. |
| `APP_PWA_ICON_192_FILE` | 192x192 PNG icon used by the web app manifest. |
| `APP_PWA_ICON_512_FILE` | 512x512 PNG icon used by the web app manifest. |
| `APP_PWA_ICON_MASKABLE_FILE` | 512x512 maskable PNG icon for Android launchers. |
| `APP_APPLE_TOUCH_ICON_FILE` | 180x180 PNG icon used by iOS when adding the app to the home screen. |

All variables are optional and use the bundled assets when unset. Configured paths must be absolute and readable by the application process. They are container filesystem paths, not browser URLs:

```env
APP_LOGO_FILE=/opt/ani-tracker/branding/logo.svg
APP_FAVICON_FILE=/opt/ani-tracker/branding/favicon.svg
APP_PWA_ICON_192_FILE=/opt/ani-tracker/branding/icon-192x192.png
APP_PWA_ICON_512_FILE=/opt/ani-tracker/branding/icon-512x512.png
APP_PWA_ICON_MASKABLE_FILE=/opt/ani-tracker/branding/icon-maskable-512x512.png
APP_APPLE_TOUCH_ICON_FILE=/opt/ani-tracker/branding/apple-touch-icon.png
```

The app reads these files on the server and exposes them through stable internal URLs (`/app-logo`, `/favicon-custom`, `/pwa-icon-192`, `/pwa-icon-512`, `/pwa-icon-maskable`, and `/apple-touch-icon-custom`). Container paths are never sent to browsers. After changing the favicon or PWA icons, clear site data and remove and reinstall any home-screen app because browsers aggressively cache these assets.

For the official container image, a practical Docker Compose setup is to mount a host directory read-only at `/opt/ani-tracker/branding`:

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

In this example, the application reads `/opt/ani-tracker/branding/logo.svg`, while browsers only request the stable `/app-logo` URL.
