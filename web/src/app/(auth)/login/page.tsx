import { GuestGuard } from "@/components/auth/GuestGuard";
import { AuthPageLayout } from "@/features/auth/components/AuthPageLayout";
import { LoginForm } from "@/features/auth/components/LoginForm";

export default function LoginPage() {
  return (
    <GuestGuard>
      <AuthPageLayout title="登录" description="使用用户名和密码进入你的 Ani Tracker。">
        <LoginForm />
      </AuthPageLayout>
    </GuestGuard>
  );
}
