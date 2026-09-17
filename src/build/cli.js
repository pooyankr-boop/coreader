#!/usr/bin/env node
// src/build/cli.js — coreader build CLI
//
//   node src/build/cli.js book --input <path> --slug <slug> --title <t> --author <a> [--pdf <path>]...
//   node src/build/cli.js site
//
// "book" ingests one source (a .txt file, or a directory of page_NNN.txt
// files) into books/<slug>/book.json + candidates.json (rare-word review
// list). "site" assembles books/*/book.json into the deployable site/.
// --pdf may be repeated to attach multiple PDF editions/scans — all of
// them become viewable (switchable) in the reader's side panel.

const fs = require('fs');
const path = require('path');
const { loadSource } = require('./structure');
const { annotatePageHtml, buildCandidates, loadBookGlosses } = require('./annotate');
const { buildSearchIndex } = require('./search-index');
const { renderSite } = require('./render');

const ROOT = path.join(__dirname, '..', '..');
const BOOKS_DIR = path.join(ROOT, 'books');

function parseArgs(argv){
  const out = {};
  for (let i = 0; i < argv.length; i++){
    if (argv[i].startsWith('--')){
      const key = argv[i].slice(2);
      const val = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
      if (out[key] !== undefined){
        out[key] = Array.isArray(out[key]) ? out[key].concat(val) : [out[key], val];
      } else {
        out[key] = val;
      }
    }
  }
  return out;
}

function labelFromFilename(p){
  return path.basename(p, path.extname(p)).replace(/[-_]+/g, ' ').trim();
}

function buildBook(args){
  if (!args.input || !args.slug || !args.title){
    console.error('Usage: coreader book --input <path> --slug <slug> --title <title> [--author <a>] [--pdf <path>]...');
    process.exit(1);
  }
  const bookDir = path.join(BOOKS_DIR, args.slug);
  fs.mkdirSync(bookDir, { recursive: true });

  console.log('Loading source:', args.input);
  const { pages, chapters } = loadSource(args.input);
  console.log(`  -> ${pages.length} page(s), ${chapters.length} chapter(s) detected`);

  // Merge any previously-reviewed glosses (candidates.json with gloss
  // filled in) so re-running the build doesn't lose human/AI review work.
  const bookGlosses = loadBookGlosses(bookDir);

  const htmlPages = pages.map((p) => ({ page: p.page, html: annotatePageHtml(p.raw, bookGlosses) }));
  const candidates = buildCandidates(pages);
  const searchIndex = buildSearchIndex(pages);

  // Multiple PDF sources: copy each into books/<slug>/pdf_<n>.pdf and
  // record {id, label, filename} so the reader can offer a switcher.
  let pdfSources = [];
  const existingPdfsPath = path.join(bookDir, 'pdf-sources.json');
  if (args.pdf){
    const pdfList = Array.isArray(args.pdf) ? args.pdf : [args.pdf];
    pdfSources = pdfList.map((p, i) => {
      const filename = `pdf_${i + 1}.pdf`;
      fs.copyFileSync(p, path.join(bookDir, filename));
      return { id: 'pdf_' + (i + 1), label: labelFromFilename(p), filename };
    });
    fs.writeFileSync(existingPdfsPath, JSON.stringify(pdfSources, null, 2));
    console.log(`  -> copied ${pdfSources.length} PDF source(s)`);
  } else if (fs.existsSync(existingPdfsPath)){
    pdfSources = JSON.parse(fs.readFileSync(existingPdfsPath, 'utf8'));
  } else if (fs.existsSync(path.join(bookDir, 'source.pdf'))){
    pdfSources = [{ id: 'pdf_1', label: args.title, filename: 'source.pdf' }];
  }

  const book = {
    slug: args.slug,
    title: args.title,
    author: args.author || 'ناشناس',
    chapters,
    pages: htmlPages,
    searchIndex,
    pdfSources,
    hasPdf: pdfSources.length > 0,
    candidateCount: candidates.length,
  };

  fs.writeFileSync(path.join(bookDir, 'book.json'), JSON.stringify(book));

  // Don't clobber an existing candidates.json a human/AI has been editing —
  // only write it fresh if it doesn't exist yet.
  const candPath = path.join(bookDir, 'candidates.json');
  if (!fs.existsSync(candPath)){
    fs.writeFileSync(candPath, JSON.stringify(candidates, null, 2));
    console.log(`  -> ${candidates.length} candidate word(s) awaiting review: ${candPath}`);
  } else {
    console.log(`  -> candidates.json already exists, left untouched (${candidates.length} candidates would be found fresh)`);
  }

  console.log('Book written:', path.join(bookDir, 'book.json'));
}

const cmd = process.argv[2];
const args = parseArgs(process.argv.slice(3));
if (cmd === 'book') buildBook(args);
else if (cmd === 'site') renderSite();
else {
  console.log('Usage:\n  coreader book --input <path> --slug <slug> --title <t> [--author <a>] [--pdf <path>]...\n  coreader site');
  process.exit(1);
}
