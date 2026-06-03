"""extract.py — pull plain text out of a SOW file (PDF / Word / text).

Invoked by the web server: `python extract.py <path>` -> UTF-8 text on stdout.
PDF uses pypdf; .docx uses the stdlib (a docx is a zip of XML), so the only
third-party dependency is pypdf. Text cleanup (ligatures, whitespace) happens on
the Node side so demo/live and CLI share one normalizer.
"""
import sys
import zipfile
import re
import html


def extract_pdf(path: str) -> str:
    from pypdf import PdfReader

    reader = PdfReader(path)
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def extract_docx(path: str) -> str:
    # A .docx is a zip; the body text lives in word/document.xml as <w:t> runs
    # inside <w:p> paragraphs. Join runs (concatenate, since Word splits words
    # across runs) and break on paragraphs.
    with zipfile.ZipFile(path) as z:
        xml = z.read("word/document.xml").decode("utf-8", errors="replace")
    xml = re.sub(r"</w:p>", "\n", xml)        # paragraph -> newline
    xml = re.sub(r"<w:tab\b[^>]*/>", "\t", xml)
    xml = re.sub(r"<[^>]+>", "", xml)          # strip remaining tags
    return html.unescape(xml)


def main() -> int:
    if len(sys.argv) < 2:
        sys.stderr.write("usage: extract.py <file>\n")
        return 2
    path = sys.argv[1]
    ext = path.lower().rsplit(".", 1)[-1] if "." in path else ""
    try:
        if ext == "pdf":
            out = extract_pdf(path)
        elif ext == "docx":
            out = extract_docx(path)
        else:  # txt, md, anything else — read as text
            with open(path, encoding="utf-8", errors="replace") as f:
                out = f.read()
    except Exception as e:  # noqa: BLE001 — surface any failure to the caller
        sys.stderr.write(f"extract failed: {e}\n")
        return 1
    sys.stdout.buffer.write(out.encode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
