// کاتالوگ — آیتم‌های جدول catalog_items را به فهرست اضافه می‌کند:
// آیتم‌های منتشرشده برای همه، و پیش‌نویس‌های خود کاربر برای خودش.
import { mountSourceSearch } from '/session/source-search.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const cfg = window.COREADER_SUPABASE;
const sb = createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
let mounted = false;

function toBook(r) {
  return {
    slug: 'db-' + r.id,
    title: (r.visible ? '' : '(پیش‌نویس) ') + (r.title || 'بی‌عنوان'),
    author: r.author || '',
    source: 'community',
    section: 'raah',
    kind: r.kind,
    language: r.language || '',
    year: r.year || '',
    pages: 0,
    manifestUrl: r.iiif_manifest || '',
    cover: null,
    provider: r.source || '',
    externalLinks: { digitalObject: r.source_url || r.pdf_url || '' }
  };
}

// آیتم‌های جدول را به فهرست اصلی کاتالوگ اضافه می‌کند (بدون تکرار)
async function loadCommunity() {
  await new Promise((resolve) => {
    const t = setInterval(() => { if (Array.isArray(window._allRawBooks)) { clearInterval(t); resolve(); } }, 300);
  });
  const { data, error } = await sb.from('catalog_items').select('*').order('created_at', { ascending: false });
  if (error) { console.warn('catalog_items:', error.message); return; }
  const base = (window._allRawBooks || []).filter((b) => b.source !== 'community');
  window._allRawBooks = base.concat((data || []).map(toBook));
  if (typeof window.filterCatalogBySection === 'function') window.filterCatalogBySection();
}

function mount() {
  if (mounted) return;
  mounted = true;
  mountSourceSearch(document.getElementById('addSearch'), {
    actions: [{ id: 'catalog', label: 'افزودن به کاتالوگ (پیش‌نویس)' }],
    onAction: async (id, x) => {
      if (id !== 'catalog') return;
      const { data } = await sb.auth.getSession();
      const user = data.session && data.session.user;
      if (!user) { alert('برای افزودن به کاتالوگ، ابتدا از صفحهٔ نشست وارد شوید: /session/'); return; }
      const { error } = await sb.from('catalog_items').insert({
        kind: x.kind || 'book', title: x.title || 'بی‌عنوان', author: x.author || null, language: x.lang || null,
        year: x.year || null, source: x.source, source_url: x.url, iiif_manifest: x.iiif || null,
        pdf_url: x.pdf || null, visible: false, submitted_by: user.id
      });
      if (error) { alert('خطا: ' + error.message); return; }
      alert('به‌عنوان پیش‌نویس ثبت شد. در بخش «افزوده‌شده‌ها» دیده می‌شود.');
      loadCommunity();
    }
  });
}

document.addEventListener('click', (e) => {
  const t = e.target && e.target.closest && e.target.closest('[data-tab="search"]');
  if (t) mount();
});

loadCommunity();