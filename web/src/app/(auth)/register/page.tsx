import { GuestGuard } from "@/components/auth/GuestGuard";
import { AuthPageLayout } from "@/features/auth/components/AuthPageLayout";
import { RegisterForm } from "@/features/auth/components/RegisterForm";

export default function RegisterPage() {
  return (
    <GuestGuard>
      <AuthPageLayout title="创建账号" description="注册后即可进入追番列表，后续功能会继续接入。">
        <RegisterForm />
      </AuthPageLayout>
    </GuestGuard>
  );
}
