"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRegister } from "@/features/auth/hooks";
import { useLocaleControls } from "@/i18n/provider";

import { AuthErrorMessage } from "./AuthErrorMessage";

function validateEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function RegisterForm() {
  const router = useRouter();
  const t = useTranslations();
  const { locale } = useLocaleControls();
  const register = useRegister();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedUsername = username.trim();
    const trimmedEmail = email.trim();
    const trimmedDisplayName = displayName.trim();

    if (trimmedUsername.length < 3) {
      setErrorMessage(t("auth.register.usernameTooShort"));
      return;
    }

    if (!validateEmail(trimmedEmail)) {
      setErrorMessage(t("auth.register.invalidEmail"));
      return;
    }

    if (password.length < 8) {
      setErrorMessage(t("auth.register.passwordTooShort"));
      return;
    }

    if (trimmedDisplayName.length > 100) {
      setErrorMessage(t("auth.register.displayNameTooLong"));
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await register({
        username: trimmedUsername,
        email: trimmedEmail,
        password,
        languagePreference: locale,
        ...(trimmedDisplayName ? { displayName: trimmedDisplayName } : {}),
      });
      router.push("/tracking-list");
    } catch (caughtError) {
      setErrorMessage(caughtError instanceof Error ? caughtError.message : t("auth.register.fallbackError"));
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
          minLength={3}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">{t("form.email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
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
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={isSubmitting}
          minLength={8}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="displayName">{t("form.displayNameOptional")}</Label>
        <Input
          id="displayName"
          name="displayName"
          autoComplete="name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          disabled={isSubmitting}
          maxLength={100}
        />
      </div>
      <Button className="h-11 w-full" type="submit" disabled={isSubmitting}>
        {isSubmitting ? t("auth.register.submitting") : t("auth.register.submit")}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        {t("auth.register.hasAccount")}{" "}
        <Link className="font-medium text-foreground underline-offset-4 hover:underline" href="/login">
          {t("auth.login.submit")}
        </Link>
      </p>
    </form>
  );
}
