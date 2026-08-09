import argparse
import base64
import mimetypes
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DEFAULT_OUTPUT = ROOT / "支了个婷_手机分享版.html"

STYLESHEET_TAG_RE = re.compile(r"<link\b[^>]*>", re.IGNORECASE)
SCRIPT_TAG_RE = re.compile(
    r"<script(?P<attrs>[^>]*)\bsrc=(?P<quote>[\"'])(?P<src>[^\"']+)(?P=quote)(?P<tail>[^>]*)>\s*</script>",
    re.IGNORECASE,
)
CSS_IMPORT_RE = re.compile(
    r"@import\s+(?:url\()?\s*(?P<quote>[\"'])(?P<src>[^\"']+)(?P=quote)\s*\)?\s*;?",
    re.IGNORECASE,
)
QUOTED_ASSET_RE = re.compile(
    r"(?P<quote>[\"'])(?P<src>(?!data:|https?:|//|#)[^\"'\r\n]+?\."
    r"(?:png|jpe?g|svg|webp|gif|avif|mp3|ogg|wav|m4a|aac)(?:[?#][^\"']*)?)(?P=quote)",
    re.IGNORECASE,
)
CSS_URL_RE = re.compile(
    r"url\(\s*(?P<quote>[\"']?)(?P<src>[^)\"']+)(?P=quote)\s*\)",
    re.IGNORECASE,
)
HTML_ASSET_ATTR_RE = re.compile(
    r"(?P<prefix>\b(?:src|href|poster)\s*=\s*)(?P<quote>[\"'])(?P<src>[^\"']+)(?P=quote)",
    re.IGNORECASE,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="构建可直接分享的单文件版本。")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="输出 HTML 路径")
    return parser.parse_args()


def resolve_local(reference: str, base_dir: Path) -> Path | None:
    clean_reference = re.split(r"[?#]", reference, maxsplit=1)[0]
    if not clean_reference or clean_reference.startswith(("data:", "http:", "https:", "//", "#")):
        return None

    candidate = (base_dir / clean_reference).resolve()
    try:
        candidate.relative_to(ROOT)
    except ValueError as error:
        raise ValueError(f"Refusing to bundle a file outside the project: {reference}") from error
    return candidate if candidate.is_file() else None


def data_url(path: Path) -> str:
    mime_type, _ = mimetypes.guess_type(path.name)
    if path.suffix.lower() == ".svg":
        mime_type = "image/svg+xml"
    mime_type = mime_type or "application/octet-stream"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def inline_quoted_assets(text: str, base_dir: Path) -> str:
    def replace(match: re.Match[str]) -> str:
        path = resolve_local(match.group("src"), base_dir)
        if path is None:
            return match.group(0)
        quote = match.group("quote")
        return f"{quote}{data_url(path)}{quote}"

    return QUOTED_ASSET_RE.sub(replace, text)


def bundle_css(path: Path, stack: tuple[Path, ...] = ()) -> str:
    resolved = path.resolve()
    if resolved in stack:
        cycle = " -> ".join(item.name for item in (*stack, resolved))
        raise ValueError(f"Circular CSS import: {cycle}")

    css = resolved.read_text(encoding="utf-8")

    def replace_import(match: re.Match[str]) -> str:
        imported = resolve_local(match.group("src"), resolved.parent)
        if imported is None or imported.suffix.lower() != ".css":
            return match.group(0)
        return bundle_css(imported, (*stack, resolved))

    css = CSS_IMPORT_RE.sub(replace_import, css)

    def replace_url(match: re.Match[str]) -> str:
        reference = match.group("src").strip()
        asset = resolve_local(reference, resolved.parent)
        if asset is None:
            return match.group(0)
        return f'url("{data_url(asset)}")'

    return CSS_URL_RE.sub(replace_url, css)


def inline_stylesheets(html: str) -> str:
    def replace(match: re.Match[str]) -> str:
        tag = match.group(0)
        rel = re.search(r"\brel=[\"']([^\"']+)[\"']", tag, re.IGNORECASE)
        href = re.search(r"\bhref=[\"']([^\"']+)[\"']", tag, re.IGNORECASE)
        if not rel or "stylesheet" not in rel.group(1).lower().split() or not href:
            return tag
        path = resolve_local(href.group(1), ROOT)
        if path is None:
            return tag
        return f"<style>\n{bundle_css(path)}\n</style>"

    return STYLESHEET_TAG_RE.sub(replace, html)


def inline_scripts(html: str) -> str:
    def replace(match: re.Match[str]) -> str:
        path = resolve_local(match.group("src"), ROOT)
        if path is None:
            return match.group(0)
        attrs = (match.group("attrs") + match.group("tail")).strip()
        attrs = re.sub(r"\s+", " ", attrs)
        attrs = f" {attrs}" if attrs else ""
        script = inline_quoted_assets(path.read_text(encoding="utf-8"), path.parent)
        return f"<script{attrs}>\n{script}\n</script>"

    return SCRIPT_TAG_RE.sub(replace, html)


def inline_html_assets(html: str) -> str:
    def replace(match: re.Match[str]) -> str:
        asset = resolve_local(match.group("src"), ROOT)
        if asset is None or asset.suffix.lower() in {".css", ".js", ".webmanifest", ".html"}:
            return match.group(0)
        quote = match.group("quote")
        return f"{match.group('prefix')}{quote}{data_url(asset)}{quote}"

    return HTML_ASSET_ATTR_RE.sub(replace, html)


def build(output: Path) -> None:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    html = re.sub(
        r'<link\s+rel=["\']preload["\'][^>]*>\s*',
        "",
        html,
        flags=re.IGNORECASE,
    )
    html = re.sub(
        r'<link\s+rel=["\']manifest["\'][^>]*>\s*',
        "",
        html,
        flags=re.IGNORECASE,
    )
    html = inline_stylesheets(html)
    html = inline_scripts(html)
    html = inline_html_assets(html)

    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html, encoding="utf-8")
    print(f"Built {output.name} ({output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    build(parse_args().output)
