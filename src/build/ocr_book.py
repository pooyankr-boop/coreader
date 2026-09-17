#!/usr/bin/env python3
"""OCR all pages of Alam Ara Amini.pdf using Tesseract (Farsi).
Combines OCR text (main) with PDF text layers (annotations).
Generates book.json with proper Persian text.
"""
import pymupdf
import subprocess
import tempfile
import json
import re
import os
import sys
import time

PDF_PATH = sys.argv[1] if len(sys.argv) > 1 else "Alam Ara Amini.pdf"
BOOK_DIR = sys.argv[2] if len(sys.argv) > 2 else "books/alam-arA-amini"
TESSDATA = os.path.join(os.environ.get('TEMP', '/tmp'), 'tessdata')
TESSERACT = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
TITLE = "علم‌العربی (Alam Ara Amini)"
AUTHOR = "حاجب العلیا"
DPI = 200
LANG = "fas+ara"

os.makedirs(BOOK_DIR, exist_ok=True)

doc = pymupdf.open(PDF_PATH)
total = doc.page_count
print(f"OCR started: {total} pages, DPI={DPI}, LANG={LANG}")

HEADING_WORDS = ['باب', 'فصل', 'مقاله', 'خطبه', 'گفتار', 'بخش', 'قسمت',
                 'دیباچه', 'مقدمه', 'خاتمه', 'ذکر', 'حکایت', 'خاتمهٔ']
HEADING_RE = re.compile(
    r'^(' + '|'.join(HEADING_WORDS) + r')(?![\u0621-\u06FE]).{0,80}$'
)

pages_text = []
pages_annotations = {}
start_time = time.time()

for pi in range(total):
    page = doc[pi]
    
    # Render page to image
    pix = page.get_pixmap(dpi=DPI)
    tmp = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
    tmp.write(pix.tobytes('png'))
    tmp.close()
    
    # OCR with Tesseract
    try:
        result = subprocess.run(
            [TESSERACT, '--tessdata-dir', TESSDATA, tmp.name, 'stdout', '-l', LANG, '--psm', '6'],
            capture_output=True, text=True, timeout=30
        )
        ocr_text = result.stdout.strip()
    except subprocess.TimeoutExpired:
        ocr_text = ""
    except Exception as e:
        ocr_text = ""
    
    os.unlink(tmp.name)
    
    # Also extract PDF text layers for annotations
    d = page.get_text("dict")
    pdf_annotations = []
    size_groups = {}
    for b in d["blocks"]:
        if b["type"] != 0:
            continue
        for line in b["lines"]:
            for span in line["spans"]:
                txt = (span["text"] or "").strip()
                if not txt or len(txt) < 2:
                    continue
                sz = round(span["size"], 1)
                if sz not in size_groups:
                    size_groups[sz] = []
                size_groups[sz].append({
                    "text": txt,
                    "size": sz,
                    "y": (span["bbox"][1] + span["bbox"][3]) / 2,
                })
    
    # Find main size (most spans) and annotation sizes
    if size_groups:
        main_size = max(size_groups.keys(), key=lambda s: len(size_groups[s]))
        main_spans = size_groups[main_size]
        for sz, spans in size_groups.items():
            if sz == main_size:
                continue
            for sp in spans:
                if len(sp["text"]) < 2:
                    continue
                # Find nearest main-text span by y
                nearest = ""
                min_dist = float("inf")
                for ms in main_spans:
                    dist = abs(sp["y"] - ms["y"])
                    if dist < min_dist:
                        min_dist = dist
                        nearest = ms["text"].strip()
                if nearest and len(nearest) >= 2:
                    pdf_annotations.append({
                        "text": sp["text"],
                        "word": nearest,
                    })
    
    if pdf_annotations:
        pages_annotations[pi + 1] = pdf_annotations
    
    pages_text.append(ocr_text)
    
    # Progress
    elapsed = time.time() - start_time
    eta = (elapsed / (pi + 1)) * (total - pi - 1) if pi > 0 else 0
    if (pi + 1) % 10 == 0 or pi == total - 1:
        print(f"  [{pi+1}/{total}] {len(ocr_text)} chars, ETA {eta/60:.1f}min")

doc.close()

total_time = time.time() - start_time
print(f"\nOCR complete: {total_time/60:.1f} minutes")

# Detect chapters
chapters = []
for i, text in enumerate(pages_text):
    for line in text.split('\n'):
        line = line.strip()
        if line and len(line) <= 90 and HEADING_RE.match(line):
            chapters.append({"title": line, "startPage": i + 1})

chapters = [c for i, c in enumerate(chapters) if i == 0 or c["title"] != chapters[i-1]["title"]]
if not chapters:
    chapters = [{"title": "(بدون فصل‌بندی تشخیص‌داده‌شده)", "startPage": 1}]

print(f"Chapters detected: {len(chapters)}")
for c in chapters[:10]:
    print(f"  p{c['startPage']}: {c['title']}")
if len(chapters) > 10:
    print(f"  ... and {len(chapters)-10} more")

def escape_html(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def escape_attr(s):
    return escape_html(s).replace('"', "&quot;")

# Build HTML pages
html_pages = []
total_annos = 0
for i, text in enumerate(pages_text):
    pg = i + 1
    html = escape_html(text)
    pg_annos = pages_annotations.get(pg, [])
    for a in pg_annos:
        word = a.get("word", "")
        ann_text = a.get("text", "")
        if not word or not ann_text or len(word) < 2:
            continue
        escaped_ann = escape_attr(ann_text)
        word_esc = escape_html(word)
        replacement = f'<span class="anno anno-word" data-cat="word" data-text="{escaped_ann}">{word_esc}</span>'
        html = html.replace(word_esc, replacement, 1)
        total_annos += 1
    html_pages.append({"page": pg, "html": html})

# Search index
search_index = {}
for i, text in enumerate(pages_text):
    seen = {}
    for w in text.split():
        wn = re.sub(r'[^\w]', '', w.lower())
        if len(wn) < 2 or seen.get(wn):
            continue
        seen[wn] = True
        if wn not in search_index:
            search_index[wn] = []
        search_index[wn].append(i + 1)

book = {
    "slug": "alam-arA-amini",
    "title": TITLE,
    "author": AUTHOR,
    "chapters": chapters,
    "pages": html_pages,
    "searchIndex": search_index,
    "pdfSources": [{"id": "pdf_1", "label": TITLE, "filename": "pdf_1.pdf"}],
    "hasPdf": True,
    "candidateCount": 0,
    "hasPdfAnnotations": len(pages_annotations) > 0,
}

with open(os.path.join(BOOK_DIR, "book.json"), "w", encoding="utf-8") as f:
    json.dump(book, f, ensure_ascii=False, indent=2)

import shutil
pdf_dest = os.path.join(BOOK_DIR, "pdf_1.pdf")
if not os.path.exists(pdf_dest):
    shutil.copy2(PDF_PATH, pdf_dest)

# Update catalog
catalog_path = "site/books-index.json"
catalog = []
if os.path.exists(catalog_path):
    with open(catalog_path, "r", encoding="utf-8") as f:
        catalog = json.load(f)
catalog = [c for c in catalog if c.get("slug") != "alam-arA-amini"]
catalog.append({
    "slug": "alam-arA-amini",
    "title": TITLE,
    "author": AUTHOR,
    "pages": len(pages_text),
    "hasPdf": True,
    "candidateCount": 0,
})
with open(catalog_path, "w", encoding="utf-8") as f:
    json.dump(catalog, f, ensure_ascii=False, indent=2)

print(f"\nDone: {len(pages_text)} pages, {len(chapters)} chapters, {total_annos} annotation spans")
print(f"Book: {BOOK_DIR}/book.json")
