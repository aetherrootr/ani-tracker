import { useAuth } from "./auth-context";

export { useAuth };

export function useCurrentUser() {
  const { user, isLoading, error } = useAuth();

  return { user, isLoading, error };
}

export function useLogin() {
  const { login } = useAuth();

  return login;
}

export function useRegister() {
  const { register } = useAuth();

  return register;
}

export function useLogout() {
  const { logout } = useAuth();

  return logout;
}

export function useUnlinkOidc() {
  const { unlinkOidc } = useAuth();

  return unlinkOidc;
}

export function useUpdateLanguagePreference() {
  const { updateLanguagePreference } = useAuth();

  return updateLanguagePreference;
}

export function useUpdateWeekStartDay() {
  const { updateWeekStartDay } = useAuth();

  return updateWeekStartDay;
}
