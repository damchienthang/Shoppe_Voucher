import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function resolveSafePath(urlPathname) {
  let target = urlPathname;
  if (target === '/' || target === '/dashboard' || target === '/dashboard.html') {
    target = '/dashboard/dashboard.html';
  } else if (target === '/popup' || target === '/popup.html') {
    target = '/popup/popup.html';
  }

  const normalized = path.normalize(target).replace(/^(\.\.[/\\])+/, '');
  const fullPath = path.join(ROOT_DIR, normalized);
  if (!fullPath.startsWith(ROOT_DIR)) return null;
  return fullPath;
}

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(urlObj.pathname);

  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok', serverTime: Date.now() }));
    return;
  }

  if (pathname === '/api/ping') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify({ ok: true, serverTime: Date.now() }));
    return;
  }

  if (pathname === '/favicon.ico') {
    const iconPath = path.join(ROOT_DIR, 'assets', 'icon48.png');
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
    fs.createReadStream(iconPath).pipe(res);
    return;
  }

  const filePath = resolveSafePath(pathname);
  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // When serving root aliases ('/', '/dashboard', '/popup'), inject <base> so relative paths match Chrome Extension resolution
    const isDashboardAlias = pathname === '/' || pathname === '/dashboard' || pathname === '/dashboard.html';
    const isPopupAlias = pathname === '/popup' || pathname === '/popup.html';

    if (ext === '.html' && (isDashboardAlias || isPopupAlias)) {
      fs.readFile(filePath, 'utf8', (readErr, html) => {
        if (readErr) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Internal Server Error');
          return;
        }
        const baseHref = isPopupAlias ? '/popup/' : '/dashboard/';
        const rendered = html.replace('<head>', `<head>\n  <base href="${baseHref}">`);
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache'
        });
        res.end(req.method === 'HEAD' ? undefined : rendered);
      });
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[Shopee Voucher Auto-Saver] Preview server listening at http://${HOST}:${PORT}`);
});
