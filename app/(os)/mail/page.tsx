import { notFound } from 'next/navigation';
import { AppFrame } from '@/components/AppFrame';
import { MailApp } from '@/components/MailApp';
import { CATALOG } from '@/lib/catalog';
import { loadConfig } from '@/lib/config';
import { requireUser } from '@/lib/session';

export const metadata = { title: 'Mail — databag' };

export default async function MailPage() {
  if (!loadConfig().apps.includes('mail')) notFound();
  const user = await requireUser();
  const info = CATALOG.find((a) => a.id === 'mail')!;
  return (
    <AppFrame name={info.name} description={info.description} replaces={info.replaces}>
      <MailApp me={{ name: user.name, email: user.email }} />
    </AppFrame>
  );
}
