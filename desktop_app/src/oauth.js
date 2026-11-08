// Local loopback server that catches the OAuth redirect (Meta / TikTok).
const http = require('http');
const { shell } = require('electron');

const PORT = 53682;

function waitForCode(authUrl, expectedState, pathName) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      if (url.pathname.replace(/\/$/, '') !== pathName.replace(/\/$/, '')) {
        res.writeHead(404); return res.end();
      }
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error_description') || url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html dir="rtl"><body style="font-family:sans-serif;text-align:center;padding:60px">' +
        (code ? '<h2>تم الربط ✅</h2><p>ارجع لبرنامج سراج.</p>' : `<h2>فشل الربط</h2><p>${error || ''}</p>`) +
        '</body></html>');
      clearTimeout(timer);
      server.close();
      if (!code) return reject(new Error(error || 'لم يتم استلام الكود'));
      if (state !== expectedState) return reject(new Error('state غير مطابق'));
      resolve(code);
    });
    const timer = setTimeout(() => { server.close(); reject(new Error('انتهت مهلة تسجيل الدخول')); }, 5 * 60 * 1000);
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => shell.openExternal(authUrl));
  });
}

module.exports = { PORT, waitForCode };
