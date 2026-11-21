"""Turn a saved Edugate/LMS page into a test fixture with every value faked.

Keeps the page's structure (tags, ids, classes, table layout) and its fixed labels
(column headings, captions). Replaces every other text and every content-bearing
attribute with fake data of the same shape. Removes scripts, styles, images,
iframes, hidden inputs, comments and the "saved from" address.
Usage: python3 extension/test/tools/scrub_fixture.py <in.html> <out.html> <source-label>
"""
import hashlib, random, re, secrets, sys
from urllib.parse import urlsplit
from bs4 import BeautifulSoup, Comment

SALT = secrets.token_hex(16)  # fresh per run: fakes cannot be traced back

KEEP_LABELS = {
 "محتوى المقرر -", "القائمة الرئيسة", "رمز المقرر", "اسم المقرر", "الساعات", "النقاط", "التقدير",
 "الساعات المسجلة", "الساعات المكتسبة", "نجاح", "المعدل", ":", "الفصل الأول 1448/1449", "نوع المقرر",
 "النشاط", "الشعبة", "اليوم الوقت", "نوع الشعبة", "التفاصيل", "المحاضر :", "المقر", "مجموع الغياب",
 "مجموع التأخير", "نسبة الغياب", "نوع المجموعة", "المستوى",
 "مكان الاختبار الوحدة المبنى الطابق الجناح القاعة", "يوم الاختبار", "وقت الاختبار", "تاريخ الاختبار",
 "Courses", "View Course List", "View Course Grid", "Search your courses", "Terms", "Filters",
 "items per page", "To Do", "Overdue", "Due Today", "Due Soon", "Calendar", "Due:", "Grades",
 "Current Courses and Organizations",
}
KEEP_WORDS = set("""Sunday Monday Tuesday Wednesday Thursday Friday Saturday Today Due
January February March April May June July August September October November December
Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec AM PM am pm
الأحد الاثنين الإثنين الثلاثاء الأربعاء الخميس الجمعة السبت ص م
الفصل الأول الثاني الصيفي
مكان الاختبار الوحدة المبنى الطابق الجناح القاعة
فصلي تراكمي""".split())
GRADES = {"A+", "A", "B+", "B", "C+", "C", "D+", "D", "F", "DN", "NP", "NF", "W", "IP", "IC", "H"}
FAKE_GRADES = ["A+", "A", "B+", "B", "C+", "C"]
AR_GRADES = {"ممتاز مرتفع", "ممتاز", "جيد جدا مرتفع", "جيد جدا", "جيد مرتفع", "جيد", "مقبول مرتفع", "مقبول", "راسب"}
FAKE_AR_GRADES = ["ممتاز", "جيد جدا", "جيد مرتفع", "جيد"]
AR_POOL = ["نموذج", "تجريبي", "مقرر", "بيانات", "مثال", "وهمي", "عينة", "نص", "قيمة", "مادة", "وحدة", "موضوع"]
EN_POOL = ["Sample", "Demo", "Course", "Item", "Topic", "Example", "Unit", "Module", "Task", "Lesson"]
PREFIXES = ["CSC", "SWE", "IS", "CEN", "IT", "MATH", "STAT", "PHYS"]
AR_PREFIXES = ["عال", "حال", "نال", "ريض", "احص"]
DROP_TAGS = ["script", "style", "noscript", "template", "iframe", "img", "svg", "link", "meta", "object",
             "embed", "picture", "source", "video", "audio", "canvas", "base", "frame", "frameset"]
TEXT_ATTRS = {"aria-label", "title", "alt", "placeholder", "aria-description", "aria-valuetext", "label"}
STRUCT_ATTRS = {"id", "class", "for", "name", "headers", "aria-labelledby", "aria-describedby",
                "aria-controls", "aria-owns", "role", "type", "dir", "lang", "scope"}
LAYOUT_ATTRS = {"colspan", "rowspan", "align", "valign", "width", "height", "tabindex", "cellpadding",
                "cellspacing", "border", "nowrap"}
AR = "؀-ۿ"
TOKEN = re.compile(rf"([A-Za-z]+|[{AR}]+|\d+|[^A-Za-z{AR}\d]+)")

def rng(*parts):
    return random.Random(hashlib.sha256((SALT + "|".join(parts)).encode()).digest())

def norm(t):
    return re.sub(r"\s+", " ", t).strip()

def fake_digits(run, key):
    """Same length, obviously fake: 1-5 for one digit, 14xx/20xx for years, 9... otherwise."""
    r = rng("d", key, run)
    if len(run) == 1:
        return str(r.randint(1, 5))
    if len(run) == 2:
        return str(r.randint(1, 9)) + str(r.randint(0, 9))
    if len(run) == 4 and run[:2] in ("13", "14", "19", "20"):
        return run[:2] + f"{r.randint(0, 99):02d}"
    return "9" + "".join(str(r.randint(0, 9)) for _ in run[1:])

def fake_text(text, key="t"):
    if not text or not text.strip():
        return text
    n = norm(text)
    if n in KEEP_LABELS:
        return text
    if n in GRADES:
        return text.replace(n, rng("g", n).choice(FAKE_GRADES))
    if n in AR_GRADES:
        return text.replace(n, rng("ag", n).choice(FAKE_AR_GRADES))
    out = []
    for i, tok in enumerate(TOKEN.findall(text)):
        if tok in KEEP_WORDS:
            out.append(tok)
        elif tok.isdigit():
            out.append(fake_digits(tok, f"{n}#{i}"))
        elif re.fullmatch(r"[A-Z]{2,4}", tok):
            out.append(rng("p", tok).choice(PREFIXES))
        elif re.fullmatch(r"[A-Za-z]+", tok):
            w = rng("e", tok).choice(EN_POOL)
            out.append(w.lower() if tok.islower() else (w.upper() if tok.isupper() else w))
        elif re.fullmatch(rf"[{AR}]+", tok):
            pool = AR_PREFIXES if len(tok) == 3 and re.search(r"\d", n) else AR_POOL
            out.append(rng("a", tok).choice(pool))
        else:
            out.append(tok)
    return "".join(out)

def fake_struct(value):
    # ids/classes: keep the words, swap the digits, so references still match
    return re.sub(r"\d+", lambda m: fake_digits(m.group(0), "s" + value), value)

def fake_href(value):
    if value.strip().lower().startswith(("javascript:", "mailto:", "tel:", "data:")):
        return "#"
    try:
        parts = urlsplit(value)
    except ValueError:
        return "#"
    path = re.sub(r"\d+", lambda m: fake_digits(m.group(0), "h" + value), parts.path)
    host = f"{parts.scheme}://{parts.netloc}" if parts.netloc else ""
    return (host + path) or "#"

def scrub(src, out, label):
    soup = BeautifulSoup(open(src, encoding="utf-8", errors="replace").read(), "lxml")
    for c in soup.find_all(string=lambda s: isinstance(s, Comment)):
        c.extract()
    for t in soup(DROP_TAGS):
        t.decompose()
    for t in soup.find_all("input", attrs={"type": re.compile("hidden", re.I)}):
        t.decompose()
    if soup.head:
        soup.head.clear()
        soup.head.append(soup.new_tag("meta", charset="utf-8"))
        title = soup.new_tag("title"); title.string = "KSU Agent test fixture"; soup.head.append(title)
    for el in soup.find_all(True):
        new = {}
        for k, v in el.attrs.items():
            v = " ".join(v) if isinstance(v, list) else str(v)
            kl = k.lower()
            if kl in TEXT_ATTRS:
                new[k] = fake_text(v)
            elif kl == "href":
                new[k] = fake_href(v)
            elif kl in LAYOUT_ATTRS:
                new[k] = v
            elif kl.startswith("data-") and re.search(rf"[{AR}]|\s", v) and len(v) <= 200:
                new[k] = fake_text(v)
            elif kl in STRUCT_ATTRS or kl.startswith("data-") and len(v) <= 80:
                new[k] = fake_struct(v)
            elif kl.startswith("aria-") and kl not in TEXT_ATTRS:
                new[k] = fake_struct(v)
            # everything else (on*, style, src, value, action, long data-*) is dropped
        el.attrs = new
    for s in soup.find_all(string=True):
        if s.parent and s.parent.name in ("title",):
            continue
        s.replace_with(fake_text(str(s)))
    banner = Comment(f" KSU Agent test fixture. Structure copied from a real page ({label}); "
                     "every value replaced with fake data. Contains no real student data. ")
    (soup.html or soup).insert(0, banner)
    open(out, "w", encoding="utf-8").write("<!DOCTYPE html>\n" + str(soup))

if __name__ == "__main__":
    scrub(sys.argv[1], sys.argv[2], sys.argv[3])
