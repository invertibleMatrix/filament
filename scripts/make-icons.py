# Every Filament app icon from one square source with a clear background (the owner's icon.png of 11-09, kept out of
# git): large sizes keep the source's composition; sizes of 64 px and under are the glyph cropped to its own box with a
# margin, so a thin mark stays legible; the macOS menu-bar template is black with the glyph's own alpha; Windows's tray
# its own .ico, the ∫ stroke alone, bolder and brighter, at each size a scale of the screen asks for. Needs Pillow.
# desktop/lib/icons.js says which system takes which. Run from the repository's root:
#   python -I scripts/make-icons.py icon.png [--out DIR]
# --out writes the same tree under DIR instead of in place (to compare without touching the repo's files).
import sys, os
from collections import deque
from PIL import Image, ImageChops, ImageFilter, ImageStat

args = sys.argv[1:]
out = "."
if "--out" in args:
    i = args.index("--out"); out = args[i + 1]; del args[i:i + 2]
src = Image.open(args[0]).convert("RGBA")
if src.size[0] != src.size[1]:
    sys.exit("not square: refusing to distort it")
A = src.getchannel("A")

def save(rel, im, **kw):
    p = os.path.join(out, rel); os.makedirs(os.path.dirname(p), exist_ok=True); im.save(p, **kw)
    print("wrote", rel, im.size, os.path.getsize(p), "bytes")

def fitted(im, margin):
    """The image's opaque part, cropped to its box and centred on a clear square with `margin` of its side around it."""
    box = im.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
    g = im.crop(box)
    side = round(max(g.size) / (1 - 2 * margin))
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(g, ((side - g.size[0]) // 2, (side - g.size[1]) // 2))
    return sq

logo = src.resize((1024, 1024), Image.LANCZOS)
tight = fitted(src, 0.06)
def bolder(im, s):
    """At 32 px and under a thin stroke fades: drawn at four times the size, its alpha thickened by a pixel or two
    there, then brought down, its edge's alpha lifted a little."""
    if s > 32:
        return im.resize((s, s), Image.LANCZOS)
    k = 5 if s <= 16 else 3
    big = im.resize((s * 4, s * 4), Image.LANCZOS)
    r, g, b, a = big.split()
    # Only the alpha is thickened, and where it grows the colour is the mark's mean: a per-channel max would pale the
    # gold toward white specks.
    solid = a.point(lambda v: 255 if v > 128 else 0)
    stat = ImageStat.Stat(Image.merge("RGB", (r, g, b)), solid)
    fill = Image.new("RGB", big.size, tuple(round(m) for m in stat.mean))
    rgb = Image.composite(Image.merge("RGB", (r, g, b)), fill, solid)
    big = Image.merge("RGBA", (*rgb.split(), a.filter(ImageFilter.MaxFilter(k))))
    out = big.resize((s, s), Image.LANCZOS)
    r, g, b, a = out.split()
    return Image.merge("RGBA", (r, g, b, a.point(lambda v: min(255, round(v * 1.25)))))
small = lambda s: bolder(tight, s)
large = lambda s: logo.resize((s, s), Image.LANCZOS)

save("assets/filament-logo.png", logo)
# macOS's icon grid: 824 of 1024, centred (electron-builder.yml's mac.icon comment).
mac = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
mac.paste(logo.resize((824, 824), Image.LANCZOS), (100, 100))
save("build/icon-mac.png", mac)
save("src/ui/filament-icon.png", small(64))
save("tray/filament-tray.png", small(32))
save("tray/filament-tray@2x.png", small(64))
save("tray/filament-window.png", large(256))
ico = [large(256), large(128), small(64), small(48), small(32), small(24), small(16)]
save("tray/filament.ico", ico[0], format="ICO", sizes=[i.size for i in ico], append_images=ico[1:])

def stroke(im):
    """The image's largest connected part alone: the logo's ∫ without its limits 0 and 1, which at a tray's size are
    specks."""
    W = 512
    px = im.getchannel("A").resize((W, W), Image.BILINEAR).point(lambda v: 255 if v > 24 else 0).load()
    seen, best = bytearray(W * W), []
    for y in range(W):
        for x in range(W):
            if not px[x, y] or seen[y * W + x]:
                continue
            part, q = [], deque([(x, y)]); seen[y * W + x] = 1
            while q:
                cx, cy = q.popleft(); part.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < W and 0 <= ny < W and px[nx, ny] and not seen[ny * W + nx]:
                        seen[ny * W + nx] = 1; q.append((nx, ny))
            if len(part) > len(best):
                best = part
    keep = Image.new("L", (W, W), 0); kp = keep.load()
    for x, y in best:
        kp[x, y] = 255
    keep = keep.filter(ImageFilter.MaxFilter(5)).resize(im.size, Image.BILINEAR)
    a = ImageChops.multiply(im.getchannel("A"), keep)
    return a.crop(a.point(lambda v: 255 if v > 24 else 0).getbbox())

# Windows's tray: Windows asks the .ico for the size its scale wants (16 at 100%, 20, 24, 28, 32 at 200%, 36, 40, 48),
# so each is drawn for itself. The stroke is thickened by about half a pixel each side (a little more as it grows), in a
# brighter gold than the logo's, whose dark lower end sinks into a dark taskbar; a thin dark bronze rim keeps it on a
# light one, where it barely shows against a dark one.
TOP, BOT, RIM = (255, 226, 150), (230, 165, 70), (70, 45, 10)
mark = stroke(src)
def tray(s):
    S, m = s * 8, round(s * 8 * 0.04)
    h = S - 2 * m; w = round(mark.size[0] * h / mark.size[1])
    a = Image.new("L", (S, S), 0); a.paste(mark.resize((w, h), Image.LANCZOS), ((S - w) // 2, m))
    a = a.filter(ImageFilter.MaxFilter(2 * round(0.5 * (s / 16) ** 0.35 * 8) + 1))
    grad = Image.linear_gradient("L").resize((S, S))
    fg = Image.merge("RGBA", [grad.point(lambda v, t=t, b=b: round(t + (b - t) * v / 255)) for t, b in zip(TOP, BOT)] + [a])
    rim = a.filter(ImageFilter.MaxFilter(2 * round(0.5 * (s / 16) ** 0.3 * 8) + 1)).point(lambda v: round(v * 0.7))
    im = Image.merge("RGBA", (*Image.new("RGB", (S, S), RIM).split(), rim)); im.alpha_composite(fg)
    return im.resize((s, s), Image.LANCZOS)
tico = [tray(s) for s in (64, 48, 40, 36, 32, 28, 24, 20, 16)]
save("tray/filament-tray.ico", tico[0], format="ICO", sizes=[i.size for i in tico], append_images=tico[1:])

# macOS menu-bar template: black, the glyph's own alpha, cropped and fitted to the bar's height (16, and 32 for @2x).
glyph = fitted(src, 0.0)
ga = glyph.getchannel("A")
for rel, h in [("tray/filament-trayTemplate.png", 16), ("tray/filament-trayTemplate@2x.png", 32)]:
    g = bolder(Image.merge("RGBA", (Image.new("L", ga.size, 0),) * 3 + (ga,)), h).getchannel("A")
    t = Image.merge("RGBA", (Image.new("L", (h, h), 0),) * 3 + (g,))
    save(rel, t)
