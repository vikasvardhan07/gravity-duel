"""Renders public/cover.png (1600x900) for the contest submission."""
import math, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont
K = 2; W, H = 1600*K, 900*K
def P(v): return int(v*K)
bg = Image.new('RGB', (W, H), (3, 4, 11))
px = bg.load()
cx0, cy0 = W/2, H*0.5
maxd = math.hypot(W, H)*0.55
for y in range(0, H):
    for x in range(0, W, 1):
        d = min(1, math.hypot(x-cx0, y-cy0)/maxd)
        t = (1-d)**1.6
        px[x, y] = (int(3+13*t), int(4+17*t), int(11+52*t))
img = bg.convert('RGBA')
random.seed(4)
d = ImageDraw.Draw(img)
for _ in range(220):
    x, y, r = random.random()*W, random.random()*H, random.random()*2.2*K+0.6*K
    a = int(70+random.random()*150); d.ellipse((x-r, y-r, x+r, y+r), fill=(205, 215, 255, a))

def glow(draw_fn, blur, alpha=1.0):
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0)); draw_fn(ImageDraw.Draw(layer))
    layer = layer.filter(ImageFilter.GaussianBlur(blur*K))
    if alpha < 1: layer.putalpha(layer.getchannel('A').point(lambda v: int(v*alpha)))
    return layer

CX, CY, R = P(800), P(505), P(300)
def circ(dr, r, **kw): dr.ellipse((CX-r, CY-r, CX+r, CY+r), **kw)

# arena
img = Image.alpha_composite(img, glow(lambda g: circ(g, R, outline=(255, 45, 111, 255), width=P(10)), 10))
d = ImageDraw.Draw(img)
circ(d, R, fill=(10, 13, 44, 215))
# danger gradient inside rim
danger = Image.new('RGBA', (W, H), (0, 0, 0, 0)); dd = ImageDraw.Draw(danger)
for i in range(60):
    r = R - P(i*1.4); a = int(95*(1-i/60)**1.8)
    circ(dd, r, outline=(255, 45, 111, a), width=P(2))
img = Image.alpha_composite(img, danger); d = ImageDraw.Draw(img)
circ(d, R, outline=(255, 90, 135, 255), width=P(6))
# flow dots
for rr in (110, 175, 240):
    n = int(rr*0.9)
    for i in range(n):
        a = i/n*2*math.pi
        x, y = CX+math.cos(a)*P(rr), CY+math.sin(a)*P(rr)
        d.ellipse((x-P(1.6), y-P(1.6), x+P(1.6), y+P(1.6)), fill=(150, 170, 255, 85))
# black hole
img = Image.alpha_composite(img, glow(lambda g: circ(g, P(80), fill=(255, 45, 111, 230)), 26))
d = ImageDraw.Draw(img)
circ(d, P(40), fill=(0, 0, 0, 255), outline=(255, 45, 111, 255), width=P(4))
for i, (a0, a1) in enumerate([(200, 300), (20, 120), (110, 160)]):
    r = P(48+i*7); d.arc((CX-r, CY-r, CX+r, CY+r), a0, a1, fill=(255, 140+i*30, 180, 220), width=P(4))

def orb(x, y, rgb, tr_from):
    global img
    # trail (curved)
    tl = Image.new('RGBA', (W, H), (0, 0, 0, 0)); td = ImageDraw.Draw(tl)
    pts = []
    for i in range(36):
        t = i/35
        pts.append((tr_from[0]+(x-tr_from[0])*t + math.sin(t*math.pi)*tr_from[2], tr_from[1]+(y-tr_from[1])*t + math.sin(t*math.pi)*tr_from[3]))
    for i in range(1, len(pts)):
        f = i/len(pts); w = P(30*f)
        td.line([pts[i-1], pts[i]], fill=rgb+(int(170*f),), width=max(1, w))
    tl = tl.filter(ImageFilter.GaussianBlur(P(2)))
    img = Image.alpha_composite(img, tl)
    img = Image.alpha_composite(img, glow(lambda g: g.ellipse((x-P(60), y-P(60), x+P(60), y+P(60)), fill=rgb+(150,)), 22))
    dd2 = ImageDraw.Draw(img); r = P(30)
    for i in range(r, 0, -1):
        f = i/r; c = tuple(int(rgb[j]*(0.45+0.55*(1-f))) for j in range(3))
        ox = -(1-f)*P(9); oy = -(1-f)*P(10)
        dd2.ellipse((x+ox-i, y+oy-i, x+ox+i, y+oy+i), fill=c+(255,))
    dd2.ellipse((x-P(12), y-P(14), x-P(2), y-P(5)), fill=(255, 255, 255, 230))

orb(CX-P(150), CY-P(205), (0, 229, 255), (CX-P(285), CY-P(40), -P(10), -P(60)))
orb(CX+P(170), CY+P(190), (255, 106, 61), (CX+P(290), CY+P(10), P(10), P(60)))

def shard(x, y, s, rgb):
    global img
    img = Image.alpha_composite(img, glow(lambda g: g.polygon([(x, y-s), (x+s*.75, y), (x, y+s), (x-s*.75, y)], fill=rgb+(220,)), 12))
    d3 = ImageDraw.Draw(img); d3.polygon([(x, y-s), (x+s*.75, y), (x, y+s), (x-s*.75, y)], fill=rgb+(255,))
    d3.polygon([(x, y-s*.5), (x+s*.3, y), (x, y+s*.5), (x-s*.3, y)], fill=(255, 255, 255, 220))
shard(CX+P(175), CY-P(120), P(15), (120, 255, 200))
shard(CX-P(190), CY+P(115), P(15), (120, 255, 200))
shard(CX+P(20), CY-P(215), P(22), (255, 210, 63))

def font(sz, bold=True):
    for p in ('/System/Library/Fonts/Supplemental/Arial Black.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Helvetica.ttc'):
        try: return ImageFont.truetype(p, sz)
        except Exception: pass
    return ImageFont.load_default()
d = ImageDraw.Draw(img)
# gradient title
title = 'GRAVITY DUEL'; f = font(P(112))
sp = P(10)
widths = [d.textlength(ch, font=f) for ch in title]; total = sum(widths)+sp*(len(title)-1)
mask = Image.new('L', (W, H), 0); md = ImageDraw.Draw(mask); x = (W-total)/2; ty = P(34)
for ch, w in zip(title, widths):
    md.text((x, ty), ch, font=f, fill=255); x += w+sp
grad = Image.new('RGBA', (W, H)); gp = grad.load()
x0, x1 = int((W-total)/2), int((W+total)/2)
for xx in range(x0, x1):
    t = (xx-x0)/(x1-x0); c = (int(0+255*t), int(229-123*t), int(255-194*t), 255)
    for yy in range(ty, ty+P(150)): gp[xx, yy] = c
shadow = glow(lambda g: None, 1)
sh = Image.new('RGBA', (W, H), (0, 0, 0, 0)); sh.putalpha(mask.filter(ImageFilter.GaussianBlur(P(10)))); 
dark = Image.new('RGBA', (W, H), (0, 0, 0, 255)); dark.putalpha(mask.filter(ImageFilter.GaussianBlur(P(10))).point(lambda v: int(v*0.7)))
img = Image.alpha_composite(img, dark)
txt = Image.new('RGBA', (W, H), (0, 0, 0, 0)); txt.paste(grad, (0, 0), mask)
img = Image.alpha_composite(img, txt)
d = ImageDraw.Draw(img)
f2 = font(P(36)); tag = 'Hold to push out.  Release to fall in.  Knock your rival into the void.'
d.text((W/2, P(852)), tag, font=f2, fill=(238, 241, 255, 255), anchor='mm')
f3 = font(P(26))
d.text((P(40), P(850)), 'REAL-TIME  ·  2 PLAYERS  ·  ANY DEVICE', font=f3, fill=(152, 160, 200, 255), anchor='lm') if False else None
out = img.convert('RGB').resize((1600, 900), Image.LANCZOS)
out.save('public/cover.png', optimize=True)
print('saved', out.size)
