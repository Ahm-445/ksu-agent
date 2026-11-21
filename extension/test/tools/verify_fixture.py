"""Check that no real value from the original page survives in the fixture.

Prints only counts and categories, never the real values themselves.
Usage: python3 extension/test/tools/verify_fixture.py <original.html> <fixture.html>
"""
import os, re, sys
from bs4 import BeautifulSoup, Comment
sys.path.insert(0, __import__("os").path.dirname(__file__))
from scrub_fixture import KEEP_LABELS, KEEP_WORDS, AR_POOL, EN_POOL, PREFIXES, AR_PREFIXES, FAKE_GRADES, FAKE_AR_GRADES, norm

AR = "؀-ۿ"
PRIVATE_TERMS = [t.strip() for t in os.environ.get("KSU_PRIVATE_TERMS", "").split(",") if t.strip()]
SAFE = set(KEEP_WORDS) | set(AR_POOL) | set(EN_POOL) | set(PREFIXES) | set(AR_PREFIXES)
for lab in KEEP_LABELS | set(FAKE_AR_GRADES):
    SAFE |= set(re.findall(rf"[A-Za-z]+|[{AR}]+|\d+", lab))

def content_tokens(path):
    soup = BeautifulSoup(open(path, encoding="utf-8", errors="replace").read(), "lxml")
    for t in soup(["script", "style", "noscript", "template", "svg"]):
        t.decompose()
    chunks = [str(s) for s in soup.find_all(string=True) if not isinstance(s, Comment)]
    for el in soup.find_all(True):
        for k in ("aria-label", "title", "alt", "placeholder", "value", "href"):
            if el.get(k):
                chunks.append(str(el.get(k)))
    toks = set()
    for c in chunks:
        if norm(c) in KEEP_LABELS:
            continue
        for tok in re.findall(rf"[A-Za-z]{{3,}}|[{AR}]{{3,}}|\d{{3,}}", c):
            if tok not in SAFE:
                toks.add(tok)
    return toks

def main():
    orig, fix = sys.argv[1], sys.argv[2]
    fixture = open(fix, encoding="utf-8").read()
    real = content_tokens(orig)
    fsoup = BeautifulSoup(fixture, "lxml")
    parts = [str(x) for x in fsoup.find_all(string=True) if not isinstance(x, Comment)]
    for el in fsoup.find_all(True):
        for k, val in el.attrs.items():
            if k.lower() not in {"colspan", "rowspan", "align", "valign", "width", "height", "tabindex",
                                 "cellpadding", "cellspacing", "border", "nowrap"}:
                parts.append(" ".join(val) if isinstance(val, list) else str(val))
    words = set(re.findall(rf"[A-Za-z]+|[{AR}]+|\d+", " ".join(parts)))
    leaked = [t for t in real if t in words]
    cats = {"arabic": 0, "digits": 0, "latin": 0}
    latin_leaks = []
    for t in leaked:
        if t.isdigit(): cats["digits"] += 1
        elif re.fullmatch(rf"[{AR}]+", t): cats["arabic"] += 1
        else:
            cats["latin"] += 1; latin_leaks.append(t)
    checks = {
        "student-id-like (4xxxxxxxx)": len(re.findall(r"\b4\d{8}\b", fixture)),
        "email addresses": len(re.findall(r"[\w.+-]+@[\w-]+\.[\w.]+", fixture)),
        # Your own name, student ID etc., given only on your machine, never committed:
    #   KSU_PRIVATE_TERMS="name1,name2,student-id" python3 verify_fixture.py ...
    "private terms (KSU_PRIVATE_TERMS)": sum(fixture.count(n) for n in PRIVATE_TERMS),
        "hidden inputs": len(re.findall(r'(?i)type="?hidden', fixture)),
        "scripts": len(re.findall(r"(?i)<script", fixture)),
        "query strings in links": len(re.findall(r'href="[^"]*\?', fixture)),
    }
    print(f"  real value tokens checked: {len(real)} | survived: arabic {cats['arabic']}, digits {cats['digits']}, latin {cats['latin']}")
    if latin_leaks:
        print("  latin survivors (page-address words):", len(latin_leaks))
    print("  " + " | ".join(f"{k}: {v}" for k, v in checks.items()))

if __name__ == "__main__":
    main()
