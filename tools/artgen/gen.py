#!/usr/bin/env python3
"""Game Night art generation: logo concepts, icon set, identity background.

Usage (never echo the key):
    set -a && . ./.env && set +a && tools/artgen/.venv/bin/python tools/artgen/gen.py all
Subcommands: logo | icons | bg | all      Flags: --force (ignore the raw cache)
Raw API output is cached in tools/artgen/out/raw/<name>.png; cached names cost no API call.
"""
import base64, io, json, os, sys, time, urllib.error, urllib.request
from PIL import Image
import numpy as np

MODEL = os.environ.get("ARTGEN_MODEL", "gemini-3.1-flash-image")
ENDPOINT = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(ROOT, "..", ".."))
OUT, RAW = os.path.join(ROOT, "out"), os.path.join(ROOT, "out", "raw")
FORCE = "--force" in sys.argv
CALLS = [0]
CACHED = [False]   # True when the last generate() came from the raw cache (no API call)

STYLE = ("flat vector emblem, a single solid pure white shape on a solid pure green background #00FF00 "
         "edge to edge, geometric, bold, no text, no letters, no gradients, no shading, no outline, "
         "no drop shadow, must stay legible at 16 pixels")
ICON_STYLE = STYLE + ", icon glyph, thick uniform strokes, centered, fills about 70% of the frame"
REASK = (" BACKGROUND MUST BE SOLID GREEN EDGE TO EDGE, do not paint the subject on a plate or tile.")


# ---------------------------------------------------------------- API
def generate(name, prompt, aspect="1:1", ref=None):
    """Return the raw PIL image for `name`, calling the API only if not cached."""
    os.makedirs(RAW, exist_ok=True)
    path = os.path.join(RAW, f"{name}.png")
    CACHED[0] = os.path.exists(path) and not FORCE
    if CACHED[0]:
        print(f"[cache] {name}")
        return Image.open(path).convert("RGB")
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit("GEMINI_API_KEY is not set (run with: set -a && . ./.env && set +a)")
    parts = []
    if ref is not None:
        buf = io.BytesIO(); ref.convert("RGB").save(buf, "PNG")
        parts.append({"inlineData": {"mimeType": "image/png",
                                     "data": base64.b64encode(buf.getvalue()).decode()}})
    parts.append({"text": prompt})
    cfg = {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": aspect, "imageSize": "1K"}}
    for attempt in range(1, 5):
        body = {"contents": [{"parts": parts}], "generationConfig": cfg}
        req = urllib.request.Request(ENDPOINT, data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json", "x-goog-api-key": key})
        t0 = time.time()
        CALLS[0] += 1
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                data, status = json.loads(r.read().decode()), r.status
        except urllib.error.HTTPError as e:
            detail = e.read().decode()[:400]
            print(f"[api] {name} attempt={attempt} status={e.code} {time.time()-t0:.1f}s {detail}")
            if e.code == 400 and "imageSize" in detail and "imageSize" in cfg["imageConfig"]:
                cfg["imageConfig"].pop("imageSize"); continue
            if e.code == 429 and attempt < 4:
                time.sleep(45); continue
            return None
        except Exception as e:  # network/timeout
            print(f"[api] {name} attempt={attempt} status=ERR {time.time()-t0:.1f}s {e}")
            if attempt < 4: time.sleep(10); continue
            return None
        print(f"[api] {name} attempt={attempt} status={status} {time.time()-t0:.1f}s")
        for p in (data.get("candidates") or [{}])[0].get("content", {}).get("parts", []):
            blob = p.get("inlineData") or p.get("inline_data")
            if blob and blob.get("data"):
                img = Image.open(io.BytesIO(base64.b64decode(blob["data"]))).convert("RGB")
                img.save(path)
                return img
        cand = (data.get("candidates") or [{}])[0]
        print(f"[api] {name}: no image part. finishReason={cand.get('finishReason')} "
              f"promptFeedback={json.dumps(data.get('promptFeedback'))}")
        return None
    return None


# ---------------------------------------------------------------- image ops
def chroma_key(img, hue_lo=50.0, hue_hi=120.0, sat_min=0.25, val_min=0.15):
    """HSV green key + despill; RGB zeroed where fully transparent."""
    img = img.convert("RGB")
    rgb = np.asarray(img, dtype=np.float32) / 255.0
    hsv = np.asarray(img.convert("HSV"), dtype=np.float32)
    h, s, v = hsv[..., 0] * 360.0 / 255.0, hsv[..., 1] / 255.0, hsv[..., 2] / 255.0
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    keyed = (h >= hue_lo) & (h <= hue_hi) & (s >= sat_min) & (v >= val_min)
    spill = g - np.maximum(r, b)                      # greener-than-neutral amount
    alpha = np.clip(1.0 - (spill - 0.04) / 0.16, 0.0, 1.0)   # soft antialiased edge
    alpha[keyed] = 0.0
    g = np.minimum(g, np.maximum(r, b) + 0.02)        # despill
    out = np.stack([r, g, b], axis=-1)
    out[alpha <= 0.0] = 0.0
    rgba = np.concatenate([out, alpha[..., None]], axis=-1)
    return Image.fromarray((np.clip(rgba, 0, 1) * 255).astype(np.uint8), "RGBA")


def trim_pad_square(img, size, pad_frac=0.1):
    bbox = img.getchannel("A").point(lambda p: 255 if p > 8 else 0).getbbox()
    if bbox:
        img = img.crop(bbox)
    inner = max(1, int(round(size * (1 - 2 * pad_frac))))
    scale = inner / max(img.size)
    img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(img, ((size - img.width) // 2, (size - img.height) // 2))
    return canvas


def contact_sheet(images, labels, out_path, cols=2, bg=(246, 246, 250), pad=18):
    cw, ch = max(i.width for i in images), max(i.height for i in images)
    rows = (len(images) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * (cw + pad) + pad, rows * (ch + pad + 18) + pad), bg)
    from PIL import ImageDraw
    d = ImageDraw.Draw(sheet)
    for i, (im, lab) in enumerate(zip(images, labels)):
        x, y = pad + (i % cols) * (cw + pad), pad + (i // cols) * (ch + pad + 18)
        sheet.paste(im.convert("RGB"), (x, y))
        d.text((x + 2, y + ch + 4), lab, fill=(40, 40, 50))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    sheet.save(out_path)
    return out_path


def mask_render(icon, size, fg, bg):
    """Simulate the CSS mask: alpha becomes the shape, filled with `fg` over `bg`."""
    cell = Image.new("RGBA", (size, size), bg)
    cell.paste(Image.new("RGBA", (size, size), fg), (0, 0),
               icon.resize((size, size), Image.LANCZOS).getchannel("A"))
    return cell


def opaque_pct(img):
    a = np.asarray(img.getchannel("A"))
    return 100.0 * float((a > 128).sum()) / a.size


def edge_green(raw):
    """Fraction of the raw border ring that is green — low means a plate or framed fill."""
    a = np.asarray(raw.convert("HSV"), dtype=np.float32)
    ring = np.concatenate([a[:3].reshape(-1, 3), a[-3:].reshape(-1, 3),
                           a[:, :3].reshape(-1, 3), a[:, -3:].reshape(-1, 3)])
    h, s, v = ring[:, 0] * 360 / 255, ring[:, 1] / 255, ring[:, 2] / 255
    return float(((h >= 50) & (h <= 120) & (s >= 0.25) & (v >= 0.15)).mean())


def fringe_pct(img):
    """% of visible pixels still green after despill (should be ~0)."""
    a = np.asarray(img, dtype=np.float32)
    vis = a[..., 3] > 16
    if not vis.any():
        return 100.0
    r, g, b = a[..., 0][vis], a[..., 1][vis], a[..., 2][vis]
    return 100.0 * float(((g > r + 25) & (g > b + 25)).mean())


# ---------------------------------------------------------------- subcommands
LOGOS = ["a twenty-sided die seen face-on with a small round table under it",
         "a ring of four meeples around a circle",
         "a fan of three cards with a six-sided die",
         "a crescent moon over a round tabletop with a die",
         # second round — the owner passed on all four above
         "a round table seen from directly above with four empty seats spaced evenly around it, "
         "like a top-down floor plan",
         "a six-sided die whose visible face shows a crescent moon instead of pips",
         "five dice pips arranged like a constellation of stars inside a circle",
         "a glowing lantern standing beside a single six-sided die"]

ICONS = [("search", "a magnifying glass"),
         ("events", "a calendar page with a small die on it, only two or three large grid squares, "
                    "very simple, no dense grid of tiny squares"),
         ("mine", "an admission ticket"), ("organize", "a clipboard with a checkmark"),
         ("seat", "a simple chair seen from the front"), ("full", "a closed padlock"),
         ("in", "a bold checkmark inside a circle"), ("empty", "two dice"),
         ("alert", "a warning triangle with an exclamation mark"),
         ("shield", "a simple shield")]


def cmd_logo():
    cells, labels = [], []
    for i, motif in enumerate(LOGOS, 1):
        raw = generate(f"logo{i}", f"{motif}. {STYLE}.", "1:1")
        if raw is None:
            print(f"[logo{i}] skipped"); continue
        mark = trim_pad_square(chroma_key(raw), 512)
        os.makedirs(os.path.join(OUT, "logo"), exist_ok=True)
        mark.save(os.path.join(OUT, "logo", f"{i}.png"))
        cell = Image.new("RGBA", (330, 150), (255, 255, 255, 255))
        cell.paste(Image.new("RGBA", (165, 150), (41, 13, 74, 255)), (165, 0))
        cell.alpha_composite(mask_render(mark, 110, (44, 43, 51, 255), (0, 0, 0, 0)), (28, 20))
        cell.alpha_composite(mask_render(mark, 110, (255, 255, 255, 255), (0, 0, 0, 0)), (193, 20))
        cell.alpha_composite(mask_render(mark, 24, (44, 43, 51, 255), (0, 0, 0, 0)), (71, 118))
        cell.alpha_composite(mask_render(mark, 24, (255, 255, 255, 255), (0, 0, 0, 0)), (236, 118))
        cells.append(cell); labels.append(f"concept {i} (24px below) — {motif[:44]}")
        print(f"[logo{i}] opaque={opaque_pct(mark):.1f}% fringe={fringe_pct(mark):.2f}%")
    if cells:
        print("sheet:", contact_sheet(cells, labels, os.path.join(OUT, "logo-sheet.png"), cols=2))


def cmd_icons():
    ref, cells, labels, stats = None, [], [], {}
    os.makedirs(os.path.join(REPO, "public", "icons"), exist_ok=True)
    for name, subject in ICONS:
        if ref is None:
            prompt = f"{subject}. {ICON_STYLE}."
        else:
            prompt = ("Match the reference image's rendering style, stroke weight and simplicity exactly; "
                      f"the subject is different: {subject}. {ICON_STYLE}.")
        raw = generate(name, prompt, "1:1", ref)
        was_cached = CACHED[0]
        icon = trim_pad_square(chroma_key(raw), 96) if raw is not None else None
        # Only a keying failure earns a re-ask. Coverage outside 20-70% is merely reported: thin-stroke
        # glyphs (magnifier, warning triangle) legitimately land near 16-20% with a perfect key.
        ok = icon is not None and fringe_pct(icon) < 1.0 and edge_green(raw) > 0.9
        if not ok and raw is not None and not was_cached:
            print(f"[{name}] re-ask (key failed): fringe={fringe_pct(icon):.2f}% "
                  f"edge_green={edge_green(raw):.2f}")
            os.replace(os.path.join(RAW, f"{name}.png"), os.path.join(RAW, f"{name}-rejected.png"))
            raw = generate(name, prompt + REASK, "1:1", ref)
            icon = trim_pad_square(chroma_key(raw), 96) if raw is not None else None
        if icon is None:
            print(f"[{name}] FAILED"); continue
        icon.save(os.path.join(REPO, "public", "icons", f"{name}.png"), optimize=True)
        stats[name] = (opaque_pct(icon), fringe_pct(icon), edge_green(raw))
        flag = "" if 20 <= stats[name][0] <= 70 else "  (coverage outside 20-70%, thin glyph - review)"
        print(f"[{name}] opaque={stats[name][0]:.1f}% fringe={stats[name][1]:.2f}% "
              f"edge_green={stats[name][2]:.2f}{flag}")
        if ref is None:
            ref = raw  # first accepted icon's RAW image steers the rest
        cell = Image.new("RGBA", (150, 76), (255, 255, 255, 255))
        cell.paste(Image.new("RGBA", (75, 76), (15, 5, 28, 255)), (75, 0))
        cell.alpha_composite(mask_render(icon, 44, (44, 43, 51, 255), (0, 0, 0, 0)), (15, 6))
        cell.alpha_composite(mask_render(icon, 44, (242, 240, 248, 255), (0, 0, 0, 0)), (90, 6))
        cell.alpha_composite(mask_render(icon, 20, (44, 43, 51, 255), (0, 0, 0, 0)), (27, 52))
        cell.alpha_composite(mask_render(icon, 20, (242, 240, 248, 255), (0, 0, 0, 0)), (102, 52))
        cells.append(cell); labels.append(name)
    if cells:
        print("sheet:", contact_sheet(cells, labels, os.path.join(OUT, "icons-sheet.png"), cols=3))
    return stats


def cmd_bg():
    raw = generate("bg-tabletop", (
        "very dark indigo night background, faint soft blue glow low near the bottom edge, extremely subtle "
        "scattered silhouettes of tabletop game pieces - dice, playing cards, meeples - at very low contrast, "
        "almost invisible, no text, no letters, no people, no logos, no bright areas, cinematic, minimal"),
        "9:16")
    if raw is None:
        print("[bg] FAILED"); return
    img = raw.convert("RGB").resize((1080, 1920), Image.LANCZOS)
    lum = float(np.asarray(img.convert("L"), dtype=np.float32).mean())
    os.makedirs(os.path.join(REPO, "public", "brand"), exist_ok=True)
    dest = os.path.join(REPO, "public", "brand", "bg-tabletop.webp")
    img.save(dest, "WEBP", quality=70, method=6)
    print(f"[bg] {dest} {os.path.getsize(dest)/1024:.1f} KB mean_luminance={lum:.1f}/255 "
          f"({'OK' if lum < 60 else 'TOO BRIGHT'})")


if __name__ == "__main__":
    cmd = (sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("-") else "all")
    if cmd in ("logo", "all"): cmd_logo()
    if cmd in ("icons", "all"): cmd_icons()
    if cmd in ("bg", "all"): cmd_bg()
    print(f"API calls this run: {CALLS[0]}")
