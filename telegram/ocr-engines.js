// telegram/ocr-engines.js — موتورهای OCR ابری (کلیدها فقط در متغیرهای محیطی Render)
// Google Cloud Vision (DOCUMENT_TEXT_DETECTION) و Azure AI Vision Read v3.2.
const GOOGLE_KEY = process.env.GOOGLE_VISION_API_KEY || '';
const AZURE_ENDPOINT = (process.env.AZURE_VISION_ENDPOINT || '').replace(/\/$/, '');
const AZURE_KEY = process.env.AZURE_VISION_KEY || '';

function status() {
  return { tesseract: true, google: !!GOOGLE_KEY, azure: !!(AZURE_ENDPOINT && AZURE_KEY) };
}

async function google(buf, lang) {
  const r = await fetch('https://vision.googleapis.com/v1/images:annotate?key=' + encodeURIComponent(GOOGLE_KEY), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        image: { content: buf.toString('base64') },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        imageContext: { languageHints: [lang || 'fa'] }
      }]
    })
  });
  const j = await r.json();
  const first = j.responses && j.responses[0];
  if (!r.ok) throw new Error('google HTTP ' + r.status + ': ' + (j.error && j.error.message || ''));
  if (first && first.error) throw new Error('google: ' + first.error.message);
  return (first && first.fullTextAnnotation && first.fullTextAnnotation.text) || '';
}

async function azure(buf, lang) {
  const r = await fetch(AZURE_ENDPOINT + '/vision/v3.2/read/analyze?language=' + encodeURIComponent(lang || 'fa'), {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': AZURE_KEY, 'Content-Type': 'application/octet-stream' },
    body: buf
  });
  if (r.status !== 202) throw new Error('azure analyze HTTP ' + r.status);
  const loc = r.headers.get('operation-location');
  for (let i = 0; i < 40; i++) {
    await new Promise((res) => setTimeout(res, 1000));
    const p = await fetch(loc, { headers: { 'Ocp-Apim-Subscription-Key': AZURE_KEY } }).then((x) => x.json());
    if (p.status === 'succeeded') {
      return (p.analyzeResult.readResults || []).map((pg) => pg.lines.map((l) => l.text).join('\n')).join('\n');
    }
    if (p.status === 'failed') throw new Error('azure read failed');
  }
  throw new Error('azure timeout');
}

async function run(engine, buf, lang) {
  if (engine === 'google') { if (!GOOGLE_KEY) throw new Error('کلید Google Vision روی سرور تنظیم نشده'); return google(buf, lang); }
  if (engine === 'azure') { if (!AZURE_KEY) throw new Error('کلید Azure روی سرور تنظیم نشده'); return azure(buf, lang); }
  throw new Error('موتور ناشناخته: ' + engine);
}

module.exports = { status, run };