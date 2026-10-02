const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const pageAliases = new Set(['/', '/en', '/en/', '/collab', '/collab/', '/mis-pedidos', '/pedidos']);
for (const directory of ['', 'en', 'collab', 'untitled']) {
  for (const file of fs.readdirSync(path.join(root, directory))) {
    if (file.endsWith('.html')) pageAliases.add('/' + (directory ? directory + '/' : '') + file.slice(0,-5));
  }
}
function publicAsset(requestPath) {
  let pathname;
  try { pathname = decodeURIComponent(requestPath); } catch (_) { return false; }
  if (pathname.includes('\\') || pathname.split('/').some(p => p.startsWith('.') || p === '..')) return false;
  if (!path.extname(pathname)) return pageAliases.has(pathname);
  const ext = path.extname(pathname).toLowerCase();
  if (/^\/(?:en|collab|untitled)\/.+\.html$/.test(pathname) || /^\/[^/]+\.html$/.test(pathname)) return true;
  if (/^\/(?:js|css)\//.test(pathname)) return ['.js','.css'].includes(ext);
  if (/^\/(?:images|fonts|videos)\//.test(pathname)) return ['.png','.jpg','.jpeg','.webp','.gif','.svg','.ico','.woff','.woff2','.ttf','.otf','.mp4','.webm'].includes(ext);
  return ['/robots.txt','/sitemap.xml','/favicon.ico','/site.webmanifest'].includes(pathname);
}
function operationsGuard(req,res,next) {
  const protectedPath = /^\/api\/(?:orders(?:\/|$)|poll(?:\/|$)|notifications(?:\/|$)|telegram(?:\/|$)|shipping\/create(?:\/|$))/i.test(req.path);
  if (!protectedPath || req.path.toLowerCase().replace(/\/$/, '') === '/api/orders/paypal-express') return next();
  const expected = process.env.MAHJOY_OPERATIONS_SECRET || process.env.PROAX_PAYPAL_SYNC_SECRET;
  const supplied = req.get('x-mahjoy-admin-key') || '';
  if (!expected || expected.length < 32 || !crypto.timingSafeEqual(crypto.createHash('sha256').update(expected).digest(),crypto.createHash('sha256').update(supplied).digest())) {
    return res.status(401).json({error:'Authentication required'});
  }
  res.set('Cache-Control','no-store');
  next();
}
module.exports = {publicAsset,operationsGuard};
