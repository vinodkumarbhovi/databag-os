import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DomainSetup } from '@/components/DomainSetup';
import { loadConfig } from '@/lib/config';
import { requireUser } from '@/lib/session';

/** Right after setup: connect the company's domain (DNS check) and mail to the internet. */
export default async function WelcomePage() {
  const user = await requireUser();
  if (user.role !== 'admin') redirect('/');
  const { company } = loadConfig();
  return (
    <div className="page settings">
      <div className="mono muted">Step 4 of 4 · optional</div>
      <h1>Connect {company.domain}</h1>
      <p className="muted">Make databag reachable at your own address and let mail reach anyone on the internet. It takes about ten minutes at your domain provider.</p>
      <DomainSetup onboarding />
      <div className="row" style={{ gap: 8, marginTop: 20 }}>
        <Link className="btn primary" href="/">Done, open databag</Link>
        <Link className="btn ghost" href="/">Skip for now</Link>
      </div>
    </div>
  );
}
