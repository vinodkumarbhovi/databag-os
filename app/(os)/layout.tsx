import { Shell } from '@/components/Shell';
import { CATALOG, GROUPS } from '@/lib/catalog';
import { loadConfig, logoUrl } from '@/lib/config';
import { unreadCounts } from '@/lib/mail/store';
import { requireUser } from '@/lib/session';

export default async function OsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const config = loadConfig();
  const apps = CATALOG.map((app) => ({ ...app, enabled: app.status === 'available' && config.apps.includes(app.id) }));
  const unread = config.apps.includes('mail') ? unreadCounts(user.id).inbox ?? 0 : 0;
  return (
    <Shell user={{ name: user.name, email: user.email }} company={config.company.name} logo={logoUrl(config)} groups={GROUPS} apps={apps} unread={unread}>
      {children}
    </Shell>
  );
}
