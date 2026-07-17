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
  oidcLinked: boolean;
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
