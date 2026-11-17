// After `next build`: record the package links Turbopack keeps in .next/node_modules
// (e.g. "nodemailer-9c35…" -> nodemailer). npm leaves node_modules folders out of a
// published package, so `databag start` recreates the links from this list.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '..', '.next', 'node_modules');
const links = {};
if (fs.existsSync(dir)) {
  for (const name of fs.readdirSync(dir)) {
    const target = fs.readlinkSync(path.join(dir, name));
    links[name] = target.split('node_modules/').pop();
  }
}
fs.writeFileSync(path.resolve(dir, '..', 'externals.json'), JSON.stringify(links, null, 2) + '\n');
console.log(`databag: recorded ${Object.keys(links).length} package links`);
