import { notFound } from 'next/navigation';
import { AppFrame } from '@/components/AppFrame';
import { AppHost } from '@/components/AppHost';
import { CATALOG } from '@/lib/catalog';
import { loadConfig } from '@/lib/config';
import { requireUser } from '@/lib/session';

export default async function AppPage({ params }: { params: Promise<{ app: string }> }) {
  const { app } = await params;
  const user = await requireUser();
  const info = CATALOG.find((a) => a.id === app);
  if (!info || !loadConfig().apps.includes(app)) notFound();
  return (
    <AppFrame name={info.name} description={info.description} replaces={info.replaces}>
      <AppHost id={app} me={{ name: user.name, email: user.email }} />
    </AppFrame>
  );
}
