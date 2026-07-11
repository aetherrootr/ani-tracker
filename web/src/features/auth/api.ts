import { apiFetch } from "@/lib/api-client";

import type {
  AuthResponse,
  CurrentUserResponse,
  LoginInput,
  LogoutResponse,
  OidcConfigResponse,
  RegisterInput,
  UpdateLanguagePreferenceInput,
  UpdatePreferencesInput,
} from "./types";

export function login(input: LoginInput): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function register(input: RegisterInput): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function logout(): Promise<LogoutResponse> {
  return apiFetch<LogoutResponse>("/api/auth/logout", {
    method: "POST",
  });
}

export function getCurrentUser(): Promise<CurrentUserResponse> {
  return apiFetch<CurrentUserResponse>("/api/auth/me");
}

export function getOidcConfig(): Promise<OidcConfigResponse> {
  return apiFetch<OidcConfigResponse>("/api/auth/oidc/config");
}

export function unlinkOidc(): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/api/auth/oidc/link", {
    method: "DELETE",
  });
}

export function updateLanguagePreference(
  input: UpdateLanguagePreferenceInput,
): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/api/auth/me/language-preference", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function updatePreferences(input: UpdatePreferencesInput): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/api/auth/me/preferences", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
