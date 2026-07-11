"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

    if (!username.trim() || !password) {
      setErrorMessage(t("auth.login.missingCredentials"));
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await login({ username: username.trim(), password });
      router.push("/tracking-list");
    } catch (caughtError) {
      setErrorMessage(caughtError instanceof Error ? caughtError.message : t("auth.login.fallbackError"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <AuthErrorMessage message={errorMessage} />
      <div className="space-y-2">
        <Label htmlFor="username">{t("form.username")}</Label>
        <Input
          id="username"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          disabled={isSubmitting}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">{t("form.password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={isSubmitting}
          required
        />
      </div>
      <Button className="h-11 w-full" type="submit" disabled={isSubmitting}>
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
