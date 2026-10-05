"""Renders public/cover.png (1600x900) in the game's ink/bone/lime/vermilion language.
Needs TTF copies of the fonts: python3 -c "from fontTools.ttLib import TTFont; ..." (see README)."""
import math, random, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageChops
K = 2; W, H = 1600*K, 900*K
P = lambda v: int(v*K)
INK=(9,9,12); BONE=(236,230,216); LIME=(198,255,61); VERM=(255,91,46)
FD = '/tmp/claude-501/ttf/unbounded.ttf'; FM = '/tmp/claude-501/ttf/martian-mono.ttf'

def font(path, size, wght):
    f = ImageFont.truetype(path, size)
    try: f.set_variation_by_axes([wght])
    except Exception: pass
    return f

# ---- background: ink with soft vignette + grain
img = Image.new('RGB', (W, H), INK)
v = Image.radial_gradient('L').resize((W, H)); v = v.point(lambda p: int(255-p*0.9))
img = Image.composite(Image.new('RGB', (W, H), (24, 24, 32)), img, v.point(lambda p: int(p*0.55))).convert('RGBA')
random.seed(3)
noise = Image.effect_noise((W, H), 28).convert('L').point(lambda p: max(0, p-128)*2)
img = Image.alpha_composite(img, Image.merge('RGBA', (Image.new('L', (W, H), 236), Image.new('L', (W, H), 230), Image.new('L', (W, H), 216), noise.point(lambda p: int(p*0.10)))))

def layer(): return Image.new('RGBA', (W, H), (0, 0, 0, 0))
def blur(l, r): return l.filter(ImageFilter.GaussianBlur(r*K))

CX, CY, R = P(1165), P(455), P(300)
def circ(d, r, cx=CX, cy=CY, **kw): d.ellipse((cx-r, cy-r, cx+r, cy+r), **kw)

# arena floor
l = layer(); d = ImageDraw.Draw(l); circ(d, R, fill=(20, 20, 28, 255)); img = Image.alpha_composite(img, l)
# polar grid
l = layer(); d = ImageDraw.Draw(l)
for r in (95, 165, 235):
    circ(d, P(r), outline=BONE+(34,), width=P(1.2))
for a in range(12):
    t = a*math.pi/6; d.line([(CX+math.cos(t)*P(62), CY+math.sin(t)*P(62)), (CX+math.cos(t)*R, CY+math.sin(t)*R)], fill=BONE+(22,), width=P(1))
img = Image.alpha_composite(img, l)

# hatch bands (rim + core)
def hatch_mask(r0, r1, spacing=7):
    m = Image.new('L', (W, H), 0); md = ImageDraw.Draw(m)
    for x in range(-H, W+H, P(spacing)):
        md.line([(x, 0), (x-H, H)], fill=255, width=P(1.6))
    ring = Image.new('L', (W, H), 0); rd = ImageDraw.Draw(ring); circ(rd, r1, fill=255); circ(rd, r0, fill=0)
    return ImageChops.multiply(m, ring)
for (a, b, al) in ((R-P(22), R, 150), (R-P(42), R-P(22), 85), (R-P(62), R-P(42), 38)):
    m = hatch_mask(a, b).point(lambda p, al=al: int(p*al/255)); l = Image.new('RGBA', (W, H), BONE+(0,)); l.putalpha(m); img = Image.alpha_composite(img, l)
m = hatch_mask(P(40), P(58)).point(lambda p: int(p*0.55)); l = Image.new('RGBA', (W, H), BONE+(0,)); l.putalpha(m); img = Image.alpha_composite(img, l)

# rim glow + line
l = layer(); d = ImageDraw.Draw(l); circ(d, R, outline=BONE+(255,), width=P(6)); img = Image.alpha_composite(img, blur(l, 8).point(lambda p: p) if False else blur(l, 8))
l = layer(); d = ImageDraw.Draw(l); circ(d, R, outline=BONE+(255,), width=P(3)); img = Image.alpha_composite(img, l)
# protractor ticks
l = layer(); d = ImageDraw.Draw(l)
for deg in range(0, 360, 2):
    a = math.radians(deg); major = deg % 30 == 0; mid = deg % 10 == 0
    ln = P(15 if major else 9 if mid else 4); al = 230 if major else 130 if mid else 70
    d.line([(CX+math.cos(a)*(R+P(8)), CY+math.sin(a)*(R+P(8))), (CX+math.cos(a)*(R+P(8)+ln), CY+math.sin(a)*(R+P(8)+ln))], fill=BONE+(al,), width=P(1.5 if major else 1))
fm = font(FM, P(11), 500)
for deg in range(0, 360, 30):
    a = math.radians(deg); d.text((CX+math.cos(a)*(R+P(34)), CY+math.sin(a)*(R+P(34))), f'{deg:03d}', font=fm, fill=BONE+(140,), anchor='mm')
img = Image.alpha_composite(img, l)

# black hole
l = layer(); d = ImageDraw.Draw(l); circ(d, P(120), fill=BONE+(70,)); img = Image.alpha_composite(img, blur(l, 30))
l = layer(); d = ImageDraw.Draw(l); circ(d, P(40), fill=(0, 0, 0, 255), outline=BONE+(255,), width=P(3))
for i, (a0, a1) in enumerate(((200, 310), (20, 140), (95, 150))):
    r = P(68+i*7); d.arc((CX-r, CY-r, CX+r, CY+r), a0, a1, fill=BONE+(220-i*50,), width=P(2))
img = Image.alpha_composite(img, l)

# orbs
def orb(x, y, col, p0, ctrl):
    global img
    t = layer(); td = ImageDraw.Draw(t); pts = []
    for i in range(44):
        s = i/43; px = (1-s)**2*p0[0] + 2*(1-s)*s*ctrl[0] + s*s*x; py = (1-s)**2*p0[1] + 2*(1-s)*s*ctrl[1] + s*s*y; pts.append((px, py))
    for i in range(1, len(pts)):
        f = i/len(pts); td.line([pts[i-1], pts[i]], fill=col+(int(190*f*f),), width=max(1, int(P(32)*f)))
    img = Image.alpha_composite(img, blur(t, 1.5))
    g = layer(); gd = ImageDraw.Draw(g); gd.ellipse((x-P(60), y-P(60), x+P(60), y+P(60)), fill=col+(120,)); img = Image.alpha_composite(img, blur(g, 22))
    o = layer(); od = ImageDraw.Draw(o); r = P(24)
    od.ellipse((x-r, y-r, x+r, y+r), fill=col+(255,))
    od.ellipse((x-P(18), y-P(18), x+P(18), y+P(18)), outline=INK+(100,), width=P(2))
    od.ellipse((x-P(8)-P(3), y-P(9)-P(3), x-P(8)+P(3), y-P(9)+P(3)), fill=BONE+(255,))
    od.ellipse((x-r-P(6), y-r-P(6), x+r+P(6), y+r+P(6)), outline=BONE+(140,), width=P(1.6))
    img = Image.alpha_composite(img, o)
orb(CX-P(150), CY-P(215), LIME, (CX-P(330), CY-P(10)), (CX-P(290), CY-P(200)))
orb(CX+P(185), CY+P(190), VERM, (CX+P(320), CY-P(30)), (CX+P(330), CY+P(170)))

# shards
def shard(x, y, s, gold):
    global img
    l = layer(); d = ImageDraw.Draw(l); poly = [(x, y-s), (x+s*.7, y), (x, y+s), (x-s*.7, y)]
    if gold:
        for k, rr in enumerate((P(26), P(46))): circ(d, rr, cx=x, cy=y, outline=BONE+(150-k*70,), width=P(1.5))
        g = layer(); gd = ImageDraw.Draw(g); gd.polygon(poly, fill=BONE+(255,)); img = Image.alpha_composite(img, blur(g, 8))
        d.polygon(poly, fill=BONE+(255,))
    else:
        d.polygon(poly, outline=BONE+(255,), width=P(2.4)); d.rectangle((x-P(2), y-P(2), x+P(2), y+P(2)), fill=BONE+(255,))
    img = Image.alpha_composite(img, l)
shard(CX+P(200), CY-P(150), P(11), False); shard(CX-P(205), CY+P(130), P(11), False); shard(CX+P(30), CY-P(235), P(16), True)

# ---- typography (left column)
d = ImageDraw.Draw(img)
fh = font(FD, P(128), 900)
d.text((P(70), P(190)), 'GRAVITY', font=fh, fill=BONE+(255,))
# outlined DUEL
m = Image.new('L', (W, H), 0); ImageDraw.Draw(m).text((P(70)+P(24), P(190)+P(112)), 'DUEL', font=fh, fill=255)
edge = ImageChops.subtract(m.filter(ImageFilter.MaxFilter(5)), m.filter(ImageFilter.MinFilter(5)))
l = Image.new('RGBA', (W, H), BONE+(0,)); l.putalpha(edge); img = Image.alpha_composite(img, l)
d = ImageDraw.Draw(img)
ft = font(FM, P(15), 500)
d.text((P(74), P(70)), 'GD—001   /   REAL-TIME DUEL', font=ft, fill=BONE+(150,))
d.line([(P(70), P(100)), (P(70)+P(560), P(100))], fill=BONE+(70,), width=P(1))
fb = font(FD, P(30), 600)
d.text((P(74), P(500)), 'One button. Two orbits.', font=fb, fill=BONE+(255,))
fs = font(FM, P(17), 400)
for i, line in enumerate(('Hold to push out. Release to fall in.', 'Steal the shards. Throw your rival into the void.')):
    d.text((P(74), P(556)+i*P(32)), line, font=fs, fill=BONE+(170,))
# chips
def chip(x, y, txt, col, fg=INK):
    f = font(FM, P(14), 700); w = d.textlength(txt, font=f)+P(26)
    d.rectangle((x, y, x+w, y+P(32)), fill=col+(255,)); d.text((x+P(13), y+P(16)), txt, font=f, fill=fg+(255,), anchor='lm'); return x+w+P(10)
x = P(74)
x = chip(x, P(690), 'PLAY NOW', LIME); x = chip(x, P(690), '2 PLAYERS', BONE); x = chip(x, P(690), 'ANY DEVICE', BONE)
d.text((P(74), P(760)), 'NO INSTALL   ·   SHARE A LINK   ·   PRACTICE VS BOT', font=font(FM, P(13), 500), fill=BONE+(110,))

out = img.convert('RGB').resize((1600, 900), Image.LANCZOS); out.save('public/cover.png', optimize=True); print('saved', out.size)
