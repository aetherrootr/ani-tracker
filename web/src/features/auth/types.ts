import type { Locale } from "@/i18n";

export type AuthUser = {
  id: number;
  username: string;
  displayName?: string | null;
  email: string;
  languagePreference: Locale;
  weekStartDay: number;
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
  weekStartDay: number;
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
