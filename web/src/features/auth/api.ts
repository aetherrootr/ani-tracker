import { apiFetch } from "@/lib/api-client";

import type {
  AuthResponse,
  CurrentUserResponse,
  LoginInput,
  LogoutResponse,
  RegisterInput,
  UpdateLanguagePreferenceInput,
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

export function updateLanguagePreference(
  input: UpdateLanguagePreferenceInput,
): Promise<AuthResponse> {
  return apiFetch<AuthResponse>("/api/auth/me/language-preference", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
