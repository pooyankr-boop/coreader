#!/usr/bin/env python3
"""Extract Alam Ara Amini.pdf with text-layer separation.
Main text (largest font) → book text.
Smaller fonts → annotations stored separately.
"""
import pymupdf
import json
import re
import os
import sys

PDF_PATH = sys.argv[1] if len(sys.argv) > 1 else "Alam Ara Amini.pdf"
BOOK_DIR = sys.argv[2] if len(sys.argv) > 2 else "site/books/alam-arA-amini"
TITLE = "علم‌العربی (Alam Ara Amini)"
AUTHOR = "حاجب العلیا"

os.makedirs(BOOK_DIR, exist_ok=True)

doc = pymupdf.open(PDF_PATH)
print(f"Pages: {doc.page_count}")

HEADING_WORDS = ['باب', 'فصل', 'مقاله', 'خطبه', 'گفتار', 'بخش', 'قسمت',
                 'دیباچه', 'مقدمه', 'خاتمه', 'ذکر', 'حکایت']
HEADING_RE = re.compile(
    r'^(' + '|'.join(HEADING_WORDS) + r')(?![\u0621-\u06FE]).{0,80}$'
)

pages_text = []
pages_annotations = {}

for pi in range(doc.page_count):
    page = doc[pi]
    d = page.get_text("dict")
    blocks = d["blocks"]
    
    all_spans = []
    for b in blocks:
        if b["type"] != 0:
            continue
        for line in b["lines"]:
            for span in line["spans"]:
                txt = (span["text"] or "").strip()
                if not txt:
                    continue
                all_spans.append({
                    "text": txt,
                    "size": round(span["size"], 1),
                    "y": (span["bbox"][1] + span["bbox"][3]) / 2,
                })
    
    if not all_spans:
        pages_text.append("")
        continue
    
    # Group by font size
    size_groups = {}
    for sp in all_spans:
        sz = sp["size"]
        if sz not in size_groups:
            size_groups[sz] = []
        size_groups[sz].append(sp)
    
    sizes_sorted = sorted(size_groups.keys(), key=lambda s: len(size_groups[s]), reverse=True)
    main_size = sizes_sorted[0]
    main_spans = size_groups[main_size]
    
    main_text = " ".join(s["text"] for s in main_spans).strip()
    if len(main_text) < 50 and len(sizes_sorted) > 1:
        main_size = sizes_sorted[1]
        main_spans = size_groups[main_size]
        main_text = " ".join(s["text"] for s in main_spans).strip()
    
    # Clean
    main_text = re.sub(r'[=\-_]{2,}\s*(?:صفحه|page)\s*\d*\s*[=\-_]{2,}', ' ', main_text)
    main_text = re.sub(r'\s{2,}', ' ', main_text).strip()
    main_text = re.sub(r'^\uFEFF?\s*\d+\s*\n+', '', main_text)
    
    pages_text.append(main_text)
    
    # Annotations (store text + word separately, no heavy regex)
    annotations = []
    for sz in sizes_sorted:
        if sz == main_size:
            continue
        for sp in size_groups[sz]:
            txt = sp["text"].strip()
            if len(txt) < 2:
                continue
            # Find nearest main-text span by y position
            sp_y = sp["y"]
            nearest = ""
            min_dist = float("inf")
            for ms in main_spans:
                dist = abs(sp_y - ms["y"])
                if dist < min_dist:
                    min_dist = dist
                    nearest = ms["text"].strip()
            if nearest:
                annotations.append({"text": txt, "word": nearest})
    
    if annotations:
        pages_annotations[pi + 1] = annotations

doc.close()

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

def escape_html(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def escape_attr(s):
    return escape_html(s).replace('"', "&quot;")

# Build HTML pages (annotations applied server-side via word matching)
html_pages = []
for i, text in enumerate(pages_text):
    pg = i + 1
    html = escape_html(text)
    pg_annos = pages_annotations.get(pg, [])
    for a in pg_annos:
        word = a.get("word", "")
        ann_text = a.get("text", "")
        if not word or not ann_text or len(word) < 2:
            continue
        # Simple string replace (not regex to avoid memory issues)
        escaped_ann = escape_attr(ann_text)
        word_esc = escape_html(word)
        replacement = f'<span class="anno anno-word" data-cat="word" data-text="{escaped_ann}">{word_esc}</span>'
        html = html.replace(word_esc, replacement, 1)  # replace first occurrence only
    html_pages.append({"page": pg, "html": html})

# Search index (lightweight)
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

print(f"Done: {len(pages_text)} pages, {len(chapters)} chapters, {len(pages_annotations)} pages with annotations")
