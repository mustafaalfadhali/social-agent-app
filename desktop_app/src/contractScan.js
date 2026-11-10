// يقرأ عقود Word من مجلدات سطح المكتب (بدون مكتبات إضافية) ويستخرج: الجهة، العميل، الرقم، التواريخ.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------- قراءة ملف docx (zip) ----------
function readZipEntry(file, wanted) {
  const buf = fs.readFileSync(file);
  let i = buf.length - 22;
  while (i >= 0 && buf.readUInt32LE(i) !== 0x06054b50) i--;
  if (i < 0) return null;
  const count = buf.readUInt16LE(i + 10);
  let p = buf.readUInt32LE(i + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    if (name === wanted) {
      const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
      const data = buf.subarray(start, start + csize);
      return method === 0 ? data : zlib.inflateRawSync(data, { maxOutputLength: 64 * 1024 * 1024 }); // حماية من ملفات zip مضخَّمة
    }
    p += 46 + nlen + elen + clen;
  }
  return null;
}

function docxText(file) {
  const xml = readZipEntry(file, 'word/document.xml');
  if (!xml) return '';
  return xml.toString('utf8').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

// ---------- تحليل نص العقد ----------
function parseDate(s) {
  const [d, m, y] = s.split('/').map(Number);
  if (!d || !m || !y) return null;
  const last = new Date(y, m, 0).getDate();
  const bad = d > last || m > 12;
  const dd = Math.min(d, last), mm = Math.min(m, 12);
  return { iso: `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`, bad };
}

function parseContract(text) {
  const head = text.slice(0, 2500);
  if (!/عقد\s+(مكافحة|رش|سنوي|موقت|مؤقت)|CONTRACT NO/.test(head)) return null;
  const m = text.match(/تبد[اأ]\s*من\s*[(\s]*(\d{1,2}\/\d{1,2}\/\d{4})[)\s]*و?\s*تنتهي\s*في\s*[(\s]*(\d{1,2}\/\d{1,2}\/\d{4})/);
  if (!m) return null;
  const s = parseDate(m[1]), e = parseDate(m[2]);
  if (!s || !e) return null;
  const no = (text.match(/CONTRACT NO\s*:\s*([A-Z0-9-]+)/) || [])[1] || '';
  const client = ((text.match(/(?:^|\n)\s*\.?\s*2\s*[.\-]?\s*([^\n]{4,90})/) || [])[1] || '').replace(/^[\s.\-]+|[\s.\-]+$/g, '');
  const visits = ((text.match(/بمعدل\s*:?\s*([^\n]{3,80})/) || [])[1] || '').trim();
  const first = (text.match(/بين\s*كل\s*من\s*:?\s*([^\n]{0,160})/) || [])[1] || '';
  const seg = first + ' ' + head.slice(0, 1800);
  let entity = '';
  if (head.includes('1136106585') || /الخدمات/.test(seg.slice(0, 300))) entity = 'شعلة الخدمات';
  else if (/403057938|4030472594/.test(head) || /شعلة\s*الجزيرة/.test(seg.slice(0, 300))) entity = 'شعلة الجزيرة';
  return { client, no, start: s.iso, end: e.iso, visits, entity, baddate: s.bad || e.bad };
}

// ---------- مسح المجلدات (مع كاش بالتاريخ والحجم) ----------
function walk(dir, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.docx$/i.test(e.name) && !e.name.startsWith('~$')) out.push(p);
  }
}

// cache: { [file]: { sig, rec } }
function scan(roots, cache = {}) {
  const files = []; roots.forEach((r) => walk(r, files));
  const next = {}, records = [];
  let parsed = 0;
  for (const f of files) {
    let st; try { st = fs.statSync(f); } catch { continue; }
    if (st.size > 80 * 1024 * 1024) continue; // ملف ضخم غير طبيعي لعقد
    const sig = `${st.mtimeMs}:${st.size}`;
    let rec;
    if (cache[f] && cache[f].sig === sig) rec = cache[f].rec;
    else {
      parsed++;
      try { rec = parseContract(docxText(f)); } catch { rec = null; }
    }
    next[f] = { sig, rec };
    if (rec) records.push({ ...rec, file: f });
  }
  return { records, cache: next, filesSeen: files.length, parsed };
}

function watch(roots, onChange) {
  let timer = null;
  const ws = [];
  for (const r of roots) {
    try {
      ws.push(fs.watch(r, { recursive: true }, (_ev, name) => {
        if (name && /\.docx$/i.test(name) && !/(^|[\\/])~\$/.test(name)) { clearTimeout(timer); timer = setTimeout(onChange, 3000); }
      }));
    } catch { /* المجلد غير موجود */ }
  }
  return () => ws.forEach((w) => { try { w.close(); } catch {} });
}

module.exports = { scan, watch, parseContract, docxText };
