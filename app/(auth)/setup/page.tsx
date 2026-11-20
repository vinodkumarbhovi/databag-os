import { redirect } from 'next/navigation';
import { SetupForm } from '@/components/AuthForms';
import { userCount } from '@/lib/auth';
import { CATALOG, JOBS, TOOLS } from '@/lib/catalog';
import { loadConfig, logoUrl } from '@/lib/config';
import { CLOUD } from '@/lib/runtime';

export const dynamic = 'force-dynamic';

export default function SetupPage() {
  if (userCount() > 0) redirect('/login');
  const { company, apps } = loadConfig();
  const name = (id: string) => CATALOG.find((a) => a.id === id)?.name ?? id;
  return (
    <main className="setup-page">
      <SetupForm
        defaults={{ company: company.name === 'My Company' ? '' : company.name, domain: company.domain === 'company.local' ? '' : company.domain }}
        tools={TOOLS.map((t) => ({ id: t.id, name: t.name, sub: t.apps.map(name).join(', '), price: t.price }))}
        jobs={JOBS.filter((j) => apps.includes(j.app)).map((j) => ({ id: j.id, name: j.label, sub: '' }))}
        needsCode={CLOUD}
        logo={logoUrl()}
      />
    </main>
  );
}
