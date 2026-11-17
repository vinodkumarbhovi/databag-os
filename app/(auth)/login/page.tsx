import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/AuthForms';
import { userCount } from '@/lib/auth';
import { loadConfig, logoUrl } from '@/lib/config';
import { currentUser } from '@/lib/session';

export default async function LoginPage() {
  if (await currentUser()) redirect('/');
  if (userCount() === 0) redirect('/setup');
  return (
    <main className="auth">
      <LoginForm company={loadConfig().company.name} logo={logoUrl()} />
    </main>
  );
}
