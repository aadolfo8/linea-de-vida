"""Genera las ilustraciones SVG del README con las fuentes del «Cielo nocturno» incrustadas.

Uso, desde la raíz del repo: `python docs/readme/generar.py`

Las fuentes (Bodoni Moda, Martian Mono y Figtree, las mismas que carga `app/fonts.ts`) se
descargan una vez de @fontsource-variable y se guardan en una caché temporal.
"""

import base64
import os
import random
import tempfile
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent
CACHE = Path(tempfile.gettempdir()) / "linea-de-vida-readme-fonts"
CACHE.mkdir(exist_ok=True)
CDN = "https://cdn.jsdelivr.net/npm/@fontsource-variable"


def font(pkg: str, file: str, family: str, style: str = "normal") -> str:
    local = CACHE / file
    if not local.exists():
        urllib.request.urlretrieve(f"{CDN}/{pkg}/files/{file}", local)
    data = base64.b64encode(local.read_bytes()).decode()
    return (
        f"@font-face{{font-family:'{family}';font-style:{style};font-weight:100 900;"
        f"src:url(data:font/woff2;base64,{data}) format('woff2');}}"
    )


BODONI = font("bodoni-moda@5.2.5", "bodoni-moda-latin-wght-normal.woff2", "Bodoni")
BODONI_I = font("bodoni-moda@5.2.5", "bodoni-moda-latin-wght-italic.woff2", "Bodoni", "italic")
MONO = font("martian-mono@5.2.5", "martian-mono-latin-wght-normal.woff2", "Martian")
UI = font("figtree@5.2.5", "figtree-latin-wght-normal.woff2", "Figtree")

# Tokens de `sky/sky.css`.
INK, INK2, TILE, FG, MUTE, ACCENT = "#05070d", "#0b0f1a", "#0e1424", "#e8ecf4", "#8790a4", "#cfe0ff"
LINE = "rgba(196,212,255,.16)"

# «Fotos» abstractas: degradados de tonos de foto antigua (atardecer, mar, campo, interior…).
PHOTO_TONES = [
    ("#e2a76f", "#5b2f2a"),
    ("#8fb3d4", "#22385a"),
    ("#a7bd83", "#33482c"),
    ("#e9cfb0", "#7e5b4a"),
    ("#cf8572", "#3f2238"),
    ("#b4c3df", "#36446a"),
    ("#d8b56a", "#4b3a22"),
    ("#9fc6c0", "#244b4c"),
]


def photo_defs() -> str:
    out = []
    for i, (a, b) in enumerate(PHOTO_TONES):
        out.append(
            f'<linearGradient id="p{i}" x1="0" y1="0" x2=".35" y2="1">'
            f'<stop offset="0" stop-color="{a}"/><stop offset="1" stop-color="{b}"/></linearGradient>'
        )
    out.append(
        '<radialGradient id="sheen" cx=".3" cy=".25" r=".9">'
        '<stop offset="0" stop-color="#fff" stop-opacity=".28"/>'
        '<stop offset=".6" stop-color="#fff" stop-opacity="0"/></radialGradient>'
    )
    return "".join(out)


def tile(x, y, w, h, tone, delay=None) -> str:
    """Una foto: degradado con un brillo suave. Con `delay`, nace como punto de luz y crece."""
    cx, cy = x + w / 2, y + h / 2
    body = (
        f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="3" fill="url(#p{tone})"/>'
        f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="3" fill="url(#sheen)"/>'
    )
    if delay is None or os.environ.get("STATIC"):
        return body
    d = delay + 0.7
    k = delay / d
    grow = (
        f'<animateTransform attributeName="transform" type="scale" dur="{d:.2f}s" '
        f'values="0;0;1" keyTimes="0;{k:.3f};1" calcMode="spline" '
        f'keySplines="0 0 1 1;.22 1 .36 1" fill="freeze"/>'
    )
    point = (
        f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="1.6" fill="{ACCENT}" opacity="0">'
        f'<animate attributeName="opacity" dur="{d:.2f}s" values="0;1;1;0" '
        f'keyTimes="0;.1;{k:.3f};1" fill="freeze"/></circle>'
    )
    return (
        f'{point}<g transform="translate({cx:.1f} {cy:.1f})"><g>{grow}'
        f'<g transform="translate({-cx:.1f} {-cy:.1f})">{body}</g></g></g>'
    )


def mosaic(x, y, w, h, n, rng, gap=4, delay=None, step=0.12) -> str:
    """Treemap sencillo, como el de las constelaciones: la primera foto se lleva la celda mayor."""
    cells = [(x, y, w, h)]
    while len(cells) < n:
        cells.sort(key=lambda c: c[2] * c[3], reverse=True)
        cx, cy, cw, ch = cells.pop(0)
        r = rng.uniform(0.42, 0.62)
        if cw >= ch:
            a = cw * r
            cells += [(cx, cy, a - gap / 2, ch), (cx + a + gap / 2, cy, cw - a - gap / 2, ch)]
        else:
            a = ch * r
            cells += [(cx, cy, cw, a - gap / 2), (cx, cy + a + gap / 2, cw, ch - a - gap / 2)]
    cells.sort(key=lambda c: (c[1], c[0]))
    tones = rng.sample(range(len(PHOTO_TONES)), k=min(n, len(PHOTO_TONES)))
    return "".join(
        tile(*c, tones[i % len(tones)], None if delay is None else delay + i * step)
        for i, c in enumerate(cells)
    )


def starfield(w, h, n, seed, twinkle=True) -> str:
    rng = random.Random(seed)
    out = []
    for _ in range(n):
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        r = rng.choice([0.5, 0.6, 0.7, 0.9, 1.1, 1.4])
        o = rng.uniform(0.25, 0.85)
        star = f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{FG}" opacity="{o:.2f}"'
        if twinkle and rng.random() < 0.3:
            dur = rng.uniform(2.4, 5.5)
            star += (
                f'><animate attributeName="opacity" values="{o:.2f};{o * 0.2:.2f};{o:.2f}" '
                f'dur="{dur:.1f}s" begin="{rng.uniform(0, 4):.1f}s" repeatCount="indefinite"/></circle>'
            )
        else:
            star += "/>"
        out.append(star)
    return "".join(out)


def diamond(x, y, s=6, fill=ACCENT, hollow=False) -> str:
    pts = f"{x},{y - s} {x + s},{y} {x},{y + s} {x - s},{y}"
    if hollow:
        return f'<polygon points="{pts}" fill="{INK}" stroke="{ACCENT}" stroke-width="1.4"/>'
    return f'<polygon points="{pts}" fill="{fill}" filter="url(#glow)"/>'


def glow_filter() -> str:
    return (
        '<filter id="glow" x="-200%" y="-200%" width="500%" height="500%">'
        '<feGaussianBlur stdDeviation="3" result="b"/>'
        '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
    )


def svg(w: int, h: int, body: str, title: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
        f'role="img" aria-label="{title}"><title>{title}</title>'
        f"<style>{BODONI}{BODONI_I}{MONO}{UI}"
        ".d{font-family:Bodoni,Didot,'Times New Roman',serif}"
        ".m{font-family:Martian,ui-monospace,monospace;text-transform:uppercase;letter-spacing:.14em}"
        ".u{font-family:Figtree,'Segoe UI',sans-serif}"
        ".n{fill:none;stroke-width:1.2}"
        "@media (prefers-reduced-motion:reduce){animate,animateTransform,animateMotion{display:none}}"
        f"</style>{body}</svg>\n"
    )


def label(x, y, text, color=MUTE, size=11, anchor="start") -> str:
    return f'<text x="{x}" y="{y}" class="m" font-size="{size}" fill="{color}" text-anchor="{anchor}">{text}</text>'


# ---------- Cabecera: el cielo con tres constelaciones unidas por el hilo ----------
rng = random.Random(2004)
consts = [
    # x, y (esquina del mosaico), numeral, fotos, recuento
    (730, 96, "1998", 5, "212 fotos · 9 meses"),
    (900, 282, "2004", 6, "486 fotos · 12 meses"),
    (1068, 118, "2016", 4, "1.304 fotos · 11 meses"),
]
MW, MH = 150, 100
nodes = [(cx - 22, cy + MH / 2) for cx, cy, *_ in consts]
thread_d = (
    f"M690 {nodes[0][1] + 60} C700 {nodes[0][1] + 20} {nodes[0][0] - 20} {nodes[0][1]} {nodes[0][0]} {nodes[0][1]} "
    f"S{nodes[1][0] - 70} {nodes[1][1] + 30} {nodes[1][0]} {nodes[1][1]} "
    f"S{nodes[2][0] - 70} {nodes[2][1] - 10} {nodes[2][0]} {nodes[2][1]} "
    f"S1240 {nodes[2][1] + 150} 1290 {nodes[2][1] + 200}"
)

hero_consts = []
for i, (cx, cy, year, n, count) in enumerate(consts):
    d0 = 0.6 + i * 0.55
    hero_consts.append(
        f'<text x="{cx}" y="{cy - 14}" class="d n" font-size="54" font-weight="500" '
        f'stroke="{ACCENT}" stroke-opacity=".8">{year}</text>'
        + mosaic(cx, cy, MW, MH, n, rng, gap=3, delay=d0, step=0.1)
        + label(cx, cy + MH + 20, count, size=9.5)
        + diamond(*nodes[i])
    )

hero = f"""
<defs>
  {photo_defs()}{glow_filter()}
  <radialGradient id="neb" cx=".78" cy=".35" r=".6">
    <stop offset="0" stop-color="#1a2440" stop-opacity=".9"/>
    <stop offset="1" stop-color="{INK}" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="fade" x1="0" x2="1">
    <stop offset="0" stop-color="{ACCENT}" stop-opacity="0"/>
    <stop offset=".15" stop-color="{ACCENT}" stop-opacity=".5"/>
    <stop offset=".9" stop-color="{ACCENT}" stop-opacity=".5"/>
    <stop offset="1" stop-color="{ACCENT}" stop-opacity="0"/>
  </linearGradient>
  <clipPath id="frame"><rect width="1280" height="460" rx="28"/></clipPath>
</defs>
<g clip-path="url(#frame)">
  <rect width="1280" height="460" fill="{INK}"/>
  <rect width="1280" height="460" fill="url(#neb)"/>
  {starfield(1280, 460, 190, 7)}
  <path d="{thread_d}" fill="none" stroke="url(#fade)" stroke-width="1.2" pathLength="1"
    stroke-dasharray="1" stroke-dashoffset="0">
    <animate attributeName="stroke-dashoffset" values="1;1;0" keyTimes="0;.15;1" dur="2.8s"
      calcMode="spline" keySplines="0 0 1 1;.22 1 .36 1" fill="freeze"/>
  </path>
  {"".join(hero_consts)}
</g>

{diamond(88, 102, 5)}
{label(104, 106, "archivo fotográfico privado", ACCENT, 12)}
<text x="80" y="214" class="d" font-size="104" font-weight="500" fill="{FG}">Línea de</text>
<text x="80" y="306" class="d" font-size="104" font-style="italic" font-weight="400" fill="{ACCENT}">vida</text>
<text x="84" y="356" class="u" font-size="22" fill="{MUTE}">Tus fotos de Google Drive, ordenadas por fecha</text>
<text x="84" y="386" class="u" font-size="22" fill="{MUTE}">y convertidas en <tspan fill="{FG}">constelaciones</tspan>.</text>
"""
(OUT / "hero.svg").write_text(
    svg(1280, 460, hero, "Línea de vida: tus fotos de Google Drive convertidas en constelaciones"), "utf-8"
)


# ---------- Las tres profundidades ----------
rng = random.Random(14)
PW, PH, PY = 380, 340, 64
px = [30, 450, 870]


def panel(x, n, title) -> str:
    return (
        f'<rect x="{x}" y="{PY}" width="{PW}" height="{PH}" rx="22" fill="{INK2}" stroke="{LINE}"/>'
        + label(x + 24, PY - 22, f"{n} · {title}", ACCENT, 12)
    )


# Panel 1: años
p1 = [panel(px[0], 1, "años")]
yrs = [("1998", 4), ("2004", 5), ("2016", 3)]
p1_nodes = []
for i, (yr, n) in enumerate(yrs):
    yy = PY + 30 + i * 102
    xx = px[0] + 120 + (i % 2) * 70
    p1.append(
        f'<text x="{xx - 2}" y="{yy + 18}" class="d n" font-size="30" stroke="{ACCENT}" stroke-opacity=".75">{yr}</text>'
    )
    p1.append(mosaic(xx, yy + 28, 118, 54, n, rng, gap=3))
    p1_nodes.append((xx - 22, yy + 55))
p1.append(
    f'<path d="M{px[0] + 60} {PY + 10} C{px[0] + 90} {PY + 40} {p1_nodes[0][0] - 20} {p1_nodes[0][1] - 20} {p1_nodes[0][0]} {p1_nodes[0][1]} '
    f"S{p1_nodes[1][0] - 30} {p1_nodes[1][1] - 40} {p1_nodes[1][0]} {p1_nodes[1][1]} "
    f'S{p1_nodes[2][0] - 10} {p1_nodes[2][1] - 50} {p1_nodes[2][0]} {p1_nodes[2][1]}" '
    f'fill="none" stroke="{ACCENT}" stroke-opacity=".4"/>'
)
p1 += [diamond(*nd, 5) for nd in p1_nodes]
# El año elegido, resaltado.
p1.append(
    f'<rect x="{p1_nodes[1][0] + 14}" y="{p1_nodes[1][1] - 60}" width="140" height="96" rx="8" '
    f'fill="none" stroke="{ACCENT}" stroke-opacity=".7" stroke-dasharray="3 4"/>'
)

# Panel 2: un año, sus meses y «Sin mes»
x2 = px[1]
p2 = [panel(x2, 2, "año 2004")]
p2.append(f'<text x="{x2 + 24}" y="{PY + 78}" class="d n" font-size="64" stroke="{ACCENT}">2004</text>')
months = [("Marzo", 3, 0), ("Agosto", 5, 1), ("Sin mes", 2, 2)]
for i, (name, n, k) in enumerate(months):
    mx = x2 + 24 + i * 118
    my = PY + 130
    p2.append(f'<text x="{mx}" y="{my}" class="d" font-size="20" fill="{FG}">{name}</text>')
    p2.append(mosaic(mx, my + 14, 104, 110, n, rng, gap=3))
    p2.append(diamond(mx + 52, my + 152, 5, hollow=(name == "Sin mes")))
    if name == "Agosto":
        p2.append(
            f'<rect x="{mx - 7}" y="{my - 24}" width="118" height="148" rx="8" fill="none" '
            f'stroke="{ACCENT}" stroke-opacity=".7" stroke-dasharray="3 4"/>'
        )
p2.append(
    f'<line x1="{x2 + 24}" x2="{x2 + PW - 24}" y1="{PY + 282}" y2="{PY + 282}" stroke="{ACCENT}" stroke-opacity=".35"/>'
)
p2.append(label(x2 + 24, PY + 312, "«Sin mes»: solo se sabe el año", size=9.5))

# Panel 3: un mes, por días, con «Día sin concretar»
x3 = px[2]
p3 = [panel(x3, 3, "agosto 2004")]
p3.append(f'<text x="{x3 + 24}" y="{PY + 56}" class="d" font-size="36" fill="{FG}">Agosto <tspan font-style="italic" fill="{ACCENT}">2004</tspan></text>')


def masonry(x, y, w, cols, heights, tones, gap=4) -> str:
    cw = (w - gap * (cols - 1)) / cols
    lanes = [y] * cols
    out = []
    for h, t in zip(heights, tones):
        i = lanes.index(min(lanes))
        out.append(tile(x + i * (cw + gap), lanes[i], cw, h, t))
        lanes[i] += h + gap
    return "".join(out)


p3.append(label(x3 + 24, PY + 92, "14 ago · sábado", size=9.5))
p3.append(masonry(x3 + 24, PY + 104, PW - 48, 4, [62, 44, 70, 50, 40, 58, 36, 44], [0, 1, 3, 6, 2, 4, 7, 5]))
p3.append(label(x3 + 24, PY + 252, "día sin concretar", size=9.5))
p3.append(masonry(x3 + 24, PY + 264, PW - 48, 4, [52, 40, 56, 46], [5, 7, 1, 3]))

# Flechas de zoom entre paneles
arrows = []
for ax in (px[0] + PW + 20, px[1] + PW + 20):
    arrows.append(
        f'<g transform="translate({ax} {PY + PH / 2})">'
        f'<circle r="0" fill="none" stroke="{ACCENT}" stroke-opacity=".5"/>'
        f'<path d="M-6 -9 L4 0 L-6 9" fill="none" stroke="{ACCENT}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
        f"</g>"
    )

depths = f"""
<defs>
  {photo_defs()}{glow_filter()}
  <linearGradient id="bottomfade" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="{INK2}" stop-opacity="0"/><stop offset="1" stop-color="{INK2}"/>
  </linearGradient>
</defs>
<rect width="1280" height="470" rx="28" fill="{INK}"/>
{starfield(1280, 470, 70, 3, twinkle=False)}
{"".join(p1)}{"".join(p2)}{"".join(p3)}{"".join(arrows)}
<text x="640" y="445" text-anchor="middle" class="u" font-size="17" fill="{MUTE}">entrar es hacer zoom en una constelación; subir te devuelve al grupo del que venías.</text>
"""
(OUT / "profundidades.svg").write_text(
    svg(1280, 470, depths, "Las tres profundidades del cielo: años, meses y fotos"), "utf-8"
)


# ---------- Las fechas: de dónde salen y con qué precisión ----------
layers = [
    ("exif", "DateTimeOriginal de la cámara"),
    ("drive", "metadatos de imagen de Drive"),
    ("takeout", "photoTakenTime del JSON adyacente"),
    ("nombre", "IMG-20040814-WA0003.jpg"),
    ("carpeta", "Fotos/Verano 2004/"),
]
left = [label(60, 70, "de dónde sale la fecha", ACCENT, 12)]
for i, (k, v) in enumerate(layers):
    y = 96 + i * 50
    left.append(f'<rect x="60" y="{y}" width="540" height="40" rx="10" fill="{INK2}" stroke="{LINE}"/>')
    left.append(f'<text x="82" y="{y + 25.5}" class="d" font-size="18" fill="{ACCENT}">{i + 1}</text>')
    left.append(label(108, y + 25, k, FG, 11))
    left.append(f'<text x="214" y="{y + 25.5}" class="u" font-size="16" fill="{MUTE}">{v}</text>')
    if i < len(layers) - 1:
        left.append(f'<line x1="86" x2="86" y1="{y + 40}" y2="{y + 50}" stroke="{ACCENT}" stroke-opacity=".4"/>')
y = 96 + len(layers) * 50 + 8
left.append(
    f'<rect x="60" y="{y}" width="540" height="44" rx="10" fill="none" stroke="{ACCENT}" stroke-opacity=".8"/>'
)
left.append(diamond(86, y + 22, 5))
left.append(label(108, y + 27, "a mano", ACCENT, 11))
left.append(f'<text x="214" y="{y + 27.5}" class="u" font-size="16" fill="{FG}">tu corrección siempre gana, y se puede deshacer</text>')

rows = [
    ("day", "14 de agosto de 2004", "en su día exacto"),
    ("month", "Agosto 2004", "«Día sin concretar»"),
    ("year", "2004", "«Sin mes»"),
    ("unknown", "Sin fecha", "espera en Ordenar"),
]
right = [label(680, 70, "con la precisión que de verdad tiene", ACCENT, 12)]
for i, (p, date, where) in enumerate(rows):
    y = 96 + i * 66
    right.append(f'<rect x="680" y="{y}" width="540" height="54" rx="12" fill="{INK2}" stroke="{LINE}"/>')
    right.append(f'<rect x="698" y="{y + 15}" width="{len(p) * 10.5 + 22}" height="24" rx="12" fill="none" stroke="{ACCENT}" stroke-opacity=".55"/>')
    right.append(label(709, y + 31.5, p, ACCENT, 10))
    right.append(f'<text x="830" y="{y + 35}" class="d" font-size="23" fill="{FG}">{date}</text>')
    right.append(f'<text x="1200" y="{y + 33}" text-anchor="end" class="u" font-size="15" fill="{MUTE}">{where}</text>')
y = 96 + len(rows) * 66 + 8
right.append(f'<text x="680" y="{y + 26}" class="d" font-size="21" font-style="italic" fill="{MUTE}">1 de enero de 2004</text>')
right.append(f'<line x1="678" x2="852" y1="{y + 19}" y2="{y + 19}" stroke="#e58a8a" stroke-width="1.6"/>')
right.append(f'<text x="870" y="{y + 26}" class="u" font-size="16" fill="{FG}">nunca se inventa la parte que falta.</text>')

dates = f"""
<defs>{glow_filter()}</defs>
<rect width="1280" height="470" rx="28" fill="{INK}"/>
{starfield(1280, 470, 60, 11, twinkle=False)}
{"".join(left)}{"".join(right)}
<line x1="640" x2="640" y1="70" y2="420" stroke="{ACCENT}" stroke-opacity=".15"/>
"""
(OUT / "fechas.svg").write_text(svg(1280, 470, dates, "Cómo se detectan las fechas y con qué precisión"), "utf-8")

for f in sorted(OUT.glob("*.svg")):
    print(f.name, f.stat().st_size)
