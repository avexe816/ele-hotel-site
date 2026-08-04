#!/usr/bin/env python3
"""Static site generator for ELE HOTEL.

Single-source authoring (v1.5): every string in data/*.json is Japanese.
Other languages are resolved at build time from the translation memory in
data/i18n.json, then the rest of this generator works exactly as before on the
fully-populated per-language trees.
"""

import hashlib
import json
import os
import sys
from html import escape as esc

from amenity_icons import icon_for

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
sys.path.insert(0, os.path.join(ROOT, "tools"))
from i18n import Resolver  # noqa: E402


def _load(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as f:
        return json.load(f)


SITE = _load("site.json")
HOTELS_JA = _load("hotels.json")
GRAND = _load("grand.json")

LANGS = [l for l in SITE["langs"] if l.get("enabled", True)]
LANG_CODES = [l["code"] for l in LANGS]
LANG_KEYS = {"ja", "zh", "zh-Hant", "en", "ko", "th"}

R = Resolver()

# ---- build the per-language trees the page templates expect
for _c in LANG_CODES:
    if _c != "ja":
        SITE[_c] = R.tree(SITE["ja"], _c, "site")
        GRAND[_c] = R.tree(GRAND["ja"], _c, "grand")


def _expand(node, path):
    """Turn {"ja": X} translation slots into {ja: X, zh: .., en: ..} for all languages."""
    if isinstance(node, dict):
        keys = set(node.keys())
        if keys and keys <= LANG_KEYS and "ja" in keys:
            return {c: R.tree(node["ja"], c, path) for c in LANG_CODES}
        return {k: _expand(v, f"{path}.{k}") for k, v in node.items()}
    if isinstance(node, list):
        return [_expand(v, f"{path}[{i}]") for i, v in enumerate(node)]
    return node


HOTELS = [_expand(h, f"hotels[{i}]") for i, h in enumerate(HOTELS_JA)]

# ----------------------------------------------------------------- icons
MARK_COLOR = SITE.get("mark_color", "#e2674c")

# Registered ELE trademark, vectorised from the brand sheet. Shape is fixed —
# only the colour (currentColor) may change per brand line.
MARK_PATH = (
    "M45.3 98.9C42.5 98.5 41 98.3 40.7 98.1C40.4 98 40.4 96.8 40.4 77.7L40.4 57.4L37.8 57.4C35.1 57.4 35.1 57.4 34.8 "
    "58.2C33.2 62.3 27.2 62.2 25.5 58.1C25.2 57.4 25.2 57.4 22 57.4L18.9 57.4L18.9 63.7C18.9 71.6 19.1 72.6 21.4 "
    "75.6C24 79.1 27 80.3 33.3 80.5L37.2 80.6L37.3 88.9C37.3 95.8 37.3 97.2 37 97.3C36.5 97.5 31.1 95.5 27.9 "
    "93.9C13.8 87 3.5 73.8 0.8 58.9C0.7 58.3 0.5 57.1 0.4 56.3C0 54.3 0 44.9 0.4 42.8C3.9 22.7 16.6 8 35.4 2.3C38.5 "
    "1.3 46.1 -0 46.4 0.3C46.4 0.3 46.5 13.8 46.5 17.9C46.5 18.6 46.5 18.6 37.8 18.7C28.2 18.8 28.2 18.8 25.5 "
    "20.2C20.3 22.7 18.9 26.1 18.9 35.3L18.9 41.6L50.1 41.5L81.2 41.5L81.3 36C81.4 27.8 80.8 25.6 77.6 22.4C74.1 19 "
    "72.7 18.7 59.6 18.7L49.7 18.7L49.7 9.5C49.7 0.3 49.7 0.3 50.2 0.2C53.1 -0.4 64.2 1.7 68.5 3.6C68.8 3.7 69.8 4.1 "
    "70.6 4.5C71.4 4.8 73 5.6 74.1 6.2C109 25.6 108.6 74.7 73.3 93.4C68.7 95.9 59.5 98.8 59 98C58.9 97.8 58.8 94.2 "
    "58.9 89.1L58.9 80.6L64.8 80.5C71 80.4 71.5 80.3 73.6 79.4C79.5 77 81.3 73.2 81.3 63L81.3 57.4L76.3 57.4C71.2 "
    "57.4 71.2 57.4 71.1 57.9C70.1 62.1 63.2 62.3 61.6 58.1C61.4 57.4 61.4 57.4 58.7 57.4L56.1 57.4L55.9 71.7C55.8 "
    "79.6 55.8 88.9 55.8 92.4C55.8 98.7 55.8 98.7 54.7 98.9C53.6 99 46.5 99 45.3 98.9Z"
)
LOGO = (
    '<svg viewBox="0 0 100 98.99" aria-hidden="true" class="mark">'
    f'<path fill="currentColor" fill-rule="evenodd" d="{MARK_PATH}"/></svg>'
)

I_CHECK = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 8.5l3.5 3.5 7.5-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
I_INFO = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.75" stroke="currentColor" stroke-width="1.5"/><path d="M8 7.25v4M8 4.9v.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'
I_ARROW = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h9M8.5 4.5L12 8l-3.5 3.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
I_EXT = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3H3.5v9.5H13V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M9 3h4v4M13 3L7.5 8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
I_BED = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 12V5M2 12h12V9c0-1.1-.9-2-2-2H2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="5" cy="6.5" r="1.4" stroke="currentColor" stroke-width="1.3"/></svg>'
I_PIN = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 14s4.5-4.2 4.5-7.5A4.5 4.5 0 003.5 6.5C3.5 9.8 8 14 8 14z" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="6.4" r="1.5" stroke="currentColor" stroke-width="1.3"/></svg>'
I_TEL = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 2.5h2.3l1.1 2.8-1.5 1.1a7.5 7.5 0 003.7 3.7l1.1-1.5 2.8 1.1V12c0 .8-.7 1.5-1.5 1.5C6.4 13.5 2.5 9.6 2.5 4A1.5 1.5 0 013 2.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>'
I_SUN = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="3.2" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.5v1.4M8 13.1v1.4M1.5 8h1.4M13.1 8h1.4M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'
I_CAM = '<svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11.5h4.5L10.5 8h11l2 3.5H28v14H4z"/><circle cx="16" cy="18" r="5"/></svg>'
I_GLOBE = '<svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="6.9" stroke="currentColor" stroke-width="1.5"/><path d="M2.1 9h13.8M9 2.1c1.9 2 2.9 4.4 2.9 6.9S10.9 15.9 9 15.9 6.1 11.5 6.1 9 7.1 4.1 9 2.1z" stroke="currentColor" stroke-width="1.4"/></svg>'
I_CHEV = '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true" class="chev"><path d="M3 4.8L6 7.8l3-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
I_TICK = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" class="tick"><path d="M2.5 8.5l3.5 3.5 7.5-8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
I_MENU = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M2.5 5h13M2.5 9h13M2.5 13h13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'

CITY_LABEL = {"tokyo": "Tokyo", "nagoya": "Nagoya", "osaka": "Osaka", "sendai": "Sendai", "onsen": "Kusatsu"}

AREA_KEY = {
    "tokyo": "filter_tokyo",
    "nagoya": "filter_nagoya",
    "osaka": "filter_osaka",
    "sendai": "filter_sendai",
    "onsen": "filter_onsen",
}
AREA_ORDER = ["tokyo", "nagoya", "osaka", "sendai", "onsen"]


def base(depth):
    return "../" * depth


def home_url(lang, depth):
    d = lang["dir"]
    return base(depth) + (d + "/index.html" if d else "index.html")


def hotel_url(lang, slug, depth):
    d = lang["dir"]
    p = (d + "/" if d else "") + "hotels/" + slug + ".html"
    return base(depth) + p


def grand_url(lang, depth):
    d = lang["dir"]
    return base(depth) + ((d + "/") if d else "") + "grand.html"


def privacy_url(lang, depth):
    d = lang["dir"]
    return base(depth) + ((d + "/") if d else "") + "privacy.html"


def contact_url(lang, depth):
    d = lang["dir"]
    return base(depth) + ((d + "/") if d else "") + "contact.html"


CSS_V = hashlib.md5(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "style.css"), "rb").read()).hexdigest()[:10]


CJK_FONT = {
    "zh": "Noto+Sans+SC:wght@400;500;700",
    "zh-Hant": "Noto+Sans+TC:wght@400;500;700",
    "ko": "Noto+Sans+KR:wght@400;500;700",
    "th": "Noto+Sans+Thai:wght@400;500;700",
}


def fonts_link(code):
    fam = ["Outfit:wght@400;500;600;700"]
    fam.append(CJK_FONT.get(code, "Noto+Sans+JP:wght@400;500;700"))
    q = "&".join("family=" + f for f in fam)
    return (
        '<link rel="preconnect" href="https://fonts.googleapis.com">'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
        f'<link rel="stylesheet" href="https://fonts.googleapis.com/css2?{q}&display=swap">'
    )


def pic(name, alt, sizes, cls="", loading="lazy", depth=0):
    b = base(depth) + "assets/img/"
    return (
        f'<picture><source media="(max-width: 700px)" srcset="{b}{name}-sm.webp" type="image/webp">'
        f'<img src="{b}{name}.webp" alt="{esc(alt)}" loading="{loading}" decoding="async" sizes="{sizes}"'
        f'{" class=" + chr(34) + cls + chr(34) if cls else ""}></picture>'
    )


def header(lang, t, depth, page_slug=None, kind="hotel"):
    nav = t["nav"]
    hu = home_url(lang, depth)
    items = [
        (hu + "#hotels", nav["hotels"]),
        (hu + "#brand", nav["brand"]),
        (hu + "#rooms", nav["rooms"]),
        (hu + "#news", nav["news"]),
        (hu + "#faq", nav["faq"]),
        (contact_url(lang, depth), nav["contact"]),
    ]
    links = "".join(f'<a href="{u}">{esc(x)}</a>' for u, x in items)

    # ---- globe + dropdown language picker
    opts = ""
    for l in LANGS:
        if kind == "grand":
            url = grand_url(l, depth)
        else:
            url = hotel_url(l, page_slug, depth) if page_slug else home_url(l, depth)
        cur = l["code"] == lang["code"]
        opts += (
            f'<a role="menuitem" href="{url}" hreflang="{l["html"]}" lang="{l["html"]}"'
            f'{" aria-current="+chr(34)+"true"+chr(34) if cur else ""}>'
            f'<span>{esc(l["label"])}</span>{I_TICK if cur else ""}</a>'
        )
    langs = (
        '<div class="langpick">'
        '<button class="langpick__btn" id="langbtn" type="button" aria-haspopup="true"'
        f' aria-expanded="false" aria-controls="langmenu" aria-label="{esc(t["lang_label"])}">'
        f'{I_GLOBE}<span class="langpick__cur">{esc(lang["short"])}</span>{I_CHEV}</button>'
        f'<div class="langpick__menu" id="langmenu" role="menu" aria-labelledby="langbtn" hidden>'
        f'<p class="langpick__head">{esc(t["lang_label"])}</p>{opts}</div>'
        "</div>"
    )
    return f"""<header class="header" id="top">
<div class="wrap header__inner">
<a class="logo" href="{hu}" aria-label="ELE HOTEL">{LOGO}<span class="logo__text">ELE HOTEL<span class="logo__sub">ECO · LIVELY · EASY</span></span></a>
<nav class="nav" id="nav" aria-label="{esc(t['nav']['hotels'])}">{links}</nav>
<div class="header__tools">
{langs}
<button class="icon-btn" id="theme-toggle" type="button" aria-label="Toggle colour theme">{I_SUN}</button>
<button class="icon-btn burger" id="burger" type="button" aria-label="Menu" aria-expanded="false" aria-controls="nav">{I_MENU}</button>
</div>
</div>
</header>"""


CITIES = " · ".join(CITY_LABEL[a] for a in AREA_ORDER if any(h["area"] == a for h in HOTELS))


def footer(lang, t, depth):
    hu = home_url(lang, depth)
    hotels = "".join(
        f'<li><a href="{hotel_url(lang, h["slug"], depth)}">{esc(h["name"][lang["code"]])}</a></li>' for h in HOTELS
    )
    info = "".join(
        f'<li><a href="{hu}#{a}">{esc(t["nav"][k])}</a></li>'
        for a, k in [("brand", "brand"), ("rooms", "rooms"), ("news", "news"), ("faq", "faq")]
    )
    info += f'<li><a href="{contact_url(lang, depth)}">{esc(t["nav"]["contact"])}</a></li>'
    info += f'<li><a href="{privacy_url(lang, depth)}">{esc(t["privacy"]["nav"])}</a></li>'
    return f"""<footer class="footer">
<div class="wrap">
<div class="footer__grid">
<div>
<a class="logo" href="{hu}" aria-label="ELE HOTEL">{LOGO}<span class="logo__text">ELE HOTEL<span class="logo__sub">ECO · LIVELY · EASY</span></span></a>
<p class="footer__note">{esc(t['footer_note'])}</p>
</div>
<div><h4>{esc(t['footer_hotels'])}</h4><ul role="list">{hotels}</ul></div>
<div><h4>{esc(t['footer_info'])}</h4><ul role="list">{info}</ul>
<p class="footer__note"><a href="https://tej.jp" target="_blank" rel="noopener">{esc(t['operator_link'])}{I_EXT}</a></p></div>
</div>
<div class="footer__bottom"><span>© 2019–2026 {esc(t['rights'])}</span><span>{CITIES}</span></div>
</div>
</footer>"""


JS = """<script>
(function(){
 var f=document.querySelector('form.bkform');
 if(f){var d=f.querySelector('.bk-date');
  var z=new Date();z.setMinutes(z.getMinutes()-z.getTimezoneOffset());
  var s=z.toISOString().slice(0,10);d.min=s;if(!d.value){d.value=s;}
  f.addEventListener('submit',function(){var v=(d.value||s).split('-');
   f.obj_year.value=v[0];f.obj_month.value=v[1];f.obj_day.value=v[2];});}
})();
(function(){
 var K='eletheme';
 function read(){var m=document.cookie.match(/(?:^|; )eletheme=(light|dark)/);return m?m[1]:null;}
 function save(v){document.cookie=K+'='+v+';path=/;max-age=31536000;samesite=lax';}
 var t=read()||(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
 document.documentElement.setAttribute('data-theme',t);
 document.addEventListener('DOMContentLoaded',function(){
  var btn=document.getElementById('theme-toggle');
  if(btn)btn.addEventListener('click',function(){
   var n=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';
   document.documentElement.setAttribute('data-theme',n);save(n);
  });
  var lb=document.getElementById('langbtn'),lm=document.getElementById('langmenu');
  if(lb&&lm){
   var setOpen=function(v){lm.hidden=!v;lb.setAttribute('aria-expanded',String(v));
    lb.classList.toggle('is-open',v);};
   lb.addEventListener('click',function(e){e.stopPropagation();setOpen(lm.hidden);});
   document.addEventListener('click',function(e){
    if(!lm.hidden&&!lm.contains(e.target)&&e.target!==lb)setOpen(false);});
   document.addEventListener('keydown',function(e){
    if(e.key==='Escape'&&!lm.hidden){setOpen(false);lb.focus();}});
  }
  var b=document.getElementById('burger'),nav=document.getElementById('nav');
  if(b&&nav)b.addEventListener('click',function(){
   var open=nav.getAttribute('data-open')==='true';
   nav.setAttribute('data-open',String(!open));b.setAttribute('aria-expanded',String(!open));
  });
  var h=document.querySelector('.header');
  var onScroll=function(){h.classList.toggle('header--scrolled',window.scrollY>8);};
  onScroll();window.addEventListener('scroll',onScroll,{passive:true});
  var chips=document.querySelectorAll('.chip[data-filter]');
  var cards=document.querySelectorAll('[data-area]');
  chips.forEach(function(c){c.addEventListener('click',function(){
   chips.forEach(function(x){x.setAttribute('aria-pressed','false');});
   c.setAttribute('aria-pressed','true');
   var f=c.getAttribute('data-filter');
   cards.forEach(function(card){
    card.style.display=(f==='all'||card.getAttribute('data-area')===f)?'':'none';
   });
  });});
  if('IntersectionObserver' in window){
   var io=new IntersectionObserver(function(es){es.forEach(function(e){
    if(e.isIntersecting){e.target.classList.add('is-in');io.unobserve(e.target);}
   });},{threshold:0.08,rootMargin:'0px 0px -40px 0px'});
   document.querySelectorAll('.reveal').forEach(function(el){io.observe(el);});
  }else{document.querySelectorAll('.reveal').forEach(function(el){el.classList.add('is-in');});}
 });
})();
</script>"""


def page(lang, t, depth, title, desc, body, page_slug=None, kind="hotel"):
    code = lang["code"]
    b = base(depth)
    alts = ""
    for l in LANGS:
        if kind == "grand":
            url = grand_url(l, depth)
        elif kind == "privacy":
            url = privacy_url(l, depth)
        elif kind == "contact":
            url = contact_url(l, depth)
        else:
            url = hotel_url(l, page_slug, depth) if page_slug else home_url(l, depth)
        alts += f'<link rel="alternate" hreflang="{l["html"]}" href="{url}">'
    return f"""<!DOCTYPE html>
<html lang="{lang['html']}" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}">
<meta property="og:type" content="website">
<link rel="icon" href="{b}assets/favicon.svg" type="image/svg+xml">
{alts}
{fonts_link(code)}
<link rel="stylesheet" href="{b}assets/style.css?v={CSS_V}">
</head>
<body>
{header(lang, t, depth, page_slug, kind)}
<main id="main">
{body}
</main>
{footer(lang, t, depth)}
{JS}
</body>
</html>
"""


# ----------------------------------------------------------------- homepage
def build_home(lang):
    code = lang["code"]
    t = SITE[code]
    depth = 0 if not lang["dir"] else 1
    b = base(depth)

    areas = [a for a in AREA_ORDER if any(h["area"] == a for h in HOTELS)]
    opts = f'<option value="">{esc(t["search_area_any"])}</option>' + "".join(
        f'<option value="{a}">{esc(t[AREA_KEY[a]])}</option>' for a in areas
    )
    guests = "".join(f'<option>{n} {esc(t["search_guest_unit"])}</option>' for n in (1, 2, 3, 4))

    cards = ""
    for h in HOTELS:
        cards += f"""<a class="hcard reveal" data-area="{h['area']}" data-brand="{h['brand']}" href="{hotel_url(lang, h['slug'], depth)}">
<div class="hcard__media"><span class="badge">{esc(t[AREA_KEY[h['area']]])}</span>{'<span class="badge badge--soon">' + esc(t["hotel_soon"]) + '</span>' if h.get("status") == "soon" else ''}
{pic(h['img'], h['name'][code], '(max-width: 700px) 100vw, 380px', depth=depth)}</div>
<div class="hcard__body">
<h3>{esc(h['name'][code])}</h3>
<p class="hcard__tag">{esc(h['tagline'][code])}</p>
<div class="hcard__meta">
<span>{I_BED}{(str(h['rooms']) + ' ' + esc(t['unit_rooms'])) if h.get('rooms') else esc(t['tbd'])}</span>
<span>{I_PIN}{esc(h['address'][code].split(' ')[-1] if code != 'en' else h['address'][code])}</span>
</div>
<span class="hcard__more">{esc(t['cta_detail'])}{I_ARROW}</span>
</div></a>"""

    values = "".join(
        f'<div class="value reveal"><div class="value__k">{esc(v["k"])}</div><p>{esc(v["d"])}</p></div>'
        for v in t["values"]
    )

    blines = ""
    for bd in t["brands"]:
        soon = f'<span class="badge badge--soon">{esc(t["brand_soon"])}</span>' if bd.get("soon") else ""
        more = ""
        if bd["key"] == "grand":
            more = (
                f'<a class="btn btn--gold bline__cta" href="{grand_url(lang, depth)}">'
                f'{esc(t["cta_detail"])}{I_ARROW}</a>'
            )
        blines += f"""<article class="bline reveal{' bline--grand' if bd['key'] == 'grand' else ''}" data-brand="{bd['key']}">
<div class="bline__media">{pic(bd['img'], bd['name'], '(max-width: 900px) 100vw, 420px', depth=depth)}</div>
<div class="bline__body">
<span class="bmark" aria-hidden="true">{LOGO}</span>
<h3>{esc(bd['name'])}</h3>
<p class="bline__label">{esc(bd['label'])}{soon}</p>
<p class="bline__d">{esc(bd['d'])}</p>
{more}
</div>
</article>"""

    rooms = "".join(
        f'<article class="rcard reveal">{pic(c["img"], c["t"], "(max-width: 700px) 100vw, 320px", depth=depth)}'
        f'<div class="rcard__body"><h3>{esc(c["t"])}</h3><p>{esc(c["d"])}</p></div></article>'
        for c in t["rooms_cards"]
    )

    news = "".join(
        f'<article class="news__item reveal"><div class="news__date">{esc(n["date"])}</div>'
        f'<div><span class="badge{" badge--accent" if n["tag"] == "NEW OPEN" else ""}">{esc(n["tag"])}</span></div>'
        f'<div><h3>{esc(n["t"])}</h3><p>{esc(n["d"])}</p></div></article>'
        for n in t["news"]
    )

    faq = "".join(
        f'<details{" open" if i == 0 else ""}><summary>{esc(q["q"])}</summary><p>{esc(q["a"])}</p></details>'
        for i, q in enumerate(t["faq"])
    )

    body = f"""<section class="hero">
<div class="hero__media">{pic('hero-lobby', t['hero_title'].replace(chr(10), ' '), '100vw', loading='eager', depth=depth)}</div>
<div class="wrap hero__inner">
<p class="eyebrow">{esc(t['hero_eyebrow'])}</p>
<h1>{esc(t['hero_title'])}</h1>
<p class="hero__lead">{esc(t['hero_lead'])}</p>
<div class="hero__actions">
<a class="btn btn--primary" href="#hotels">{esc(t['nav']['hotels'])}{I_ARROW}</a>
<a class="btn btn--ghost" href="#brand">{esc(t['nav']['brand'])}</a>
</div>
</div>
</section>

<div class="wrap searchbar">
<form class="searchbar__card" onsubmit="return false;">
<p class="searchbar__title">{esc(t['search_title'])}</p>
<div class="searchbar__grid">
<div class="field"><label for="f-area">{esc(t['search_area'])}</label><select id="f-area">{opts}</select></div>
<div class="field"><label for="f-in">{esc(t['search_in'])}</label><input id="f-in" type="date"></div>
<div class="field"><label for="f-out">{esc(t['search_out'])}</label><input id="f-out" type="date"></div>
<div class="field"><label for="f-g">{esc(t['search_guests'])}</label><select id="f-g">{guests}</select></div>
<button class="btn btn--primary" type="button" disabled aria-disabled="true">{esc(t['search_submit'])}</button>
</div>
<p class="searchbar__note">{I_INFO}<span>{esc(t['search_note'])} <a href="{hotel_url(lang, 'kuzuha', depth)}">{esc(t['search_note_link'])}</a></span></p>
</form>
</div>

<section class="section" id="hotels">
<div class="wrap">
<div class="section-head"><p class="eyebrow">{esc(t['hotels_eyebrow'])}</p><h2>{esc(t['hotels_title'])}</h2><p>{esc(t['hotels_lead'])}</p></div>
<div class="chips">
<button class="chip" type="button" data-filter="all" aria-pressed="true">{esc(t['filter_all'])}</button>
{"".join(f'<button class="chip" type="button" data-filter="{a}" aria-pressed="false">{esc(t[AREA_KEY[a]])}</button>' for a in areas)}
</div>
<div class="hotel-grid">{cards}</div>
</div>
</section>

<section class="section section--surface" id="brand">
<div class="wrap">
<div class="section-head">
<p class="eyebrow">{esc(t['brand_eyebrow'])}</p>
<h2>{esc(t['brand_title'])}</h2>
<p class="brand-kicker">{esc(t['brand_kicker'])}</p>
<p>{esc(t['brand_lead'])}</p>
</div>
<div class="values">{values}</div>
<div class="blines">{blines}</div>
</div>
</section>

<section class="section" id="rooms">
<div class="wrap">
<div class="section-head"><p class="eyebrow">{esc(t['rooms_eyebrow'])}</p><h2>{esc(t['rooms_title'])}</h2><p>{esc(t['rooms_lead'])}</p></div>
<div class="rgrid">{rooms}</div>
</div>
</section>

<section class="section section--surface" id="news">
<div class="wrap">
<div class="section-head"><p class="eyebrow">{esc(t['news_eyebrow'])}</p><h2>{esc(t['news_title'])}</h2></div>
<div class="news">{news}</div>
</div>
</section>

<section class="section" id="faq">
<div class="wrap">
<div class="section-head"><p class="eyebrow">{esc(t['faq_eyebrow'])}</p><h2>{esc(t['faq_title'])}</h2></div>
<div class="faq">{faq}</div>
</div>
</section>

<section class="section section--surface" id="contact">
<div class="wrap">
<div class="section-head"><p class="eyebrow">{esc(t['contact_eyebrow'])}</p><h2>{esc(t['contact_title'])}</h2><p>{esc(t['contact_lead'])}</p></div>
<div class="cols cols--contact">
<div class="contact-card">
<a class="contact-cta" href="{contact_url(lang, depth)}">{esc(t['contact_cta'])}{I_ARROW}</a>
<div class="contact-split">
<div><h4>{esc(t['contact_owner'])}</h4><p>{esc(t['contact_owner_d'])}</p></div>
<div><h4>{esc(t['contact_career'])}</h4><p>{esc(t['contact_career_d'])}</p></div>
</div>
</div>
<figure class="about__figure reveal">{pic('brand-street', t['brand_title'], '(max-width: 900px) 100vw, 460px', depth=depth)}</figure>
</div>
</div>
</section>"""

    return page(lang, t, depth, t["meta_title"], t["meta_desc"], body)


# ----------------------------------------------------------------- detail
def build_detail(lang, h):
    code = lang["code"]
    t = SITE[code]
    depth = 1 if not lang["dir"] else 2
    name = h["name"][code]
    bname = next((x["name"] for x in t["brands"] if x["key"] == h["brand"]), "ELE Hotel")

    facts = [
        (t["f_rooms"], f"{h['rooms']} {t['unit_rooms']}" if h.get("rooms") else t["tbd"]),
        (t["f_open"], h["opened"][code]),
        (t["f_in"], h["checkin"]),
        (t["f_out"], h["checkout"]),
        (t["f_addr"], h["address"][code]),
    ]
    fact_rows = "".join(
        f'<div class="dl__row"><dt>{esc(k)}</dt><dd>{esc(v if str(v).strip() else t["tbd"])}</dd></div>' for k, v in facts
    )

    access = "".join(f"<li>{I_PIN}<span>{esc(a)}</span></li>" for a in h["access"][code])
    nearby = "".join(f'<span class="tag">{esc(x)}</span>' for x in h["nearby"][code])

    # ---- gallery: four blank slots until the real photography lands
    def ph(cls=""):
        return (
            f'<div class="ph {cls}"><span class="ph__i">{I_CAM}</span>'
            f'<span class="ph__t">{esc(t["photo_soon"])}</span></div>'
        )

    plab = t.get("photo_labels", {})

    def galt(item):
        lab = plab.get(item.get("label", ""), "")
        return f"{name} — {lab}" if lab else name

    gal = h.get("gallery") or []
    if gal:
        main = pic(gal[0]["img"], galt(gal[0]), "(max-width: 760px) 100vw, 62vw",
                   cls="shot shot--main", loading="eager", depth=depth)
        side = "".join(
            pic(x["img"], galt(x), "(max-width: 760px) 33vw, 28vw", cls="shot shot--sm", depth=depth)
            for x in gal[1:]
        )
        gallery = (
            f'<div class="gallery"><div class="gallery__main">{main}</div>'
            f'<div class="gallery__side" data-n="{len(gal) - 1}">{side}</div></div>'
        )
    else:
        gallery = (
            f'<div class="gallery"><div class="gallery__main">{ph()}</div>'
            f'<div class="gallery__side" data-n="3">{ph("ph--sm")}{ph("ph--sm")}{ph("ph--sm")}</div></div>'
            f'<p class="note">{I_INFO}<span>{esc(t["gallery_note"])}</span></p>'
        )

    n_room_shots = sum(1 for r in h["rtypes"] if r.get("img"))
    if n_room_shots == 0:
        rooms_note = t["rooms_note"]
    elif n_room_shots < len(h["rtypes"]):
        rooms_note = t["rooms_note_partial"]
    else:
        rooms_note = t["rooms_note_spec"]

    # ---- room types: photo slot + spec list, MONday style
    rcards = ""
    for r in h["rtypes"]:
        rows = ""
        if r["detail"][code]:
            rows += f'<div><dt>{esc(t["rt_size"])}</dt><dd>{esc(r["detail"][code])}</dd></div>'
        if r.get("cap"):
            rows += (
                f'<div><dt>{esc(t["rt_cap"])}</dt><dd>{r["cap"]} {esc(t["rt_cap_unit"])}</dd></div>'
            )
        shot = (
            pic(r["img"], f'{name} — {r["name"][code]}', "(max-width: 900px) 100vw, 30vw",
                cls="shot shot--room", depth=depth)
            if r.get("img") else ph("ph--room")
        )
        rcards += (
            f'<article class="rtcard reveal">{shot}'
            f'<div class="rtcard__body"><h3>{I_BED}<span>{esc(r["name"][code])}</span></h3>'
            f'<dl class="rtspec">{rows}</dl></div></article>'
        )

    # ---- facilities: illustrated icon grid
    fac_items = ""
    for i, x in enumerate(h["facilities"][code]):
        ref = h["facilities"]["ja"][i] + " " + h["facilities"]["en"][i]
        fac_items += f'<div class="amitem">{icon_for(ref)}<span>{esc(x)}</span></div>'
    # ---- room amenities (v1.9): same set for every hotel
    amen_items = ""
    for i, x in enumerate(h.get("amenities", {}).get(code, [])):
        ref = h["amenities"]["ja"][i] + " " + h["amenities"]["en"][i]
        amen_items += f'<div class="amitem">{icon_for(ref)}<span>{esc(x)}</span></div>'
    amen_block = (
        f'<h3 class="amgrid__title">{esc(t["detail_amenities"])}</h3>'
        f'<div class="amgrid">{amen_items}</div>'
    ) if amen_items else ""
    ota = "".join(
        f'<li><a href="{o["url"]}" target="_blank" rel="noopener">{esc(o["label"])}{I_EXT}</a></li>' for o in h["ota"]
    )
    tbd = t.get("tbd", "—")
    if not ota:
        ota = f'<li class="ota-tbd">{esc(tbd)}</li>'
    price_block = ""  # v1.8: 料金目安は非表示
    if h.get("tel"):
        tel_row = (
            f'<div><dt>{esc(t["f_tel"])}</dt>'
            f'<dd><a href="tel:{h["tel"].replace("-", "")}">{esc(h["tel"])}</a></dd></div>'
        )
    else:
        tel_row = f'<div><dt>{esc(t["f_tel"])}</dt><dd>{esc(tbd)}</dd></div>'
    if h.get("fax"):
        tel_row += f'<div><dt>{esc(t["f_fax"])}</dt><dd>{esc(h["fax"])}</dd></div>'
    bk = h.get("booking")
    if bk:
        def opts(n, unit):
            return "".join(
                f'<option value="{i}">{i} {esc(unit)}</option>' for i in range(1, n + 1)
            )
        book_block = f"""<form class="bkform" action="{bk['action']}" method="post" target="_blank">
<input type="hidden" name="obj_year" value=""><input type="hidden" name="obj_month" value=""><input type="hidden" name="obj_day" value="">
<p class="bkform__row"><label for="bk-date-{h['slug']}">{esc(t['bk_date'])}</label>
<input class="bk-date" id="bk-date-{h['slug']}" type="date" required></p>
<p class="bkform__row"><label for="bk-per-{h['slug']}">{esc(t['bk_guests'])}</label>
<select id="bk-per-{h['slug']}" name="obj_per_num">{opts(bk.get('max_guests', 5), t['bk_unit_guest'])}</select></p>
<p class="bkform__row"><label for="bk-stay-{h['slug']}">{esc(t['bk_nights'])}</label>
<select id="bk-stay-{h['slug']}" name="obj_stay_num">{opts(bk.get('max_nights', 5), t['bk_unit_night'])}</select></p>
<p class="bkform__row"><label for="bk-room-{h['slug']}">{esc(t['bk_rooms'])}</label>
<select id="bk-room-{h['slug']}" name="obj_room_num">{opts(bk.get('max_rooms', 5), t['bk_unit_room'])}</select></p>
<button class="btn btn--primary btn--full" type="submit">{esc(t['bk_search'])}</button>
</form>
<p class="searchbar__note">{I_INFO}<span>{esc(t['bk_note'])}</span></p>
<a class="btn btn--ghost btn--full" href="{bk['top']}" target="_blank" rel="noopener">{esc(t['bk_direct'])}{I_EXT}</a>
<h3 class="aside-sub">{esc(t['bk_ota_head'])}</h3>
<ul class="ota-list" role="list">{ota}</ul>"""
        book_title = t["bk_title"]
    else:
        book_block = (
            f'<p class="searchbar__note">{I_INFO}<span>{esc(t["detail_book_note"])}</span></p>'
            f'<ul class="ota-list" role="list">{ota}</ul>'
        )
        book_title = t["detail_book"]
    soon_badge = (
        f'<span class="badge badge--soon">{esc(t["hotel_soon"])}</span>'
        if h.get("status") == "soon" else ""
    )
    soon_text = h["opened"][code] or t["hotel_soon_note"]
    soon_note = (
        f'<p class="searchbar__note">{I_INFO}<span>{esc(soon_text)}</span></p>'
        if h.get("status") == "soon" else ""
    )

    body = f"""<div class="wrap">
<nav class="crumbs" aria-label="breadcrumb">
<a href="{home_url(lang, depth)}">ELE HOTEL</a><span>/</span>
<a href="{home_url(lang, depth)}#hotels">{esc(t['nav']['hotels'])}</a><span>/</span>
<span>{esc(name)}</span>
</nav>
</div>

<section class="dhero"><div class="wrap">
<div class="dhero__head">
<div>
<span class="badge">{esc(t[AREA_KEY[h['area']]])}</span>
<span class="badge badge--brand" data-brand="{h['brand']}">{esc(bname)}</span>{soon_badge}
<h1>{esc(name)}</h1>
<p class="dhero__tag">{esc(h['tagline'][code])}</p>
</div>
{price_block}
</div>
{gallery}
</div></section>

<section class="section section--tight" id="rooms"><div class="wrap">
<div class="section-head section-head--left"><p class="eyebrow">ROOM</p><h2>{esc(t['detail_rooms'])}</h2><p>{esc(rooms_note)}</p></div>
<div class="rtgrid">{rcards}</div>
</div></section>

<section class="section section--surface" id="facility"><div class="wrap">
<div class="section-head section-head--left"><p class="eyebrow">FACILITY</p><h2>{esc(t['detail_facilities'])}</h2></div>
<h3 class="amgrid__title">{esc(t['detail_equipment'])}</h3>
<div class="amgrid">{fac_items}</div>
{amen_block}
<p class="note">{I_INFO}<span>{esc(t['amenity_note'])}</span></p>
</div></section>

<section class="section section--tight"><div class="wrap">
<div class="dgrid">
<div>
<div class="block"><h2>{esc(t['detail_facts'])}</h2><dl class="dl">{fact_rows}</dl></div>
<div class="block"><h2>{esc(t['detail_access'])}</h2><ul class="tick-list" role="list">{access}</ul></div>
<div class="block"><h2>{esc(t['detail_map'])}</h2>
<div class="map-frame"><iframe src="https://www.google.com/maps?q={h['map_q']}&amp;output=embed" title="{esc(name)} — {esc(t['detail_map'])}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div>
</div>
<div class="block"><h2>{esc(t['detail_nearby'])}</h2><div class="tag-row">{nearby}</div></div>
</div>
<aside class="aside-card">
<h2>{esc(book_title)}</h2>
{soon_note}{book_block}
<dl class="aside-facts">
{tel_row}
<div><dt>{esc(t['f_in'])}</dt><dd>{esc(h['checkin'])}</dd></div>
<div><dt>{esc(t['f_out'])}</dt><dd>{esc(h['checkout'])}</dd></div>
</dl>
</aside>
</div>
<p class="detail-back"><a class="btn btn--ghost" href="{home_url(lang, depth)}#hotels">{esc(t['back_home'])}</a></p>
</div></section>"""

    title = f"{name} | ELE HOTEL" if code in ("en", "ko") else f"{name}｜ELE HOTEL"
    return page(lang, t, depth, title, h["tagline"][code], body, page_slug=h["slug"])



# ----------------------------------------------------------------- Grand ELE
def build_grand(lang):
    code = lang["code"]
    t = SITE[code]
    g = GRAND[code]
    depth = 0 if not lang["dir"] else 1

    def gpic(name, altkey, sizes, loading="lazy"):
        return pic("grand-" + name, g[altkey], sizes, depth=depth, loading=loading)

    paras = "".join(f"<p>{esc(x)}</p>" for x in g["concept_paras"])
    pillars = "".join(
        f'<article class="gpil reveal">'
        + (
            f'<span class="gpil__en">{esc(p["en"])}</span>'
            if p["en"].strip().lower() != p["k"].strip().lower()
            else ""
        )
        + f'<h3>{esc(p["k"])}</h3><p>{esc(p["d"])}</p></article>'
        for p in g["pillars"]
    )
    rooms = "".join(
        f'<article class="groom reveal"><h3>{esc(r["name"])}</h3>'
        f'<p class="groom__spec">{I_BED}<span>{esc(r["size"])}</span>'
        f'<span class="groom__cap">{esc(r["cap"])}</span></p>'
        f'<p class="groom__d">{esc(r["d"])}</p></article>'
        for r in g["rooms"]
    )
    hours = "".join(
        f'<div class="dl__row"><dt>{esc(h["k"])}</dt><dd>{esc(h["v"])}</dd></div>' for h in g["dining_hours"]
    )
    dining_paras = "".join(f"<p>{esc(x)}</p>" for x in g["dining_paras"])
    well_paras = "".join(f"<p>{esc(x)}</p>" for x in g["wellness_paras"])
    services = "".join(
        f'<article class="gserv reveal"><h3>{I_CHECK}<span>{esc(x["k"])}</span></h3><p>{esc(x["d"])}</p></article>'
        for x in g["services"]
    )
    plan = "".join(
        f'<div class="dl__row"><dt>{esc(x["k"])}</dt><dd>{esc(x["v"])}</dd></div>' for x in g["plan_items"]
    )

    body = f"""<div class="grand">
<div class="wrap">
<nav class="crumbs" aria-label="breadcrumb">
<a href="{home_url(lang, depth)}">ELE HOTEL</a><span>/</span>
<a href="{home_url(lang, depth)}#brand">{esc(t['nav']['brand'])}</a><span>/</span>
<span>{esc(g['crumb'])}</span>
</nav>
</div>

<section class="ghero">
<div class="ghero__media">{gpic('hero', 'img_hero', '100vw', loading='eager')}</div>
<div class="wrap ghero__inner">
<span class="gmark" aria-hidden="true">{LOGO}</span>
<p class="eyebrow eyebrow--gold">{esc(g['eyebrow'])}</p>
<p class="gslogan">{esc(g['slogan'])}</p>
<h1>{esc(g['title'])}</h1>
<p class="ghero__lead">{esc(g['lead'])}</p>
</div>
</section>

<section class="section gsec" id="concept">
<div class="wrap gsplit">
<div class="gsplit__text">
<p class="eyebrow eyebrow--gold">{esc(g['concept_eyebrow'])}</p>
<h2>{esc(g['concept_title'])}</h2>
{paras}
</div>
<figure class="gsplit__fig reveal">{gpic('facade', 'img_facade', '(max-width: 900px) 100vw, 440px')}</figure>
</div>
</section>

<section class="section gsec gsec--alt" id="promises">
<div class="wrap">
<div class="section-head section-head--left"><p class="eyebrow eyebrow--gold">{esc(g['pillars_eyebrow'])}</p><h2>{esc(g['pillars_title'])}</h2></div>
<div class="gpils">{pillars}</div>
</div>
</section>

<section class="section gsec" id="rooms">
<div class="wrap">
<div class="section-head section-head--left"><p class="eyebrow eyebrow--gold">{esc(g['rooms_eyebrow'])}</p><h2>{esc(g['rooms_title'])}</h2><p>{esc(g['rooms_lead'])}</p></div>
<div class="gsplit gsplit--wide">
<figure class="gsplit__fig reveal">{gpic('suite', 'img_suite', '(max-width: 900px) 100vw, 620px')}</figure>
<div class="grooms">{rooms}</div>
</div>
<p class="note">{I_INFO}<span>{esc(g['rooms_note'])}</span></p>
</div>
</section>

<section class="section gsec gsec--alt" id="dining">
<div class="wrap gsplit gsplit--rev">
<figure class="gsplit__fig reveal">{gpic('dining', 'img_dining', '(max-width: 900px) 100vw, 520px')}</figure>
<div class="gsplit__text">
<p class="eyebrow eyebrow--gold">{esc(g['dining_eyebrow'])}</p>
<h2>{esc(g['dining_title'])}</h2>
<p class="gkicker">{esc(g['dining_lead'])}</p>
{dining_paras}
<dl class="dl dl--gold">{hours}</dl>
<p class="note">{I_INFO}<span>{esc(g['dining_note'])}</span></p>
</div>
</div>
</section>

<section class="section gsec" id="wellness">
<div class="wrap gsplit">
<div class="gsplit__text">
<p class="eyebrow eyebrow--gold">{esc(g['wellness_eyebrow'])}</p>
<h2>{esc(g['wellness_title'])}</h2>
{well_paras}
</div>
<figure class="gsplit__fig reveal">{gpic('bath', 'img_bath', '(max-width: 900px) 100vw, 460px')}</figure>
</div>
</section>

<section class="section gsec gsec--alt" id="service">
<div class="wrap">
<div class="section-head section-head--left"><p class="eyebrow eyebrow--gold">{esc(g['service_eyebrow'])}</p><h2>{esc(g['service_title'])}</h2></div>
<figure class="gband reveal">{gpic('lounge', 'img_lounge', '100vw')}</figure>
<div class="gservs">{services}</div>
<p class="note">{I_INFO}<span>{esc(g['service_note'])}</span></p>
</div>
</section>

<section class="section gsec" id="development">
<div class="wrap gsplit gsplit--rev">
<figure class="gsplit__fig reveal">{gpic('detail', 'img_detail', '(max-width: 900px) 100vw, 420px')}</figure>
<div class="gsplit__text">
<p class="eyebrow eyebrow--gold">{esc(g['plan_eyebrow'])}</p>
<h2>{esc(g['plan_title'])}</h2>
<p>{esc(g['plan_lead'])}</p>
<dl class="dl dl--gold">{plan}</dl>
</div>
</div>
</section>

<section class="section gsec gsec--cta" id="contact">
<div class="wrap gcta">
<p class="eyebrow eyebrow--gold">{esc(g['contact_eyebrow'])}</p>
<h2>{esc(g['contact_title'])}</h2>
<p class="gcta__lead">{esc(g['contact_lead'])}</p>
<div class="gcta__row">
<a class="btn btn--gold" href="{contact_url(lang, depth)}">{esc(t['contact_title'])}{I_ARROW}</a>
<a class="btn btn--ghost-gold" href="https://tej.jp" target="_blank" rel="noopener">{esc(t['operator_link'])}{I_EXT}</a>
</div>
<p class="gnote">{esc(g['img_note'])}</p>
<p class="gnote">{esc(g['contact_note'])}</p>
<p class="detail-back"><a class="btn btn--ghost-gold" href="{home_url(lang, depth)}">{esc(g['back'])}</a></p>
</div>
</section>
</div>"""

    return page(lang, t, depth, g["meta_title"], g["meta_desc"], body, kind="grand")


# ----------------------------------------------------------------- privacy
def build_privacy(lang):
    code = lang["code"]
    t = SITE[code]
    p = t["privacy"]
    depth = 0 if not lang["dir"] else 1

    blocks = ""
    for s in p["sections"]:
        lead = f'<p class="legal__lead">{esc(s["lead"])}</p>' if s.get("lead") else ""
        items = "".join(f"<li>{esc(x)}</li>" for x in s["items"])
        blocks += (
            f'<section class="legal__sec"><h2>{esc(s["h"])}</h2>{lead}'
            f'<ul class="legal__list">{items}</ul></section>'
        )
    rows = "".join(
        f'<div class="dl__row"><dt>{esc(r["k"])}</dt><dd>{esc(r["v"])}</dd></div>' for r in p["contact_rows"]
    )
    blocks += (
        f'<section class="legal__sec"><h2>{esc(p["contact_h"])}</h2>'
        f'<dl class="dl legal__dl">{rows}</dl>'
        f'<p class="legal__note">{esc(p["contact_note"])}</p></section>'
    )

    body = f"""<div class="wrap">
<nav class="crumbs" aria-label="breadcrumb">
<a href="{home_url(lang, depth)}">ELE HOTEL</a><span>/</span>
<span>{esc(p['title'])}</span>
</nav>
</div>

<section class="section section--tight"><div class="wrap">
<div class="legal">
<div class="legal__head">
<p class="eyebrow">{esc(p['eyebrow'])}</p>
<h1>{esc(p['title'])}</h1>
<p class="legal__intro">{esc(p['lead'])}</p>
</div>
{blocks}
<p class="detail-back"><a class="btn btn--ghost" href="{home_url(lang, depth)}">{esc(p['back'])}</a></p>
</div>
</div></section>"""

    return page(lang, t, depth, p["meta_title"], p["meta_desc"], body, kind="privacy")



# ----------------------------------------------------------------- contact
def build_contact(lang):
    code = lang["code"]
    t = SITE[code]
    c = t["contact_page"]
    depth = 0 if not lang["dir"] else 1
    req = f'<span class="lb__req">{esc(c["req"])}</span>'
    opt = f'<span class="lb__opt">{esc(c["opt"])}</span>'

    kinds = "".join(f'<option value="{esc(x)}">{esc(x)}</option>' for x in c["kinds"])
    replies = "".join(
        f'<label class="radio"><input type="radio" name="reply" value="{esc(x)}"'
        f'{" checked" if i == 0 else ""}><span>{esc(x)}</span></label>'
        for i, x in enumerate(c["reply_opts"])
    )

    form = f"""<form class="cform" id="cform" novalidate>
<div class="cfield">
<label class="lb" for="c-kind">{esc(c['f_kind'])}{req}</label>
<select class="inp" id="c-kind" name="kind" required>
<option value="">{esc(c['f_kind_ph'])}</option>{kinds}</select>
</div>
<div class="cgrid">
<div class="cfield">
<label class="lb" for="c-name">{esc(c['f_name'])}{req}</label>
<input class="inp" id="c-name" name="name" type="text" autocomplete="name" placeholder="{esc(c['f_name_ph'])}" required>
</div>
<div class="cfield">
<label class="lb" for="c-company">{esc(c['f_company'])}{opt}</label>
<input class="inp" id="c-company" name="company" type="text" autocomplete="organization" placeholder="{esc(c['f_company_ph'])}">
</div>
<div class="cfield">
<label class="lb" for="c-email">{esc(c['f_email'])}{req}</label>
<input class="inp" id="c-email" name="email" type="email" autocomplete="email" placeholder="{esc(c['f_email_ph'])}" required>
</div>
<div class="cfield">
<label class="lb" for="c-tel">{esc(c['f_tel'])}{opt}</label>
<input class="inp" id="c-tel" name="tel" type="tel" autocomplete="tel" placeholder="{esc(c['f_tel_ph'])}">
</div>
</div>
<div class="cfield">
<span class="lb">{esc(c['f_reply'])}{opt}</span>
<div class="radios">{replies}</div>
</div>
<div class="cfield">
<label class="lb" for="c-msg">{esc(c['f_msg'])}{req}</label>
<textarea class="inp inp--ta" id="c-msg" name="message" rows="7" placeholder="{esc(c['f_msg_ph'])}" required></textarea>
</div>
<div class="cfield cfield--consent">
<label class="check"><input type="checkbox" id="c-agree" name="agree" required>
<span>{esc(c['consent_pre'])}<a href="{privacy_url(lang, depth)}">{esc(c['consent_link'])}</a>{esc(c['consent_post'])}</span></label>
</div>
<p class="cform__err" id="cerr" role="alert" hidden></p>
<div class="cform__foot">
<button class="btn btn--primary btn--wide" type="submit" id="csubmit">{esc(c['submit'])}{I_ARROW}</button>
<p class="cform__note">{esc(c['note'])}</p>
</div>
<input type="text" name="_gotcha" tabindex="-1" autocomplete="off" aria-hidden="true" class="gotcha">
<input type="hidden" name="lang" value="{lang['html']}">
<input type="hidden" name="page" value="{esc(c['title'])}">
</form>
<div class="cdone" id="cdone" hidden>
<div class="cdone__mark">{I_CHECK}</div>
<h2>{esc(c['ok_title'])}</h2>
<p>{esc(c['ok_text'])}</p>
<button class="btn btn--ghost" type="button" id="cagain">{esc(c['ok_again'])}</button>
</div>"""

    aside = f"""<aside class="caside">
<div class="caside__box">
<h3>{esc(c['aside_tel_h'])}</h3>
<a class="contact-tel contact-tel--sm" href="tel:+81362608831">{I_TEL}03-6260-8831</a>
<p>{esc(c['aside_tel_note'])}</p>
</div>
<div class="caside__box">
<h3>{esc(c['aside_hotel_h'])}</h3>
<p>{esc(c['aside_hotel_note'])}</p>
<p><a class="caside__link" href="{home_url(lang, depth)}#hotels">{esc(c['aside_hotel_link'])}{I_ARROW}</a></p>
</div>
<div class="caside__box">
<h3>{esc(c['aside_privacy_h'])}</h3>
<p>{esc(c['aside_privacy_note'])}</p>
<p><a class="caside__link" href="{privacy_url(lang, depth)}">{esc(t['privacy']['nav'])}{I_ARROW}</a></p>
</div>
</aside>"""

    body = f"""<div class="wrap">
<nav class="crumbs" aria-label="breadcrumb">
<a href="{home_url(lang, depth)}">ELE HOTEL</a><span>/</span>
<span aria-current="page">{esc(c['title'])}</span>
</nav>
</div>

<section class="section section--tight"><div class="wrap">
<div class="chead">
<p class="eyebrow">{esc(c['eyebrow'])}</p>
<h1>{esc(c['title'])}</h1>
<p class="chead__lead">{esc(c['lead'])}</p>
</div>
<div class="cwrap">
<div class="cmain">{form}</div>
{aside}
</div>
<p class="detail-back"><a class="btn btn--ghost" href="{home_url(lang, depth)}">{esc(c['back'])}</a></p>
</div></section>
<script>
(function(){{
  var f=document.getElementById('cform'),e=document.getElementById('cerr'),
      b=document.getElementById('csubmit'),d=document.getElementById('cdone'),
      a=document.getElementById('cagain'),
      M={{req:{json.dumps(c['err_required'], ensure_ascii=False)},
          mail:{json.dumps(c['err_email'], ensure_ascii=False)},
          agree:{json.dumps(c['err_consent'], ensure_ascii=False)},
          send:{json.dumps(c['err_send'], ensure_ascii=False)}}},
      L={json.dumps(c['submit'], ensure_ascii=False)},S={json.dumps(c['sending'], ensure_ascii=False)};
  function bad(m){{e.textContent=m;e.hidden=false;e.scrollIntoView({{block:'center',behavior:'smooth'}});}}
  a.addEventListener('click',function(){{d.hidden=true;f.hidden=false;f.reset();}});
  f.addEventListener('submit',function(ev){{
    ev.preventDefault();e.hidden=true;
    var g=function(n){{var x=f.elements[n];return x?(x.value||'').trim():'';}};
    if(!g('kind')||!g('name')||!g('email')||!g('message'))return bad(M.req);
    if(!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(g('email')))return bad(M.mail);
    if(!f.elements['agree'].checked)return bad(M.agree);
    var r=f.querySelector('input[name=reply]:checked');
    var p={{kind:g('kind'),name:g('name'),company:g('company'),email:g('email'),
            tel:g('tel'),reply:r?r.value:'',message:g('message'),
            lang:g('lang'),page:g('page'),_gotcha:g('_gotcha')}};
    b.disabled=true;b.textContent=S;
    fetch('/api/contact',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify(p)}})
      .then(function(x){{if(!x.ok)throw 0;return x.json();}})
      .then(function(j){{if(!j||!j.ok)throw 0;f.hidden=true;d.hidden=false;
        d.scrollIntoView({{block:'center',behavior:'smooth'}});}})
      .catch(function(){{bad(M.send);}})
      .then(function(){{b.disabled=false;b.textContent=L;}});
  }});
}})();
</script>"""

    return page(lang, t, depth, c["meta_title"], c["meta_desc"], body, kind="contact")


FAVICON = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 98.99">'
    '<circle cx="50" cy="49.5" r="49.5" fill="#fff"/>'
    f'<path fill="{MARK_COLOR}" fill-rule="evenodd" d="{MARK_PATH}"/></svg>\n'
)


def write(path, content):
    full = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        f.write(content)


def stamp_admin_assets():
    """管理画面の app.js / style.css に内容ハッシュを付ける。
    ブラウザのキャッシュが原因で古い管理画面が表示されるのを防ぐ。"""
    import hashlib
    import re as _re

    admin = os.path.join(ROOT, "admin")
    index = os.path.join(admin, "index.html")
    if not os.path.exists(index):
        return
    with open(index, encoding="utf-8") as f:
        html = f.read()
    original = html
    for name in ("app.js", "style.css"):
        path = os.path.join(admin, name)
        if not os.path.exists(path):
            continue
        with open(path, "rb") as f:
            ver = hashlib.sha1(f.read()).hexdigest()[:8]
        html = _re.sub(
            r'(?<=["\'/])' + _re.escape(name) + r'(\?v=[0-9a-f]+)?(?=["\'])',
            name + "?v=" + ver,
            html,
        )
    if html != original:
        with open(index, "w", encoding="utf-8") as f:
            f.write(html)
        print("stamped admin/index.html (cache busting)")


def main():
    write("assets/favicon.svg", FAVICON)
    n = 0
    for lang in LANGS:
        d = lang["dir"]
        prefix = (d + "/") if d else ""
        write(prefix + "index.html", build_home(lang))
        n += 1
        write(prefix + "contact.html", build_contact(lang))
        n += 1
        write(prefix + "grand.html", build_grand(lang))
        n += 1
        write(prefix + "privacy.html", build_privacy(lang))
        n += 1
        for h in HOTELS:
            write(prefix + "hotels/" + h["slug"] + ".html", build_detail(lang, h))
            n += 1
    print(f"built {n} pages  ({', '.join(LANG_CODES)})")

    # src/ のワーカーモジュールを _worker.js にまとめ直す
    from tools import build_worker

    print(f"built _worker.js ({build_worker.build()} bytes)")
    stamp_admin_assets()
    gaps = R.report()
    if gaps:
        with open(os.path.join(DATA, "i18n-todo.json"), "w", encoding="utf-8") as f:
            json.dump(R.missing, f, ensure_ascii=False, indent=2)
        print("missing translations:", gaps, "-> data/i18n-todo.json (Japanese shown as fallback)")
        print("   run: python3 tools/i18n_sync.py --todo   to export the strings that need translating")
    else:
        p = os.path.join(DATA, "i18n-todo.json")
        if os.path.exists(p):
            os.remove(p)
        print("translations complete")


if __name__ == "__main__":
    main()
