import { HomeView } from '@/components/HomeView';
import { JOBS } from '@/lib/catalog';
import { loadConfig } from '@/lib/config';
import { requireUser } from '@/lib/session';

export default async function HomePage() {
  const user = await requireUser();
  const config = loadConfig();
  const chosen = config.shortcuts?.length ? config.shortcuts : ['invoice', 'email', 'meeting', 'doc'];
  const shortcuts = JOBS.filter((j) => chosen.includes(j.id) && config.apps.includes(j.app));
  return <HomeView name={user.name} shortcuts={shortcuts} />;
}
