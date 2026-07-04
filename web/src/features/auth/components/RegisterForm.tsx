"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRegister } from "@/features/auth/hooks";

import { AuthErrorMessage } from "./AuthErrorMessage";

function validateEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function RegisterForm() {
  const router = useRouter();
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
      setErrorMessage("用户名至少需要 3 个字符。");
      return;
    }

    if (!validateEmail(trimmedEmail)) {
      setErrorMessage("请输入有效的邮箱地址。");
      return;
    }

    if (password.length < 8) {
      setErrorMessage("密码至少需要 8 个字符。");
      return;
    }

    if (trimmedDisplayName.length > 100) {
      setErrorMessage("展示名不能超过 100 个字符。");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await register({
        username: trimmedUsername,
        email: trimmedEmail,
        password,
        ...(trimmedDisplayName ? { displayName: trimmedDisplayName } : {}),
      });
      router.push("/tracking-list");
    } catch (caughtError) {
      setErrorMessage(caughtError instanceof Error ? caughtError.message : "注册失败，请稍后重试。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <AuthErrorMessage message={errorMessage} />
      <div className="space-y-2">
        <Label htmlFor="username">用户名</Label>
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
        <Label htmlFor="email">邮箱</Label>
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
        <Label htmlFor="password">密码</Label>
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
        <Label htmlFor="displayName">展示名（可选）</Label>
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
        {isSubmitting ? "创建中..." : "创建账号"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        已有账号？{" "}
        <Link className="font-medium text-foreground underline-offset-4 hover:underline" href="/login">
          登录
        </Link>
      </p>
    </form>
  );
}
