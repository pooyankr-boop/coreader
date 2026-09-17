#!/usr/bin/env python3
"""Second OCR pass with different settings for cross-validation.
Uses Tesseract with --psm 4 (single column) + image preprocessing.
Saves per-page results for comparison with first OCR.
"""
import pymupdf
import subprocess
import tempfile
import json
import os
import re
import time
import sys

PDF_PATH = sys.argv[1] if len(sys.argv) > 1 else "Alam Ara Amini.pdf"
TESSDATA = os.path.join(os.environ.get('TEMP', '/tmp'), 'tessdata')
TESSERACT = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
DPI = 250  # Higher DPI for better accuracy
LANG = "fas+ara"
OUTPUT = "books/alam-arA-amini/ocr_pass2.json"

os.makedirs("books/alam-arA-amini", exist_ok=True)

doc = pymupdf.open(PDF_PATH)
total = doc.page_count
print(f"OCR Pass 2: {total} pages, DPI={DPI}")

start_time = time.time()
results = []

for pi in range(total):
    page = doc[pi]
    pix = page.get_pixmap(dpi=DPI)
    
    # Save as PNG
    tmp = tempfile.NamedTemporaryFile(suffix='.png', delete=False)
    tmp.write(pix.tobytes('png'))
    tmp.close()
    
    # OCR with --psm 4 (single column) + higher DPI
    try:
        result = subprocess.run(
            [TESSERACT, '--tessdata-dir', TESSDATA, tmp.name, 'stdout', 
             '-l', LANG, '--psm', '4', '--oem', '1'],
            capture_output=True, text=True, timeout=30
        )
        text = result.stdout.strip()
    except:
        text = ""
    
    os.unlink(tmp.name)
    
    results.append({"page": pi + 1, "text": text})
    
    elapsed = time.time() - start_time
    eta = (elapsed / (pi + 1)) * (total - pi - 1) if pi > 0 else 0
    if (pi + 1) % 50 == 0 or pi == total - 1:
        print(f"  [{pi+1}/{total}] ETA {eta/60:.1f}min")

doc.close()

with open(OUTPUT, "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

print(f"\nDone: {len(results)} pages saved to {OUTPUT}")
print(f"Time: {(time.time()-start_time)/60:.1f} minutes")
