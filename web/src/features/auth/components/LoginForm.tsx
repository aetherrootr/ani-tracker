"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getOidcConfig } from "@/features/auth/api";
import { useLogin } from "@/features/auth/hooks";
import { getApiUrl } from "@/lib/api-client";

import { AuthErrorMessage } from "./AuthErrorMessage";

export function LoginForm() {
  const router = useRouter();
  const t = useTranslations();
  const login = useLogin();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOidcEnabled, setIsOidcEnabled] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [invalidField, setInvalidField] = useState<"username" | "password" | null>(null);

  useEffect(() => {
    let isMounted = true;

    getOidcConfig()
      .then((config) => {
        if (isMounted) {
          setIsOidcEnabled(config.enabled);
        }
      })
      .catch(() => {
        if (isMounted) {
          setIsOidcEnabled(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextInvalidField = !username.trim() ? "username" : !password ? "password" : null;
    if (nextInvalidField) {
      setInvalidField(nextInvalidField);
      setErrorMessage(t("auth.login.missingCredentials"));
      requestAnimationFrame(() => document.getElementById(nextInvalidField)?.focus());
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await login({ username: username.trim(), password });
      router.push(getSafeReturnPath(new URLSearchParams(window.location.search).get("next")));
    } catch (caughtError) {
      setErrorMessage(caughtError instanceof Error ? caughtError.message : t("auth.login.fallbackError"));
      requestAnimationFrame(() => document.getElementById("login-error")?.focus());
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} aria-busy={isSubmitting}>
      <AuthErrorMessage id="login-error" message={errorMessage} />
      <div className="space-y-2">
        <Label htmlFor="username">{t("form.username")}</Label>
        <Input
          id="username"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(event) => {
            setUsername(event.target.value);
            if (invalidField === "username") setInvalidField(null);
          }}
          disabled={isSubmitting}
          aria-invalid={invalidField === "username"}
          aria-describedby={errorMessage && invalidField === "username" ? "login-error" : undefined}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">{t("form.password")}</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              if (invalidField === "password") setInvalidField(null);
            }}
            className="pr-12"
            disabled={isSubmitting}
            aria-invalid={invalidField === "password"}
            aria-describedby={errorMessage && invalidField === "password" ? "login-error" : undefined}
            required
          />
          <button
            type="button"
            className="absolute inset-y-0 right-0 flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-input)] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-glow)]"
            aria-label={showPassword ? t("auth.login.hidePassword") : t("auth.login.showPassword")}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((current) => !current)}
          >
            {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </div>
      <Button className="h-11 w-full" type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
        {isSubmitting ? t("auth.login.submitting") : t("auth.login.submit")}
      </Button>
      {isOidcEnabled ? (
        <Button
          className="h-11 w-full"
          type="button"
          variant="outline"
          onClick={() => window.location.assign(getApiUrl("/api/oidc/login"))}
        >
          {t("auth.login.sso")}
        </Button>
      ) : null}
      <p className="text-center text-sm text-muted-foreground">
        {t("auth.login.noAccount")}{" "}
        <Link className="font-medium text-foreground underline-offset-4 hover:underline" href="/register">
          {t("auth.register.submit")}
        </Link>
      </p>
    </form>
  );
}

function getSafeReturnPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/tracking-list";
  return value;
}
