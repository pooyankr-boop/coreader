# QDL and BL IIIF Manifest URLs

Validated working IIIF manifest URLs for Qatar Digital Library and British Library manuscripts.

## QDL (Qatar Digital Library)

QDL uses a specific URL pattern. All manifests are under the `81055` collection (Oriental Manuscripts).

| Slug | Title | Manifest URL | Pages |
|------|-------|--------------|-------|
| `qdl-add-ms-7492` | Add MS 7492 — Four treatises on astronomy and calendrics | `https://www.qdl.qa/en/iiif/81055/vdc_100106885028.0x000001/manifest` | 164 |
| `qdl-add-ms-23569` | Add MS 23569 — Five treatises on astronomy and mathematics | `https://www.qdl.qa/en/iiif/81055/vdc_100024386010.0x000001/manifest` | 296 |
| `qdl-add-ms-16659` | Add MS 16659 — Compendium of philosophical and scientific texts | `https://www.qdl.qa/en/iiif/81055/vdc_100000001517.0x000093/manifest` | 789 |
| `qdl-vdc-100088054536` | VDC 100088054536 — Manuscript collection | `https://www.qdl.qa/en/iiif/81055/vdc_100088054536.0x000001/manifest` | ~200 |

### QDL URL Pattern

```
https://www.qdl.qa/en/iiif/81055/vdc_<collection-id>/<vdc-hash>/manifest
```

**Thumbnail URL pattern:**
```
https://iiif.qdl.qa/iiif/images/81055/<vdc-hash>/<filename>_0001.jp2/full/!200,200/0/default.jpg
```

**Image service:**
```
https://iiif.qdl.qa/iiif/images/81055/<vdc-hash>/<filename>_0001.jp2
```

### Important Notes

- QDL manifests load reliably (no timeout issues like BSB)
- Some manifests return Arabic/Persian content descriptions
- Pages may include facing pages (recto/verso) as separate canvases
- Use `full/max/0/default.jpg` for thumbnails (not fixed dimensions)

## BL (British Library via Digirati)

| Slug | Title | Manifest URL |
|------|-------|--------------|
| `bl-vdc-100145840943` | VDC 100145840943 — Manuscript | `https://bl.digirati.io/iiif/ark:/81055/vdc_100145840943.0x000001?manifest=https://bl.digirati.io/iiif/ark:/81055/vdc_100145840943.0x000001` |

### BL/Digirati URL Pattern

Digirati manifests use a query parameter pattern:
```
https://bl.digirati.io/iiif/ark:/81055/<vdc-id>?manifest=<same-url>
```

**Pitfall:** The `?manifest=` parameter is part of the URL, NOT a hash fragment. When stripping hashes, do NOT strip query params.

## Adding New Manuscripts

1. Fetch manifest JSON to get canvas count:
   ```bash
   curl -s "https://www.qdl.qa/en/iiif/81055/vdc_XXX/manifest" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('Canvases:', d.sequences[0].canvases.length);"
   ```

2. Get first thumbnail:
   ```bash
   curl -s "https://www.qdl.qa/en/iiif/81055/vdc_XXX/manifest" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.sequences[0].canvases[0].images[0].resource.service[0]['@id']);"
   ```

3. Add to `books-index.json` with:
   - `slug`: `qdl-<unique-id>`
   - `manifestUrl`: full manifest URL
   - `pages`: canvas count
   - `thumbnail`: first canvas thumbnail URL
   - `provider`: "Qatar Digital Library"

## Provider Patterns Reference

| Provider | URL Pattern | Timeout Risk |
|----------|-------------|--------------|
| Bodleian | `iiif.bodleian.ox.ac.uk/iiif/manifest/{uuid}.json` | Low (~2s) |
| BSB Munich | `api.digitale-sammlungen.de/iiif/presentation/v2/{id}/manifest` | HIGH (8s+) |
| QDL | `www.qdl.qa/en/iiif/81055/vdc_XXX/manifest` | Low (~2s) |
| BL/Digirati | `bl.digirati.io/iiif/ark:/...` | Low (~2s) |
| Gallica | `gallica.bnf.fr/iiif/ark:/.../manifest` | Medium (~5s) |

**Always use Promise.race with 8s timeout for BSB and other slow providers.**
