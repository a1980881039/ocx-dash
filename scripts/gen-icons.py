"""生成 ocx-dash 应用图标：渐变圆角方块 + 额度圆弧 + 白色闪电。"""
import os
from PIL import Image, ImageDraw

ICONS = r'C:\Users\might\Desktop\Projects\ocx-dash\src-tauri\icons'
os.makedirs(ICONS, exist_ok=True)

SS = 8  # 超采样倍数


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make_icon(size):
    px = size * SS
    img = Image.new('RGBA', (px, px), (0, 0, 0, 0))

    # --- 圆角方块遮罩 ---
    radius = round(px * 0.235)
    mask = Image.new('L', (px, px), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, px - 1, px - 1], radius=radius, fill=255)

    # --- 对角渐变底 ---
    grad = Image.new('RGBA', (px, px))
    gd = ImageDraw.Draw(grad)
    top = (14, 165, 233)      # #0ea5e9
    bottom = (79, 70, 229)    # #4f46e5
    for y in range(px):
        for_t = (y / max(1, px - 1))
        gd.line([(0, y), (px, y)], fill=lerp(top, bottom, for_t) + (255,))
    img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)

    # --- 背景额度圆弧 (240°，呼应转盘) ---
    stroke = round(px * 0.072)
    inset = round(px * 0.175)
    box = [inset, inset, px - inset, px - inset]
    arc_layer = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    ImageDraw.Draw(arc_layer).arc(box, start=150, end=390, fill=(255, 255, 255, 66), width=stroke)
    img.alpha_composite(arc_layer)

    # --- 圆弧高亮段 (约 68% 进度) ---
    hi_layer = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    ImageDraw.Draw(hi_layer).arc(box, start=150, end=150 + round(240 * 0.68),
                                 fill=(255, 255, 255, 232), width=stroke)
    img.alpha_composite(hi_layer)

    # --- 中心白色闪电 (取自界面同一多边形 13,2 3,14 12,14 11,22 21,10 12,10) ---
    bolt = [(13, 2), (3, 14), (12, 14), (11, 22), (21, 10), (12, 10)]
    bx0, by0 = 2.0, 2.0
    bx1, by1 = 22.0, 22.0
    scale = px / 26.0
    off_x = (px - (bx1 - bx0) * scale) / 2.0 - bx0 * scale
    off_y = (px - (by1 - by0) * scale) / 2.0 - by0 * scale
    pts = [(x * scale + off_x, y * scale + off_y) for (x, y) in bolt]
    ImageDraw.Draw(img).polygon(pts, fill=(255, 255, 255, 255))

    return img.resize((size, size), Image.LANCZOS)


sizes = [16, 24, 32, 48, 64, 128, 256, 512]
imgs = {}
for s in sizes:
    ic = make_icon(s)
    imgs[s] = ic
    ic.save(os.path.join(ICONS, f'{s}x{s}.png'))

# Tauri 约定的文件名
imgs[32].save(os.path.join(ICONS, '32x32.png'))
imgs[128].save(os.path.join(ICONS, '128x128.png'))
imgs[256].save(os.path.join(ICONS, '128x128@2x.png'))
imgs[512].save(os.path.join(ICONS, 'icon.png'))
imgs[256].save(os.path.join(ICONS, 'StoreLogo.png'))

# Windows ICO：多尺寸内嵌
ico_sizes = [16, 24, 32, 48, 64, 128, 256]
imgs[256].save(os.path.join(ICONS, 'icon.ico'),
               format='ICO', sizes=[(s, s) for s in ico_sizes])

print('icons written:', sorted(os.listdir(ICONS)))

