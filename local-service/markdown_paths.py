"""Rewrite local Markdown destinations while preserving unrelated source text."""
import json
import posixpath
import re
from urllib.parse import quote, unquote

DEST = r'(<[^>\r\n]*>|(?:\\.|[^\s\\()]|\([^()\r\n]*\))+)'
INLINE = re.compile(r'(\]\([ \t]*)' + DEST + r'([ \t]*(?:["\'][^\r\n]*?["\'][ \t]*)?\))')
REFERENCE = re.compile(r'^( {0,3}\[[^\]\r\n]+\]:[ \t]*)' + DEST)
HTML = re.compile(r'(\b(?:src|href)[ \t]*=[ \t]*)(["\'])(.*?)\2')


def rewrite(text, old_document, new_document, pathmap):
    def destination(value):
        local_url = value.startswith('local://')
        if not local_url and re.match(r'(?:[a-z][\w+.-]*:|//|#)', value, re.I):
            return value
        path, separator, fragment = value.partition('#')
        path, query_separator, query = path.partition('?')
        suffix = query_separator + query + separator + fragment
        absolute = local_url or path.startswith('/')
        if local_url:
            path = path[8:]
        try:
            path = unquote(re.sub(r'\\([\\ ()])', r'\1', path), errors='strict')
        except UnicodeError:
            return value
        if '\\' in path or '\x00' in path:
            return value
        resolved = posixpath.normpath(path.lstrip('/') if absolute else posixpath.join(posixpath.dirname(old_document), path))
        if resolved == '..' or resolved.startswith('../'):
            return value
        mapped = pathmap(resolved)
        if mapped == resolved and posixpath.dirname(old_document) == posixpath.dirname(new_document):
            return value
        target = mapped if absolute else posixpath.relpath(mapped, posixpath.dirname(new_document) or '.')
        # Preserve unchanged relative links within a renamed folder byte-for-byte.
        if not absolute and target == posixpath.normpath(path):
            return value
        return ('local://' if local_url else '/' if absolute else '') + quote(target, safe='/.-_~') + suffix

    def token(value):
        return '<' + destination(value[1:-1]) + '>' if value.startswith('<') and value.endswith('>') else destination(value)

    def prose(value):
        value = INLINE.sub(lambda m: m[1] + token(m[2]) + m[3], value)
        value = REFERENCE.sub(lambda m: m[1] + token(m[2]), value)
        return HTML.sub(lambda m: m[1] + m[2] + destination(m[3]) + m[2], value)

    header = re.match(r'^(\ufeff?---\r?\n)(.*?)(\r?\n---(?:\r?\n|$))', text, re.S)
    prefix = ''
    if header:
        def identifier(match):
            value = match[2].strip()
            try:
                decoded = json.loads(value) if value.startswith('"') else value.strip("'")
            except ValueError:
                return match[0]
            if not isinstance(decoded, str) or not decoded.startswith('local:'):
                return match[0]
            changed = 'local:' + pathmap(decoded[6:])
            return match[1] + json.dumps(changed, ensure_ascii=False) if changed != decoded else match[0]
        metadata = re.sub(r'^([ \t]*driveId:[ \t]*)([^\r\n]+)', identifier, header[2], flags=re.M)
        prefix = header[1] + metadata + header[3]
        text = text[header.end():]
    fence = None
    comment = False
    lines = []
    for line in text.splitlines(keepends=True):
        marker = re.match(r'^ {0,3}(`{3,}|~{3,})(.*)', line)
        if marker and not comment:
            if fence is None:
                fence = marker[1]
            elif marker[1][0] == fence[0] and len(marker[1]) >= len(fence) and not marker[2].strip():
                fence = None
            lines.append(line)
            continue
        if fence or line.startswith(('    ', '\t')):
            lines.append(line)
            continue
        output = ''; at = 0
        while at < len(line):
            if comment:
                end = line.find('-->', at)
                if end < 0:
                    output += line[at:]; break
                output += line[at:end+3]; at = end+3; comment = False
                continue
            protected = re.search(r'(`+).*?\1|<!--', line[at:])
            if not protected:
                output += prose(line[at:]); break
            output += prose(line[at:at+protected.start()]); at += protected.start()
            output += protected[0]; at += len(protected[0])
            if protected[0] == '<!--':
                comment = True
        lines.append(output)
    return prefix + ''.join(lines)
