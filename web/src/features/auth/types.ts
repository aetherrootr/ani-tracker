import type { Locale } from "@/i18n";

export type AuthUser = {
  id: number;
  username: string;
  displayName?: string | null;
  email: string;
  passwordLoginEnabled: boolean;
  languagePreference: Locale;
  importProviderPreference: string;
  weekStartDay: number;
  timeZone: string;
  timeZoneMode: "auto" | "manual";
  includeUnwatchedSeasonZeroInTracking: boolean;
  includeUnwatchedSeasonZeroInStatistics: boolean;
  desktopWallpaperMode: WallpaperMode;
  mobileWallpaperMode: WallpaperMode;
  wallpaperGlassStyle: WallpaperGlassStyle;
  wallpaperGlassIntensity: number;
  shareWallpapersOnLogin: boolean;
  desktopWallpapers: UserWallpaper[];
  mobileWallpapers: UserWallpaper[];
  wallpaperUploadLimit: number;
  oidcLinked: boolean;
};

export type WallpaperVariant = "desktop" | "mobile";
export type WallpaperMode = "default" | "fixed" | "random";
export type WallpaperGlassStyle = "clear" | "regular" | "frosted";
export type UserWallpaper = {
  id: number;
  url: string;
  selected: boolean;
};

export type OidcConfigResponse = {
  enabled: boolean;
};

export type LoginInput = {
  username: string;
  password: string;
};

export type RegisterInput = {
  username: string;
  email: string;
  password: string;
  displayName?: string;
  languagePreference?: Locale;
};

export type UpdateLanguagePreferenceInput = {
  languagePreference: Locale;
};

export type UpdatePreferencesInput = {
  weekStartDay?: number;
  timeZone?: string;
  timeZoneMode?: "auto" | "manual";
  importProviderPreference?: string;
  includeUnwatchedSeasonZeroInTracking?: boolean;
  includeUnwatchedSeasonZeroInStatistics?: boolean;
  wallpaperGlassStyle?: WallpaperGlassStyle;
  wallpaperGlassIntensity?: number;
  shareWallpapersOnLogin?: boolean;
};

export type WallpaperGlassAppearanceInput = {
  wallpaperGlassStyle?: WallpaperGlassStyle;
  wallpaperGlassIntensity?: number;
};

export type UpdatePasswordInput = {
  currentPassword?: string;
  newPassword: string;
};

export type OidcPasswordSetupStatus = {
  authorized: boolean;
};

export type AuthResponse = {
  user: AuthUser;
};

export type CurrentUserResponse = {
  user: AuthUser | null;
};

export type LogoutResponse = {
  success: boolean;
};

export type UpdatePasswordResponse = {
  success: boolean;
};
