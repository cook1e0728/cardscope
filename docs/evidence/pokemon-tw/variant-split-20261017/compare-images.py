# ADR 0043 addendum (2026-10-17): compare each TCGdex image with the two official images of the same card (scratch folder only, 1 request / 1.6 s, stops after 2 non-200).
# Usage: python -I -W ignore compare-images.py all out.jsonl  (base-raw.json = run-sql output of base-cards.sql, next to this script; img/ = scratch image folder)
import json, sys, time, os, urllib.request, io
from PIL import Image, ImageChops

S = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(S, 'img')
base = json.load(open(os.path.join(S, 'base-raw.json'), encoding='utf-8'))
mode = sys.argv[1]  # sample | rest | all
out_path = os.path.join(S, sys.argv[2])
done = set()
if os.path.exists(out_path):
    for line in open(out_path, encoding='utf-8'):
        done.add(json.loads(line)['id'])

sv2a = [x for x in base if x['code'] == 'SV2a']
sv8a = [x for x in base if x['code'] == 'SV8a']
sample = sv2a + sv8a[::6]
sample_ids = {x['id'] for x in sample}
if mode == 'sample': todo = sample
elif mode == 'rest': todo = [x for x in base if x['id'] not in sample_ids]
else: todo = base
todo = [x for x in todo if x['id'] not in done]

last = [0.0]
fails = [0]
def get(url, name):
    path = os.path.join(IMG, name)
    if os.path.exists(path): return path
    wait = 1.6 - (time.time() - last[0])
    if wait > 0: time.sleep(wait)
    last[0] = time.time()
    req = urllib.request.Request(url, headers={'User-Agent': 'CardScope/1.0 (image compare; low rate)'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read(); code = r.status
    except urllib.error.HTTPError as e:
        code = e.code; data = b''
    except Exception as e:
        code = -1; data = b''
    if code != 200:
        fails[0] += 1
        print('NON200', code, url, flush=True)
        if fails[0] >= 2:
            print('STOP: 2 consecutive non-200', flush=True); sys.exit(2)
        return None
    fails[0] = 0
    open(path, 'wb').write(data)
    return path

def prep(p, size=(48, 66)):
    im = Image.open(p).convert('RGB')
    return im.resize(size, Image.LANCZOS)

def dist(a, b):
    d = ImageChops.difference(a, b)
    px = list(d.getdata())
    return sum(sum(t) for t in px) / (len(px) * 3 * 255)

def dhash(im, n=16):
    g = im.convert('L').resize((n + 1, n), Image.LANCZOS)
    px = list(g.getdata()); bits = []
    for y in range(n):
        for x in range(n):
            bits.append(1 if px[y * (n + 1) + x] > px[y * (n + 1) + x + 1] else 0)
    return bits

def ham(a, b): return sum(1 for x, y in zip(a, b) if x != y)

def oid(i): return 'tw' + str(i).zfill(8) + '.png'

with open(out_path, 'a', encoding='utf-8') as out:
    for x in todo:
        tg = get(x['printing_image_url'], x['id'] + '-tcgdex.webp')
        if not tg: continue
        ims = []
        ok = True
        for i in x['ids']:
            p = get('https://asia.pokemon-card.com/tw/card-img/' + oid(i), oid(i))
            if not p: ok = False; break
            ims.append(p)
        if not ok: continue
        t = prep(tg)
        offs = [prep(p) for p in ims]
        pix = [dist(t, o) for o in offs]
        th = dhash(t)
        hs = [ham(th, dhash(o)) for o in offs]
        d_off = dist(offs[0], offs[1])
        h_off = ham(dhash(offs[0]), dhash(offs[1]))
        sizes = [Image.open(p).size for p in ims]
        rec = {'id': x['id'], 'code': x['code'], 'ids': x['ids'], 'pixel': pix, 'dhash': hs,
               'officialPixelDiff': d_off, 'officialDhashDiff': h_off,
               'pixelWinner': x['ids'][pix.index(min(pix))], 'dhashWinner': x['ids'][hs.index(min(hs))] if hs[0] != hs[1] else None,
               'tcgdexSize': Image.open(tg).size, 'officialSizes': sizes}
        out.write(json.dumps(rec, ensure_ascii=False) + '\n'); out.flush()
print('DONE')
