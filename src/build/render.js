// src/build/render.js
// Assembles the static site/ output from books/*/book.json.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BOOKS_DIR = path.join(ROOT, 'books');
const SITE_DIR = path.join(ROOT, 'site');
const READER_SRC = path.join(__dirname, '..', 'reader');

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

    const pdfSrc = path.join(BOOKS_DIR, slug, 'source.pdf');
    const hasPdf = fs.existsSync(pdfSrc);
    if (hasPdf) fs.copyFileSync(pdfSrc, path.join(outDir, 'source.pdf'));

    const shell = readerHtml
      .replace('<title>کتاب</title>', `<title>${book.title}</title>`)
      .replace('</head>', `<script>window.BOOK_URL='book.json';</script></head>`);
    fs.writeFileSync(path.join(outDir, 'index.html'), shell);

    catalog.push({
      slug, title: book.title, author: book.author,
      pages: book.pages.length, hasPdf,
      candidateCount: (book.candidateCount || 0),
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
