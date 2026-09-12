"""PKOS local folder bridge. Standard library only; loopback and same-origin writes."""
import argparse
import json
import mimetypes
import os
from pathlib import Path
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit


def file_version(path):
    try:
        stat = path.stat()
        return '"%s-%s-%s"' % (stat.st_mtime_ns, stat.st_size, stat.st_ino)
    except FileNotFoundError:
        return None


class Store:
    def __init__(self, root, state):
        self.root = Path(root).resolve(strict=True)
        if not self.root.is_dir():
            raise ValueError("root must be a directory")
        self.state = Path(state)
        self.lock = threading.RLock()
        self.snapshot = {"ready": False, "files": [], "error": None}
        self.stop = threading.Event()

    def path(self, raw):
        if not isinstance(raw, str) or "\\" in raw or "\x00" in raw:
            raise ValueError("invalid path")
        if raw.startswith("/") or ":" in raw or any(p in (".", "..") for p in raw.split("/")):
            raise ValueError("invalid path")
        path = (self.root / raw).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError("path outside root")
        return path

    def recover_rename(self):
        from rename_journal import recover
        return recover(self)

    def scan(self):
        with self.lock:
            try:
                self.recover_rename()
            except (OSError, ValueError) as exc:
                self.snapshot = {**self.snapshot, "ready": False, "error": str(exc), "checkedAt": time.time()}
                return
            self._scan()

    def _scan(self):
        try:
            if not self.root.is_dir():
                raise FileNotFoundError("record folder unavailable")
            files = []
            for base, dirs, names in os.walk(self.root, followlinks=False):
                dirs[:] = [d for d in dirs if not d.startswith(".") and not (Path(base) / d).is_symlink() and not (Path(base) / d).is_junction()]
                for name in names:
                    if name.startswith(".pkos-write-"):
                        continue
                    path = Path(base) / name
                    if path.is_symlink() or not path.resolve().is_relative_to(self.root):
                        continue
                    stat = path.stat()
                    files.append({"path": path.relative_to(self.root).as_posix(), "size": stat.st_size, "mtimeNs": str(stat.st_mtime_ns)})
            files.sort(key=lambda f: f["path"])
            with self.lock:
                previous = {f["path"]: f for f in self.snapshot["files"]}
                now = {f["path"]: f for f in files}
                changes = {"added": sorted(now.keys() - previous.keys()), "removed": sorted(previous.keys() - now.keys()),
                           "modified": sorted(k for k in now.keys() & previous.keys() if now[k] != previous[k])}
                result = {"ready": True, "checkedAt": time.time(), "files": files, "error": None,
                          "changes": changes if any(changes.values()) else self.snapshot.get("changes", changes)}
                if any(changes.values()):
                    result["changedAt"] = result["checkedAt"]
                else:
                    result["changedAt"] = self.snapshot.get("changedAt")
                self.state.parent.mkdir(parents=True, exist_ok=True)
                temporary = self.state.with_suffix(".tmp")
                temporary.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
                os.replace(temporary, self.state)
                self.snapshot = result
        except OSError as exc:
            with self.lock:
                self.snapshot = {**self.snapshot, "ready": False, "error": str(exc), "checkedAt": time.time()}

    def watch(self):
        while not self.stop.is_set():
            self.scan()
            self.stop.wait(2)


def make_server(store, app, port=8788):
    app = Path(app).resolve()
    from presentation_preview import PresentationPreviews
    previews = PresentationPreviews(store)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def reply(self, code, data):
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def allowed(self, write=False):
            expected = "127.0.0.1:" + str(self.server.server_port)
            if self.headers.get("Host") != expected:
                self.reply(403, {"error": "invalid host"})
                return False
            origin = self.headers.get("Origin")
            if origin and origin != "http://" + expected:
                self.reply(403, {"error": "cross-origin request rejected"})
                return False
            if self.headers.get("Sec-Fetch-Site") == "cross-site":
                self.reply(403, {"error": "cross-site request rejected"})
                return False
            if write and self.headers.get("X-PKOS-Local") != "1":
                self.reply(403, {"error": "write header required"})
                return False
            return True

        def do_GET(self):
            if not self.allowed():
                return
            request = urlsplit(self.path)
            query = parse_qs(request.query, keep_blank_values=True)
            try:
                if request.path == "/api/status":
                    with store.lock:
                        return self.reply(200, {"name": store.root.name, "protocol": 2, **store.snapshot})
                if request.path == "/api/presentation-preview":
                    return self.reply(200, previews.status(query.get("id", [""])[0]))
                if request.path == "/api/stat":
                    path = store.path(query.get("path", [""])[0])
                    if not path.exists():
                        return self.reply(404, {"error": "not found"})
                    return self.reply(200, {"name": path.name, "kind": "directory" if path.is_dir() else "file", "version": file_version(path)})
                if request.path == "/api/list":
                    parent = store.path(query.get("path", [""])[0])
                    rows = []
                    for p in parent.iterdir():
                        if p.name.startswith(".pkos-write-") or p.is_symlink() or p.is_junction() or not p.resolve().is_relative_to(store.root):
                            continue
                        rows.append({"name": p.name, "kind": "directory" if p.is_dir() else "file"})
                    return self.reply(200, rows)
                if request.path == "/api/archive-catalog":
                    catalog = app.parents[1] / "10_기록정리" / "catalog.json"
                    return self.reply(200, json.loads(catalog.read_text(encoding="utf-8")))
                if request.path == "/api/archive-file":
                    workspace = app.parents[1]
                    raw = query.get("path", [""])[0]
                    manifest = json.loads((workspace / "10_기록정리" / "original-hashes.json").read_text(encoding="utf-8"))
                    path = (workspace / raw).resolve()
                    if raw not in manifest or not path.is_relative_to(workspace):
                        return self.reply(403, {"error": "not in read-only catalog"})
                elif request.path == "/api/presentation-preview-file":
                    path = previews.output(query.get("id", [""])[0])
                elif request.path == "/api/file":
                    path = store.path(query.get("path", [""])[0])
                else:
                    name = unquote(request.path).lstrip("/") or "index.html"
                    path = (app / name).resolve()
                    if not path.is_relative_to(app) or any(part.startswith(".") for part in Path(name).parts) or name.startswith("local-service/"):
                        return self.reply(403, {"error": "not served"})
                with path.open("rb") as stream:
                    stat = os.fstat(stream.fileno())
                    self.send_response(200)
                    self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream")
                    self.send_header("Content-Length", str(stat.st_size))
                    self.send_header("X-PKOS-Mtime", str(stat.st_mtime_ns // 1000000))
                    self.send_header("ETag", '"%s-%s-%s"' % (stat.st_mtime_ns, stat.st_size, stat.st_ino))
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("X-Content-Type-Options", "nosniff")
                    if request.path in ("/api/file", "/api/archive-file", "/api/presentation-preview-file"):
                        self.send_header("Content-Security-Policy", "sandbox")
                    self.end_headers()
                    while chunk := stream.read(1024 * 1024):
                        self.wfile.write(chunk)
            except FileNotFoundError:
                self.reply(404, {"error": "not found"})
            except (OSError, ValueError) as exc:
                self.reply(400, {"error": str(exc)})

        def do_POST(self):
            if not self.allowed(write=True):
                return
            request = urlsplit(self.path)
            query = parse_qs(request.query, keep_blank_values=True)
            try:
                if request.path == "/api/presentation-preview":
                    with store.lock:
                        store.recover_rename()
                        return self.reply(202, previews.start(query.get("path", [""])[0]))
                if request.path == "/api/rename":
                    from rename_ops import rename
                    length = int(self.headers.get("Content-Length", "0"))
                    if length <= 0 or length > 8192:
                        raise ValueError("invalid request size")
                    payload = json.loads(self.rfile.read(length))
                    if not isinstance(payload, dict):
                        raise ValueError("invalid rename request")
                    return self.reply(200, rename(store, payload.get("path", ""), payload.get("name"), payload.get("tag")))
                path = store.path(query.get("path", [""])[0])
                with store.lock:
                    store.recover_rename()
                    if request.path == "/api/directory":
                        path.mkdir(exist_ok=True)
                    elif request.path == "/api/file":
                        try:
                            with path.open("xb"):
                                pass
                        except FileExistsError:
                            if not path.is_file():
                                raise ValueError("not a file")
                    else:
                        return self.reply(404, {"error": "not found"})
                self.reply(200, {"created": True})
            except (OSError, ValueError) as exc:
                self.reply(400, {"error": str(exc)})

        def do_DELETE(self):
            if not self.allowed(write=True):
                return
            request = urlsplit(self.path)
            if request.path != "/api/entry":
                return self.reply(404, {"error": "not found"})
            try:
                path = store.path(parse_qs(request.query, keep_blank_values=True).get("path", [""])[0])
                if path == store.root:
                    raise ValueError("cannot remove root")
                with store.lock:
                    store.recover_rename()
                    if path.is_dir():
                        path.rmdir()  # Deliberately refuse recursive removal.
                    else:
                        path.unlink()
                self.reply(200, {"removed": True})
            except FileNotFoundError:
                self.reply(404, {"error": "not found"})
            except (OSError, ValueError) as exc:
                self.reply(400, {"error": str(exc)})

        def do_PUT(self):
            if not self.allowed(write=True):
                return
            request = urlsplit(self.path)
            if request.path != "/api/file":
                return self.reply(404, {"error": "not found"})
            temporary = None
            try:
                raw = parse_qs(request.query, keep_blank_values=True).get("path", [""])[0]
                path = store.path(raw)
                length = int(self.headers.get("Content-Length", "-1"))
                if length < 0 or not path.parent.is_dir() or path == store.root:
                    raise ValueError("file path and length required")
                self.connection.settimeout(30)
                with store.lock:
                    store.recover_rename()
                    expected = self.headers.get("If-Match")
                    if expected and file_version(path) != expected:
                        return self.reply(412, {"error": "다른 곳에서 파일이 변경됐습니다. 원본을 덮어쓰지 않았습니다."})
                    if self.headers.get("If-None-Match") == "*" and path.exists():
                        return self.reply(409, {"error": "file already exists"})
                    fd, temporary = tempfile.mkstemp(prefix=".pkos-write-", dir=path.parent)
                    with os.fdopen(fd, "wb") as stream:
                        remaining = length
                        while remaining:
                            chunk = self.rfile.read(min(remaining, 1024 * 1024))
                            if not chunk:
                                raise ValueError("incomplete upload")
                            stream.write(chunk)
                            remaining -= len(chunk)
                        stream.flush()
                        os.fsync(stream.fileno())
                    if store.path(raw) != path:
                        raise ValueError("destination changed")
                    if expected and file_version(path) != expected:
                        return self.reply(412, {"error": "저장 중 원본이 변경됐습니다. 원본을 덮어쓰지 않았습니다."})
                    os.replace(temporary, path)
                    temporary = None
                    version = file_version(path)
                self.reply(200, {"saved": True, "size": length, "version": version})
            except (OSError, ValueError) as exc:
                self.reply(400, {"error": str(exc)})
            finally:
                if temporary:
                    Path(temporary).unlink(missing_ok=True)

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.preview_jobs = previews
    return server


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--state", required=True)
    parser.add_argument("--port", type=int, default=8788)
    args = parser.parse_args()
    store = Store(args.root, args.state)
    threading.Thread(target=store.watch, daemon=True).start()
    server = make_server(store, Path(__file__).resolve().parent.parent, args.port)
    try:
        server.serve_forever()
    finally:
        store.stop.set()
        server.server_close()
