import re

with open('bg_b64.txt', 'r') as f:
    b64 = f.read()

with open('style.css', 'r', encoding='utf-8') as f:
    css = f.read()

css = re.sub(r"background-image:\s*url\([^)]+\);", f"background-image: url('{b64}');", css)

with open('style.css', 'w', encoding='utf-8') as f:
    f.write(css)
