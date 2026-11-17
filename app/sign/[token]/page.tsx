import { SignPage } from '@/components/SignPage';
import { byToken } from '@/lib/apps/sign';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign a document', robots: { index: false } };

/** The page a signer opens from their private link. It needs no account. */
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = byToken(token);
  if (!found) return <main className="sign-public"><div className="card" style={{ padding: 24 }}><h1>This signing link is not valid</h1><p className="muted">Ask the sender for a new link.</p></div></main>;
  return <SignPage token={token} doc={found.doc.name} from={found.from} company={found.company} signer={found.signer.name} signedAt={found.signer.signed_at} />;
}
