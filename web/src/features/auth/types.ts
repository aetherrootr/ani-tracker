export type AuthUser = {
  id: number;
  username: string;
  displayName?: string | null;
  email: string;
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
