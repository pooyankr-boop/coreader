// src/build/render.js
// Assembles the static site/ output from books/*/book.json.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BOOKS_DIR = path.join(ROOT, 'books');
const SITE_DIR = path.join(ROOT, 'site');
const READER_SRC = path.join(__dirname, '..', 'reader');
const CATALOG_SRC = path.join(__dirname, '..', 'catalog');
const DATA_SRC = path.join(__dirname, 'data');

function copyFile(src, dest){
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function renderSite(){
  fs.mkdirSync(SITE_DIR, { recursive: true });

  // Shared assets
  copyFile(path.join(READER_SRC, 'reader.css'), path.join(SITE_DIR, 'assets', 'reader.css'));
  copyFile(path.join(READER_SRC, 'reader.js'), path.join(SITE_DIR, 'assets', 'reader.js'));
  const readerHtml = fs.readFileSync(path.join(READER_SRC, 'reader.html'), 'utf8');
  // The reader shell template is also shipped as-is, so the client-side
  // "add a book" tool can fetch it and produce a real per-book index.html
  // without duplicating its markup in JS.
  copyFile(path.join(READER_SRC, 'reader.html'), path.join(SITE_DIR, 'assets', 'reader-template.html'));

  // Annotation data (glossary + rarity reference lists) so the in-browser
  // "add a book" tool can run the SAME glossing/candidate logic that the
  // Node build uses (see src/catalog/add-book.js — kept in manual sync
  // with src/build/annotate.js and structure.js).
  ['glossary.json', 'common-fa-words.json', 'common-classical-words.json'].forEach((f) => {
    copyFile(path.join(DATA_SRC, f), path.join(SITE_DIR, 'assets', f));
  });
  copyFile(path.join(CATALOG_SRC, 'add-book.js'), path.join(SITE_DIR, 'assets', 'add-book.js'));

  const slugs = fs.existsSync(BOOKS_DIR)
    ? fs.readdirSync(BOOKS_DIR).filter((s) => fs.statSync(path.join(BOOKS_DIR, s)).isDirectory())
    : [];

  const catalog = [];
  slugs.forEach((slug) => {
    const bookJsonPath = path.join(BOOKS_DIR, slug, 'book.json');
    if (!fs.existsSync(bookJsonPath)) return;
    const book = JSON.parse(fs.readFileSync(bookJsonPath, 'utf8'));

    const outDir = path.join(SITE_DIR, 'books', slug);
    fs.mkdirSync(outDir, { recursive: true });
    fs.copyFileSync(bookJsonPath, path.join(outDir, 'book.json'));

    // Multiple PDF sources (book.pdfSources), or the legacy single
    // source.pdf from before multi-PDF support existed.
    const pdfSources = book.pdfSources && book.pdfSources.length
      ? book.pdfSources
      : (fs.existsSync(path.join(BOOKS_DIR, slug, 'source.pdf'))
          ? [{ id: 'pdf_1', label: book.title, filename: 'source.pdf' }]
          : []);
    pdfSources.forEach((p) => {
      const src = path.join(BOOKS_DIR, slug, p.filename);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outDir, p.filename));
    });
    const hasPdf = pdfSources.length > 0;

    // Copy cover image if exists
    if (book.cover) {
      const coverSrc = path.join(BOOKS_DIR, slug, book.cover);
      if (fs.existsSync(coverSrc)) {
        fs.copyFileSync(coverSrc, path.join(outDir, path.basename(book.cover)));
      }
    }

    const shell = readerHtml
      .replace('<title>کتاب</title>', `<title>${book.title}</title>`)
      .replace('</head>', `<script>window.BOOK_URL='book.json';</script></head>`);
    fs.writeFileSync(path.join(outDir, 'index.html'), shell);

    catalog.push({
      slug, title: book.title, author: book.author,
      pages: book.pages.length, hasPdf,
      candidateCount: (book.candidateCount || 0),
      cover: book.cover || null,
    });
  });

  fs.writeFileSync(path.join(SITE_DIR, 'books-index.json'), JSON.stringify(catalog, null, 2));

  const catalogHtmlSrc = path.join(READER_SRC, '..', 'catalog', 'index.html');
  if (fs.existsSync(catalogHtmlSrc)) {
    copyFile(catalogHtmlSrc, path.join(SITE_DIR, 'index.html'));
  }

  console.log(`Site built: ${catalog.length} book(s) -> ${SITE_DIR}`);
  catalog.forEach((c) => console.log(`  - ${c.slug}: ${c.title} (${c.pages} pages${c.hasPdf ? ', +pdf' : ''})`));
}

module.exports = { renderSite };
