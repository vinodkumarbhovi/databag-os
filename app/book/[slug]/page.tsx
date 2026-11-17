import { BookingPage } from '@/components/BookingPage';
import { publicPage } from '@/lib/apps/booking';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Book a time' };

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const found = publicPage(slug);
  if (!found) return <main className="public-page"><div className="panel pad"><h1 className="serif" style={{ fontSize: 32 }}>This booking page is not available</h1><p className="muted">Ask the person who sent it for a new link.</p></div></main>;
  const { page, owner, company } = found;
  return <BookingPage slug={page.slug} title={page.title} description={page.description} minutes={page.minutes} owner={owner} company={company} meet={!!page.add_meet} />;
}
