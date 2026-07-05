import { GuestGuard } from "@/components/auth/GuestGuard";
import { AuthPageLayout } from "@/features/auth/components/AuthPageLayout";
import { LoginForm } from "@/features/auth/components/LoginForm";

export default function LoginPage() {
  return (
    <GuestGuard>
      <AuthPageLayout titleKey="auth.login.title" descriptionKey="auth.login.description">
        <LoginForm />
      </AuthPageLayout>
    </GuestGuard>
  );
}
