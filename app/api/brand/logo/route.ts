import { loadConfig, saveConfig } from '@/lib/config';
import { authed } from '@/lib/http';
import { putFile, readFile, removeFile } from '@/lib/storage';

/** The company logo: shown in the sidebar, on the sign-in page and on public pages. */
const KEY = 'brand/logo';
const TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' };

export async function GET() {
  const logo = loadConfig().company.logo;
  const data = logo ? readFile(KEY) : null;
  if (!logo || !data) return new Response('No logo', { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: {
      'content-type': logo.type,
      'cache-control': 'public, max-age=300',
      // An SVG could carry script; this keeps it a picture even when opened on its own.
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      'x-content-type-options': 'nosniff',
    },
  });
}

export const POST = authed(async ({ req, user }) => {
  if (user.role !== 'admin') return Response.json({ error: 'Only an admin can change the logo.' }, { status: 403 });
  const file = (await req.formData()).get('logo');
  if (!(file instanceof File)) throw new Error('Choose an image file.');
  if (!TYPES[file.type]) throw new Error('Use a PNG, JPG, WebP or SVG image.');
  if (file.size > 1024 * 1024) throw new Error('The logo must be smaller than 1 MB.');
  putFile(KEY, new Uint8Array(await file.arrayBuffer()));
  const config = loadConfig();
  config.company.logo = { type: file.type, v: Date.now() };
  saveConfig(config);
  return { url: `/api/brand/logo?v=${config.company.logo.v}` };
});

export const DELETE = authed(({ user }) => {
  if (user.role !== 'admin') return Response.json({ error: 'Only an admin can change the logo.' }, { status: 403 });
  removeFile(KEY);
  const config = loadConfig();
  delete config.company.logo;
  saveConfig(config);
  return { ok: true };
});
