"""生成 NSIS 安装器用的两张位图。

MUI 要求位图必须是 BMP（24 位）：
- header.bmp  150x57  内页页眉右上角
- sidebar.bmp 164x314 欢迎页 / 完成页左侧竖条

设计原则：与应用同色（品牌蓝 #0066cc）+ 纯白字，不加渐变与阴影——
安装器是系统级 UI，扁平色块比花哨图更耐看，也不会因为缩放糊成一团。
"""

from PIL import Image, ImageDraw, ImageFont

BRAND = (0, 102, 204)
BRAND_DARK = (0, 78, 158)
INK = (16, 35, 58)
MUTED = (91, 107, 124)

FONT_DIR = "src/assets/fonts"
BOLD = f"{FONT_DIR}/SourceHanSansSC-Bold.otf"
REG = f"{FONT_DIR}/SourceHanSansSC-Regular.otf"
LATIN_BOLD = f"{FONT_DIR}/DMSans-Bold.ttf"


def font(path, size):
    return ImageFont.truetype(path, size)


def mark(draw, x, y, size, bg, fg):
    """圆角方块 + 字母 A 的品牌标记。"""
    r = size // 4
    draw.rounded_rectangle([x, y, x + size, y + size], radius=r, fill=bg)
    f = font(LATIN_BOLD, int(size * 0.62))
    box = draw.textbbox((0, 0), "A", font=f)
    w, h = box[2] - box[0], box[3] - box[1]
    draw.text(
        (x + (size - w) / 2 - box[0], y + (size - h) / 2 - box[1] - size * 0.03),
        "A",
        font=f,
        fill=fg,
    )


def wrap(draw, text, f, max_w):
    """按像素宽度折行。中文没有空格，只能逐字量。"""
    lines, cur = [], ""
    for ch in text:
        trial = cur + ch
        if draw.textlength(trial, font=f) > max_w and cur:
            lines.append(cur)
            cur = ch
        else:
            cur = trial
    if cur:
        lines.append(cur)
    return lines


def header():
    im = Image.new("RGB", (150, 57), (255, 255, 255))
    d = ImageDraw.Draw(im)
    # 只放标记与字标：页眉本来就窄（150x57），再塞一行小字只会挤成一团，
    # 页面标题由 MUI 画在图片左侧，信息已经够了
    mark(d, 11, 14, 29, BRAND, (255, 255, 255))
    d.text((49, 16), "Aura", font=font(LATIN_BOLD, 20), fill=INK)
    im.save("src-tauri/assets/installer/header.bmp", "BMP")


def sidebar():
    im = Image.new("RGB", (164, 314), BRAND)
    d = ImageDraw.Draw(im)
    # 右侧一条更深的竖带，给纯色块一点层次（不用渐变，避免缩放糊）
    d.rectangle([152, 0, 164, 314], fill=BRAND_DARK)

    mark(d, 16, 26, 44, (255, 255, 255), BRAND)
    d.text((16, 86), "Aura", font=font(LATIN_BOLD, 30), fill=(255, 255, 255))

    d.text((16, 130), "本地优先的", font=font(REG, 12), fill=(255, 255, 255))
    d.text((16, 149), "桌面 AI Agent", font=font(REG, 12), fill=(255, 255, 255))

    # 逐字折行，避免 9px 的中文串顶到右侧深色竖带上
    body_font = font(REG, 9)
    body = "模型在工作区里读写文件、执行命令；会话与密钥只留在本机。"
    lines = wrap(d, body, body_font, 128)
    d.multiline_text(
        (16, 182), "\n".join(lines), font=body_font, fill=(214, 232, 250), spacing=6
    )

    d.line([16, 268, 140, 268], fill=(120, 175, 230), width=1)
    d.text((16, 276), "aura-xyz/aura", font=font(LATIN_BOLD, 9), fill=(180, 210, 240))
    im.save("src-tauri/assets/installer/sidebar.bmp", "BMP")


if __name__ == "__main__":
    header()
    sidebar()
    print("header.bmp 150x57 / sidebar.bmp 164x314 已生成")
