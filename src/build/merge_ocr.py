#!/usr/bin/env python3
"""Compare two OCR passes and merge into final corrected text.
Also matches PDF text-layer annotations to page content logically.
"""
import json
import re
import sys
import os
import pymupdf

PDF_PATH = sys.argv[1] if len(sys.argv) > 1 else "Alam Ara Amini.pdf"
PASS1 = sys.argv[2] if len(sys.argv) > 2 else "books/alam-arA-amini/book.json"
PASS2 = sys.argv[3] if len(sys.argv) > 3 else "books/alam-arA-amini/ocr_pass2.json"
OUTPUT = sys.argv[4] if len(sys.argv) > 4 else "books/alam-arA-amini/book.json"

# Load OCR pass 1 (from book.json pages)
with open(PASS1, "r", encoding="utf-8") as f:
    book = json.load(f)

pass1_texts = {}
for p in book["pages"]:
    # Strip HTML tags to get plain text
    html = p["html"]
    plain = re.sub(r'<[^>]+>', '', html).strip()
    pass1_texts[p["page"]] = plain

# Load OCR pass 2
with open(PASS2, "r", encoding="utf-8") as f:
    pass2_list = json.load(f)

pass2_texts = {}
for item in pass2_list:
    pass2_texts[item["page"]] = item["text"].strip()

print(f"Pass 1: {len(pass1_texts)} pages")
print(f"Pass 2: {len(pass2_texts)} pages")

# Compare and merge
def similarity(a, b):
    """Simple word-level Jaccard similarity."""
    if not a or not b:
        return 0.0
    wa = set(a.split())
    wb = set(b.split())
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)

def merge_texts(t1, t2):
    """Merge two OCR texts by picking the better one per paragraph.
    Strategy: split by lines, compare line-by-line, pick the one with
    more recognizable Persian/Arabic characters."""
    if not t1:
        return t2
    if not t2:
        return t1
    
    lines1 = t1.split('\n')
    lines2 = t2.split('\n')
    
    # If line counts differ significantly, pick the longer text
    if abs(len(lines1) - len(lines2)) > len(lines1) * 0.3:
        return t1 if len(t1) > len(t2) else t2
    
    merged = []
    max_lines = max(len(lines1), len(lines2))
    for i in range(max_lines):
        l1 = lines1[i] if i < len(lines1) else ""
        l2 = lines2[i] if i < len(lines2) else ""
        
        if not l1:
            merged.append(l2)
            continue
        if not l2:
            merged.append(l1)
            continue
        
        # Count Persian/Arabic characters (higher = better OCR)
        def persian_ratio(t):
            if not t:
                return 0
            persian = len(re.findall(r'[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]', t))
            return persian / max(len(t), 1)
        
        r1 = persian_ratio(l1)
        r2 = persian_ratio(l2)
        
        # Pick the one with more Persian chars, or the longer one if similar
        if abs(r1 - r2) < 0.05:
            merged.append(l1 if len(l1) >= len(l2) else l2)
        elif r1 > r2:
            merged.append(l1)
        else:
            merged.append(l2)
    
    return '\n'.join(merged)

merged_texts = {}
stats = {"pass1_better": 0, "pass2_better": 0, "similar": 0}
for pg in sorted(set(list(pass1_texts.keys()) + list(pass2_texts.keys()))):
    t1 = pass1_texts.get(pg, "")
    t2 = pass2_texts.get(pg, "")
    sim = similarity(t1, t2)
    
    if sim > 0.85:
        merged_texts[pg] = t1  # Similar enough, keep pass1
        stats["similar"] += 1
    else:
        merged = merge_texts(t1, t2)
        merged_texts[pg] = merged
        if len(t1) > len(t2):
            stats["pass1_better"] += 1
        else:
            stats["pass2_better"] += 1

print(f"\nComparison: {stats['similar']} similar, {stats['pass1_better']} pass1-better, {stats['pass2_better']} pass2-better")

# Now extract PDF text layers for annotations
print("\nExtracting PDF text layers for annotations...")
doc = pymupdf.open(PDF_PATH)
pdf_annotations = {}

for pi in range(doc.page_count):
    page = doc[pi]
    d = page.get_text("dict")
    
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
                y = (span["bbox"][1] + span["bbox"][3]) / 2
                if sz not in size_groups:
                    size_groups[sz] = []
                size_groups[sz].append({"text": txt, "size": sz, "y": y})
    
    if not size_groups:
        continue
    
    # Main size = most spans
    main_size = max(size_groups.keys(), key=lambda s: len(size_groups[s]))
    main_spans = size_groups[main_size]
    
    # Annotations = other sizes
    annos = []
    for sz, spans in size_groups.items():
        if sz == main_size:
            continue
        for sp in spans:
            txt = sp["text"].strip()
            if len(txt) < 2:
                continue
            # Find the line in merged text that best matches by content
            merged_text = merged_texts.get(pi + 1, "")
            best_match = ""
            best_score = 0
            
            # Try to find the annotation word in the merged text
            for word in txt.split():
                word_clean = re.sub(r'[^\u0600-\u06FF]', '', word)
                if len(word_clean) < 2:
                    continue
                # Search in merged text
                if word_clean in merged_text:
                    # Find the containing line
                    for line in merged_text.split('\n'):
                        if word_clean in line:
                            if len(line) > best_score:
                                best_score = len(line)
                                best_match = line.strip()
                            break
            
            # Fallback: position-based matching
            if not best_match:
                min_dist = float("inf")
                for ms in main_spans:
                    dist = abs(sp["y"] - ms["y"])
                    if dist < min_dist:
                        min_dist = dist
                        best_match = ms["text"].strip()
            
            if best_match:
                annos.append({"text": txt, "matchedTo": best_match})
    
    if annos:
        pdf_annotations[pi + 1] = annos

doc.close()
print(f"Annotations extracted: {len(pdf_annotations)} pages")

# Build final HTML pages with merged text and annotations
def escape_html(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def escape_attr(s):
    return escape_html(s).replace('"', "&quot;")

html_pages = []
total_annos = 0
for pg in sorted(merged_texts.keys()):
    text = merged_texts[pg]
    html = escape_html(text)
    
    pg_annos = pdf_annotations.get(pg, [])
    for a in pg_annos:
        matched = a.get("matchedTo", "")
        ann_text = a.get("text", "")
        if not matched or not ann_text or len(matched) < 3:
            continue
        # Find the matched text in HTML and wrap it
        matched_esc = escape_html(matched[:50])  # Use first 50 chars for matching
        if matched_esc in html:
            escaped_ann = escape_attr(ann_text)
            replacement = f'<span class="anno anno-word" data-cat="word" data-text="{escaped_ann}">{matched_esc}</span>'
            html = html.replace(matched_esc, replacement, 1)
            total_annos += 1
    
    html_pages.append({"page": pg, "html": html})

# Detect chapters from merged text
HEADING_WORDS = ['باب', 'فصل', 'مقاله', 'خطبه', 'گفتار', 'بخش', 'قسمت',
                 'دیباچه', 'مقدمه', 'خاتمه', 'ذکر', 'حکایت']
HEADING_RE = re.compile(
    r'^(' + '|'.join(HEADING_WORDS) + r')(?![\u0621-\u06FE]).{0,80}$'
)

chapters = []
for i, text in enumerate(merged_texts.get(i+1, "").split('\n') if False else []):
    pass

# Fix: iterate properly
for pg_num in sorted(merged_texts.keys()):
    text = merged_texts[pg_num]
    for line in text.split('\n'):
        line = line.strip()
        if line and len(line) <= 90 and HEADING_RE.match(line):
            chapters.append({"title": line, "startPage": pg_num})

chapters = [c for i, c in enumerate(chapters) if i == 0 or c["title"] != chapters[i-1]["title"]]
if not chapters:
    chapters = [{"title": "(بدون فصل‌بندی تشخیص‌داده‌شده)", "startPage": 1}]

# Search index
search_index = {}
for pg_num in sorted(merged_texts.keys()):
    seen = {}
    for w in merged_texts[pg_num].split():
        wn = re.sub(r'[^\w]', '', w.lower())
        if len(wn) < 2 or seen.get(wn):
            continue
        seen[wn] = True
        if wn not in search_index:
            search_index[wn] = []
        search_index[wn].append(pg_num)

# Update book
book["title"] = "تاریخ عالم‌آرای امینی"
book["author"] = "فضل‌الله بن روزبهان خنجی"
book["pages"] = html_pages
book["chapters"] = chapters
book["searchIndex"] = search_index
book["hasPdfAnnotations"] = len(pdf_annotations) > 0

with open(OUTPUT, "w", encoding="utf-8") as f:
    json.dump(book, f, ensure_ascii=False, indent=2)

print(f"\nFinal: {len(html_pages)} pages, {len(chapters)} chapters, {total_annos} annotations")
print(f"Saved to: {OUTPUT}")
