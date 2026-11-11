"""兔子姿勢圖去背：綠幕（#00FF00）原圖 → 512×512 透明 PNG，所有圖共用同一個裁切框（換姿勢時兔子不會跳）。
用法：python scripts/rabbit-key.py <輸出資料夾> wave-a=raw1.jpg wave-b=raw2.jpg ...
規格見 docs/BRAND_RABBIT.md。不帶參數直接執行會顯示用法並停住。"""
import sys
import numpy as np
from PIL import Image, ImageFilter


def key(path):
    a = np.asarray(Image.open(path).convert('RGB')).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    bg = (g > r + 35) & (g > b + 35)
    # 去雜點，再內縮 1px 吃掉 JPG 留下的綠邊
    m = Image.fromarray((~bg * 255).astype('uint8')).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    a[..., 1] = np.minimum(g, np.maximum(r, b) + 8)  # 去綠溢色
    return np.dstack([a.clip(0, 255), np.asarray(m)]).astype('uint8')


def main(out_dir, pairs):
    imgs = {n: key(p) for n, p in pairs}
    ys, xs = np.where(np.any([v[..., 3] > 0 for v in imgs.values()], axis=0))
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    sc = 480 / max(x1 - x0, y1 - y0)
    for n, v in imgs.items():
        im = Image.fromarray(v).crop((x0, y0, x1, y1))
        im = im.resize((round(im.width * sc), round(im.height * sc)), Image.LANCZOS)
        c = Image.new('RGBA', (512, 512))
        c.paste(im, ((512 - im.width) // 2, 512 - 16 - im.height), im)
        g = np.asarray(c).astype(int)
        left = int(((g[..., 1] > g[..., 0] + 35) & (g[..., 1] > g[..., 2] + 35) & (g[..., 3] > 0)).sum())
        c.save(f'{out_dir}/{n}.png', optimize=True)
        print(f'{n}.png  綠色殘留 {left} 像素')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')  # Windows 主控台預設 cp950，中文會亂碼
    try:
        if len(sys.argv) < 3:
            print(__doc__)
        else:
            main(sys.argv[1], [a.split('=', 1) for a in sys.argv[2:]])
    except Exception as e:
        print('錯誤：', e)
    try:
        input('按 Enter 關閉')  # 雙擊執行時視窗停住
    except EOFError:
        pass
