#!/usr/bin/env python3
"""
src/ocr/ocr_pdf.py — PDF -> page images -> initial OCR text, for classical
Persian sources that don't already have a digital text layer.

This is a FIRST PASS only. Tesseract's Persian model does reasonably on
clean modern print but struggles with classical typography, footnote
numerals, and archaic/Arabic-heavy vocabulary — expect real errors. The
output is meant to be corrected in review.html (see that file), not
trusted as-is. That correction step is the actual point of this tool, not
an afterthought.

Usage:
    python ocr_pdf.py <input.pdf> <output_dir> [--dpi 300] [--start N] [--end N] [--psm 6]

Output layout (output_dir/):
    images/page_NNN.png   — rendered page image, for the review UI
    page_NNN.txt          — initial OCR text (coreader's expected page format)
    manifest.json         — page list + status, used by review.html
"""
import argparse
import json
import os
import shutil
import subprocess
import sys

def find_poppler():
    if shutil.which('pdftoppm'):
        return None  # already on PATH
    # Common winget install location on this machine
    guess_root = os.path.expandvars(
        r'%LOCALAPPDATA%\Microsoft\WinGet\Packages'
    )
    if os.path.isdir(guess_root):
        for name in os.listdir(guess_root):
            if 'poppler' in name.lower():
                for root, _, files in os.walk(os.path.join(guess_root, name)):
                    if 'pdftoppm.exe' in files:
                        return root
    return None

def find_tesseract():
    if shutil.which('tesseract'):
        return 'tesseract'
    common = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
    if os.path.isfile(common):
        return common
    sys.exit('tesseract executable not found. Install it (winget install UB-Mannheim.TesseractOCR) '
              'or add it to PATH.')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('input_pdf')
    ap.add_argument('output_dir')
    ap.add_argument('--dpi', type=int, default=300)
    ap.add_argument('--start', type=int, default=1)
    ap.add_argument('--end', type=int, default=None)
    ap.add_argument('--psm', type=int, default=6, help='Tesseract page segmentation mode')
    args = ap.parse_args()

    from pdf2image import convert_from_path, pdfinfo_from_path

    poppler_path = find_poppler()
    tesseract_exe = find_tesseract()
    tessdata_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tessdata')

    images_dir = os.path.join(args.output_dir, 'images')
    os.makedirs(images_dir, exist_ok=True)

    info = pdfinfo_from_path(args.input_pdf, poppler_path=poppler_path)
    total_pages = info['Pages']
    end = args.end or total_pages
    print(f'PDF has {total_pages} pages; processing {args.start}..{end}')

    env = os.environ.copy()
    env['TESSDATA_PREFIX'] = tessdata_dir

    manifest = []
    for n in range(args.start, end + 1):
        imgs = convert_from_path(
            args.input_pdf, dpi=args.dpi, first_page=n, last_page=n, poppler_path=poppler_path
        )
        img = imgs[0]
        img_path = os.path.join(images_dir, f'page_{n:03d}.png')
        img.save(img_path)

        txt_path = os.path.join(args.output_dir, f'page_{n:03d}.txt')
        result = subprocess.run(
            [tesseract_exe, img_path, 'stdout', '-l', 'fas', '--psm', str(args.psm)],
            env=env, capture_output=True, text=True, encoding='utf-8'
        )
        text = result.stdout.strip()
        with open(txt_path, 'w', encoding='utf-8') as f:
            f.write(text)

        manifest.append({'page': n, 'image': f'images/page_{n:03d}.png',
                          'text': f'page_{n:03d}.txt', 'reviewed': False})
        print(f'  page {n}: {len(text)} chars OCR\'d')

    with open(os.path.join(args.output_dir, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(f'\nDone. {len(manifest)} page(s) in {args.output_dir}')
    print('Next: open review.html (in this folder) and point it at the output directory to correct the text.')

if __name__ == '__main__':
    main()
