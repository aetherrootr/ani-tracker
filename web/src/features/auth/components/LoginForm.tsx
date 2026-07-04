"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLogin } from "@/features/auth/hooks";

import { AuthErrorMessage } from "./AuthErrorMessage";

export function LoginForm() {
  const router = useRouter();
  const login = useLogin();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!username.trim() || !password) {
      setErrorMessage("请输入用户名和密码。");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await login({ username: username.trim(), password });
      router.push("/tracking-list");
    } catch (caughtError) {
      setErrorMessage(caughtError instanceof Error ? caughtError.message : "登录失败，请稍后重试。");
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
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">密码</Label>
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
        {isSubmitting ? "登录中..." : "登录"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        还没有账号？{" "}
        <Link className="font-medium text-foreground underline-offset-4 hover:underline" href="/register">
          创建账号
        </Link>
      </p>
    </form>
  );
}
