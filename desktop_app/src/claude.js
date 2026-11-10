// Talks to the locally installed Claude Code CLI (`claude -p`), which uses the
// user's own Claude login (subscription) - no API key needed.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const isWin = process.platform === 'win32';

function candidatePaths() {
  const home = os.homedir();
  const list = [];
  if (isWin) {
    list.push(path.join(home, '.local', 'bin', 'claude.exe'));
    if (process.env.APPDATA) list.push(path.join(process.env.APPDATA, 'npm', 'claude.cmd'));
    if (process.env.LOCALAPPDATA) list.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'claude', 'claude.exe'));
  } else {
    list.push(path.join(home, '.local', 'bin', 'claude'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude');
  }
  return list;
}

function whereClaude() {
  return new Promise((resolve) => {
    execFile(isWin ? 'where' : 'which', ['claude'], { windowsHide: true }, (err, out) => {
      if (err) return resolve('');
      resolve(String(out).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || '');
    });
  });
}

// أعلام الأمان لكل تشغيل: لا خوادم MCP من إعدادات المستخدم، لا أوامر/مهارات، ولا حفظ للجلسات.
const SAFE_FLAGS = ['--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence'];

// مسار Claude المخصص: ملف موجود باسم claude فقط (يمنع تشغيل برنامج آخر عبر الإعدادات).
function validOverride(p) {
  return typeof p === 'string' && path.isAbsolute(p) && /^claude(\.exe|\.cmd)?$/i.test(path.basename(p)) && fs.existsSync(p);
}

async function findClaude(override) {
  if (override) { if (!validOverride(override)) throw new Error('مسار Claude غير صالح'); return override; }
  for (const p of candidatePaths()) if (fs.existsSync(p)) return p;
  return whereClaude();
}

function quote(a) {
  a = String(a);
  if (/[\r\n%!]/.test(a)) throw new Error('وسيط غير آمن');
  return a === '' || /[\s"&|<>^]/.test(a) ? '"' + a.replace(/"/g, '""') + '"' : a;
}

function run(exe, args, { input = '', cwd, timeoutMs = 5 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const needsShell = isWin && /\.(cmd|bat)$/i.test(exe);
    const child = needsShell
      ? spawn(quote(exe), args.map(quote), { cwd, shell: true, windowsHide: true })
      : spawn(exe, args, { cwd, windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('انتهت مهلة Claude')); }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        // Claude يطبع الخطأ كـ JSON على stdout: نعرض نص الخطأ فقط لا الغلاف كله
        let msg = err.trim() || out.trim() || `claude exited ${code}`;
        try { const j = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)); if (j && j.result) msg = String(j.result); } catch { /* نص عادي */ }
        return reject(new Error(msg.slice(0, 400)));
      }
      resolve(out);
    });
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

async function status(override) {
  const exe = await findClaude(override);
  if (!exe) return { ok: false, msg: 'Claude Code غير مثبت على الجهاز' };
  try {
    const v = await run(exe, ['--version'], { timeoutMs: 20000 });
    return { ok: true, exe, version: v.trim() };
  } catch (e) {
    return { ok: false, exe, msg: e.message };
  }
}

function extractJson(text) {
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s < 0 || e < s) throw new Error('رد Claude ليس JSON: ' + text.slice(0, 200));
  return JSON.parse(text.slice(s, e + 1));
}

// Writes a caption for an image (Claude reads the image itself via its Read tool).
async function captionForImage({ imagePath, settings, platforms, extraHint = '' }) {
  const exe = await findClaude(settings.claudePath);
  if (!exe) throw new Error('Claude Code غير مثبت');
  const dir = path.dirname(imagePath);
  const prompt = [
    'أنت مدير سوشال ميديا محترف.',
    `النشاط: ${settings.businessName || 'غير محدد'}`,
    `وصف النشاط: ${settings.businessDescription || 'غير محدد'}`,
    `النبرة: ${settings.tone}. اللغة: ${settings.language}.`,
    `المنصات: ${platforms.join(', ') || 'facebook, instagram'}.`,
    `اقرأ الصورة الموجودة في هذا المسار وافهم محتواها: ${imagePath}`,
    'اكتب منشوراً جذاباً مناسباً للصورة والنشاط، مع دعوة لاتخاذ إجراء و5-10 هاشتاقات مناسبة في آخره.',
    extraHint ? `ملاحظة إضافية: ${extraHint}` : '',
    'أعد فقط JSON بهذا الشكل وبدون أي نص آخر: {"caption": "..."}',
  ].filter(Boolean).join('\n');

  const raw = await run(exe, ['-p', '--output-format', 'json', '--tools', 'Read', '--allowedTools', 'Read', '--add-dir', dir, ...SAFE_FLAGS], {
    input: prompt,
    cwd: dir,
  });
  const envelope = extractJson(raw);
  if (envelope.is_error) throw new Error(envelope.result || 'خطأ من Claude');
  const inner = extractJson(String(envelope.result ?? ''));
  if (!inner.caption) throw new Error('Claude لم يرجع نص المنشور');
  return inner.caption.trim();
}

// سؤال نصي عام بدون أدوات (يُستخدم لشريط الأوامر).
async function askText(prompt, settings) {
  const exe = await findClaude(settings.claudePath);
  if (!exe) throw new Error('Claude Code غير مثبت');
  const raw = await run(exe, ['-p', '--output-format', 'json', '--tools', '', ...SAFE_FLAGS], { input: prompt, cwd: os.tmpdir(), timeoutMs: 3 * 60 * 1000 });
  const envelope = extractJson(raw);
  if (envelope.is_error) throw new Error(envelope.result || 'خطأ من Claude');
  return String(envelope.result ?? '');
}

module.exports = { findClaude, status, captionForImage, askText, extractJson };
