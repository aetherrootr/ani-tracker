import { apiFetch } from "@/lib/api-client";

import type {
  AuthResponse,
  CurrentUserResponse,
  LoginInput,
  LogoutResponse,
  OidcConfigResponse,
  OidcPasswordSetupStatus,
  UpdatePasswordInput,
  UpdatePasswordResponse,
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
  return apiFetch<CurrentUserResponse>("/api/user/me");
}

export function getOidcConfig(): Promise<OidcConfigResponse> {
  return apiFetch<OidcConfigResponse>("/api/oidc/config");
}

export function getOidcPasswordSetupStatus(): Promise<OidcPasswordSetupStatus> {
  return apiFetch<OidcPasswordSetupStatus>("/api/oidc/password-setup/status");
}

export function unlinkOidc(currentPassword: string): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/api/oidc/link", {
    method: "DELETE",
    body: JSON.stringify({ currentPassword }),
  });
}

export function updateLanguagePreference(
  input: UpdateLanguagePreferenceInput,
): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/api/user/me/preferences", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function updatePreferences(input: UpdatePreferencesInput): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/api/user/me/preferences", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function updatePassword(input: UpdatePasswordInput): Promise<UpdatePasswordResponse> {
  return apiFetch<UpdatePasswordResponse>("/api/user/me/password", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
