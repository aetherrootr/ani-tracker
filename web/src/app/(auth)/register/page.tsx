import { GuestGuard } from "@/components/auth/GuestGuard";
import { AuthPageLayout } from "@/features/auth/components/AuthPageLayout";
import { RegisterForm } from "@/features/auth/components/RegisterForm";

export default function RegisterPage() {
  return (
    <GuestGuard>
      <AuthPageLayout titleKey="auth.register.title" descriptionKey="auth.register.description">
        <RegisterForm />
      </AuthPageLayout>
    </GuestGuard>
  );
}
