"""Pure helpers for the market analysis: surface from free text, partial-ownership detection,
market segments and the hexagonal zone grid. No I/O; unit-tested in tests/test_valuation.py."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

# ------------------------------------------------------------------ Italian numbers


def parse_it_number(raw: str) -> float | None:
    """'1.307' -> 1307, '174,85' -> 174.85, '1.754,00' -> 1754, '627.40' -> 627.4."""
    s = raw.strip().rstrip(".,")
    if not s:
        return None
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"\d{1,3}(\.\d{3})+", s):
        s = s.replace(".", "")
    try:
        return float(s)
    except ValueError:
        return None


# ------------------------------------------------------------------ surface from text

_NUM = r"(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)"
_UNIT = r"(?:mq|m2|m²|metri\s+quadr[ia]ti|metri\s+quadri)"
_SURFACE = re.compile(
    rf"(?:{_UNIT}\.?\s*(?:lordi\s+complessivi\s+)?{_NUM})|(?:{_NUM}\s*{_UNIT}\b)",
    re.IGNORECASE,
)

_POSITIVE = [
    (r"superficie\s+commerciale", 6),
    (r"commerciale", 4),
    (r"complessiv|totale|in tutto", 3),
    (r"lord[ao]", 2),
    (r"superficie|sup\.|estes[ao]|di circa|sviluppa", 2),
    (r"catastale", 1),
]
_NEGATIVE = [
    (r"altezza", -8),
    (r"abusiv|da demolire", -6),
    (r"cortil|scopert|giardin|corte\b|area urbana|pertinenz|balcon|terrazz|portic|soppalc|ripostigl", -4),
    (r"fondo rustico|terren|seminativ|agricol|bosc|vigneto|uliveto", -4),
    (r"garage|autorimess|box|posto auto|cantin", -2),
    (r"utile|calpestabile|netta", -1),
]


@dataclass
class SurfaceGuess:
    mq: float
    score: int


def extract_surface(text: str | None, land: bool = False) -> float | None:
    """Best guess of the lot's main surface in m² from a PVP description.

    Every "<n> mq" / "mq <n>" is scored by the words just before it: "superficie commerciale" wins,
    accessory areas (cortile, balcone, terreno...) lose. For land lots (`land=True`) the land words
    are not penalised. Returns None when nothing plausible is found."""
    if not text:
        return None
    best: SurfaceGuess | None = None
    for m in _SURFACE.finditer(text):
        raw = m.group(1) or m.group(2)
        val = parse_it_number(raw) if raw else None
        if val is None or val < 5 or val > 500_000:
            continue
        ctx = text[max(0, m.start() - 70) : m.start()].lower()
        # only the clause the number belongs to
        ctx = re.split(r"[;:]|\.\s|\n|\)\s*,|- [a-z]\)", ctx)[-1]
        score = 0
        for pat, w in _POSITIVE:
            if re.search(pat, ctx):
                score += w
        for pat, w in _NEGATIVE:
            if land and w == -4 and re.search(r"terren|seminativ|agricol|fondo rustico", pat):
                continue
            if re.search(pat, ctx):
                score += w
        if best is None or score > best.score or (score == best.score and val > best.mq and score > 0):
            best = SurfaceGuess(val, score)
    if best is None or best.score < -2:
        return None
    return round(best.mq, 2)


# ------------------------------------------------------------------ partial ownership

_FRACTION = re.compile(r"(?:quota\s+(?:di|pari\s+a|del(?:la)?|indivisa\s+di)?\s*)(\d{1,4})\s*/\s*(\d{1,4})", re.I)
_FRACTION_OF_PROP = re.compile(
    r"\b(\d{1,4})\s*/\s*(\d{1,4})\s+(?:di|della|dell')\s*(?:piena\s+|intera\s+)?propriet", re.I
)
_RIGHTS = re.compile(r"nuda\s+propriet|usufrutto|diritto\s+di\s+(?:superficie|abitazione|uso)", re.I)


def is_partial_ownership(text: str | None) -> bool:
    """True when the lot sells a share (1/2, 1/3...) or a limited right (nuda proprietà,
    usufrutto, diritto di superficie): its price per m² is not comparable."""
    if not text:
        return False
    if _RIGHTS.search(text):
        return True
    for rx in (_FRACTION, _FRACTION_OF_PROP):
        for m in rx.finditer(text):
            a, b = int(m.group(1)), int(m.group(2))
            if b and 0 < a < b:
                return True
    return False


# ------------------------------------------------------------------ segments

SEGMENTS = {
    "residenziale": "Residenziale",
    "commerciale": "Commerciale",
    "industriale": "Industriale",
    "box": "Box e posti auto",
    "terreni": "Terreni",
}

_BOX = {"GARAGE_AUTORIMESSA", "POSTO_AUTO", "CANTINA", "STALLE_SCUDERIE_RIMESSE", "TETTOIE_CHIUSE_APERTE"}
_LAND = {"TERRENO", "LOTTO_EDIFICABILE", "POZZO"}
_INDUSTRIAL = {"FABBRICATI_COSTRUITI_PER_ESIGENZE_IND", "OPIFICI", "OPIFICIO_INDUSTRIALE"}


def segment_of(category: str | None, subtype: str | None) -> str | None:
    if subtype in _BOX:
        return "box"
    if subtype in _LAND:
        return "terreni"
    if subtype in _INDUSTRIAL or category == "IMMOBILE_INDUSTRIALE":
        return "industriale"
    if category == "IMMOBILE_RESIDENZIALE":
        return "residenziale"
    if category == "IMMOBILE_COMMERCIALE":
        return "commerciale"
    return None


# Plausible ranges per segment: (min m², max m², min €/m², max €/m²). Outside = not an observation.
PLAUSIBLE: dict[str, tuple[float, float, float, float]] = {
    "residenziale": (20, 1500, 80, 15000),
    "commerciale": (15, 6000, 50, 12000),
    "industriale": (50, 60000, 15, 3000),
    "box": (8, 120, 40, 6000),
    "terreni": (100, 500000, 0.3, 600),
}


def plausible(segment: str | None, mq: float | None, eur_mq: float | None) -> bool:
    if segment not in PLAUSIBLE or not mq or not eur_mq:
        return False
    lo_m, hi_m, lo_p, hi_p = PLAUSIBLE[segment]
    return lo_m <= mq <= hi_m and lo_p <= eur_mq <= hi_p


# ------------------------------------------------------------------ hex grid

_R = 6378137.0
_REF_LAT = 43.0  # keep the grid uniform across Italy: hex size is true metres at ~43°N


def _merc(lon: float, lat: float) -> tuple[float, float]:
    x = _R * math.radians(lon)
    y = _R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    return x, y


def _unmerc(x: float, y: float) -> tuple[float, float]:
    lon = math.degrees(x / _R)
    lat = math.degrees(2 * math.atan(math.exp(y / _R)) - math.pi / 2)
    return lon, lat


def _size(size_m: float) -> float:
    return size_m / math.cos(math.radians(_REF_LAT))


def hex_key(lon: float, lat: float, size_m: float) -> str:
    """Pointy-top axial hex containing the point; `size_m` is centre-to-corner in metres."""
    x, y = _merc(lon, lat)
    s = _size(size_m)
    q = (math.sqrt(3) / 3 * x - y / 3) / s
    r = (2 / 3 * y) / s
    # cube rounding
    cx, cz = q, r
    cy = -cx - cz
    rx, ry, rz = round(cx), round(cy), round(cz)
    dx, dy, dz = abs(rx - cx), abs(ry - cy), abs(rz - cz)
    if dx > dy and dx > dz:
        rx = -ry - rz
    elif dy > dz:
        ry = -rx - rz
    else:
        rz = -rx - ry
    return f"{int(rx)}:{int(rz)}"


def hex_center(key: str, size_m: float) -> tuple[float, float]:
    q, r = (int(v) for v in key.split(":"))
    s = _size(size_m)
    x = s * (math.sqrt(3) * q + math.sqrt(3) / 2 * r)
    y = s * 1.5 * r
    return _unmerc(x, y)


def hex_polygon(key: str, size_m: float) -> list[list[float]]:
    q, r = (int(v) for v in key.split(":"))
    s = _size(size_m)
    cx = s * (math.sqrt(3) * q + math.sqrt(3) / 2 * r)
    cy = s * 1.5 * r
    ring = []
    for i in range(6):
        a = math.radians(60 * i - 30)
        lon, lat = _unmerc(cx + s * math.cos(a), cy + s * math.sin(a))
        ring.append([round(lon, 6), round(lat, 6)])
    ring.append(ring[0])
    return ring


# ------------------------------------------------------------------ statistics


def quantile(sorted_vals: list[float], q: float) -> float:
    """Linear-interpolated quantile of an already sorted list."""
    if not sorted_vals:
        raise ValueError("empty")
    pos = (len(sorted_vals) - 1) * q
    lo = math.floor(pos)
    hi = math.ceil(pos)
    if lo == hi:
        return sorted_vals[lo]
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)
