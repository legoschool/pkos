import json
import os
import socket
import hashlib
import http.client
from unittest.mock import patch
from pathlib import Path
import tempfile
import threading
import time
import unittest
import subprocess
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from server import Store, make_server, file_version
from urllib.parse import urlsplit, parse_qs


class BridgeTests(unittest.TestCase):
    @staticmethod
    def cleanup_test_browsers():
        """Windows에서 강제 종료된 Node 검사가 남긴 시험용 Edge만 닫는다."""
        if os.name != "nt":
            return
        command = (
            "$items=Get-CimInstance Win32_Process | Where-Object { "
            "$_.Name -in @('msedge.exe','chrome.exe') -and $_.CommandLine -match 'pkos-smoke-' }; "
            "$items | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
        )
        subprocess.run(["powershell.exe", "-NoProfile", "-Command", command],
                       capture_output=True, timeout=20, check=False)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="pkos-bridge-test-")
        self.base = Path(self.tmp.name)
        self.root = self.base / "records"
        self.root.mkdir()
        self.store = Store(self.root, self.base / "state.json")
        self.server = make_server(self.store, Path(__file__).resolve().parent.parent, 0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = "http://127.0.0.1:" + str(self.server.server_port)

    def tearDown(self):
        self.store.stop.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.tmp.cleanup()

    def call(self, path, method="GET", body=None, headers=None):
        try:
            response = urlopen(Request(self.url + path, data=body, method=method, headers=headers or {}), timeout=5)
        except HTTPError as error:
            response = error
        with response:
            return response.status, response.read()

    def test_binary_and_collision(self):
        blob = bytes(range(256)) * 4096
        headers = {"X-PKOS-Local": "1", "If-None-Match": "*"}
        self.assertEqual(self.call("/api/file?path=data.bin", "PUT", blob, headers)[0], 200)
        self.assertEqual(self.call("/api/file?path=data.bin"), (200, blob))
        self.assertEqual(self.call("/api/file?path=data.bin", "PUT", b"replacement", headers)[0], 409)
        self.assertEqual((self.root / "data.bin").read_bytes(), blob)

    def test_metadata_does_not_open_file_content(self):
        path = self.root / 'metadata.bin'
        path.write_bytes(b'only metadata is needed')
        with patch.object(Path, 'open', side_effect=AssertionError('content read')):
            status, body = self.call('/api/stat?path=metadata.bin')
        self.assertEqual(status, 200)
        info = json.loads(body)
        self.assertEqual(info['size'], path.stat().st_size)
        self.assertEqual(info['lastModified'], path.stat().st_mtime_ns // 1000000)
        self.assertEqual(info['version'], file_version(path))

    def test_http_connection_is_reused_for_folder_scans(self):
        (self.root / 'keep.txt').write_text('content', encoding='utf-8')
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        try:
            conn.request('GET', '/api/stat?path=keep.txt')
            first = conn.getresponse()
            self.assertEqual(first.status, 200)
            first.read()
            sock = conn.sock
            self.assertIsNotNone(sock)
            conn.request('GET', '/api/file?path=keep.txt')
            second = conn.getresponse()
            self.assertEqual(second.read(), b'content')
            self.assertIs(conn.sock, sock)
        finally:
            conn.close()

    def test_stale_writer_preserves_newer_file(self):
        path = self.root / "conflict.txt"
        path.write_bytes(b"original")
        first = json.loads(self.call("/api/stat?path=conflict.txt")[1])["version"]
        headers = {"X-PKOS-Local": "1", "If-Match": first}
        status, body = self.call("/api/file?path=conflict.txt", "PUT", b"first writer", headers)
        self.assertEqual(status, 200)
        self.assertNotEqual(json.loads(body)["version"], first)
        self.assertEqual(self.call("/api/file?path=conflict.txt", "PUT", b"stale writer", headers)[0], 412)
        self.assertEqual(path.read_bytes(), b"first writer")
        path.unlink()
        self.assertEqual(self.call("/api/file?path=conflict.txt", "PUT", b"resurrect", headers)[0], 412)
        self.assertFalse(path.exists())

    def test_read_version_after_atomic_replace(self):
        headers = {"X-PKOS-Local": "1"}
        for content in (b"first", b"second", b"third"):
            self.assertEqual(self.call("/api/file?path=version.txt", "PUT", content, headers)[0], 200)
            with urlopen(self.url + "/api/file?path=version.txt") as response:
                version = response.headers["ETag"]
                response.read()
            self.assertEqual(version, file_version(self.root / "version.txt"))
            headers["If-Match"] = version

    def test_interrupted_upload_preserves_original(self):
        for name, original in (("existing.bin", b"ORIGINAL"), ("new.bin", None)):
            with self.subTest(name=name):
                path = self.root / name
                if original is not None:
                    path.write_bytes(original)
                with socket.create_connection(("127.0.0.1", self.server.server_port), timeout=5) as connection:
                    head = ("PUT /api/file?path=" + name + " HTTP/1.1\r\nHost: 127.0.0.1:" + str(self.server.server_port) +
                            "\r\nX-PKOS-Local: 1\r\nContent-Length: 1048576\r\nConnection: close\r\n\r\n")
                    connection.sendall(head.encode("ascii") + b"INCOMPLETE")
                    connection.shutdown(socket.SHUT_WR)
                    response = b""
                    while chunk := connection.recv(4096):
                        response += chunk
                self.assertIn(b"400", response.split(b"\r\n", 1)[0])
                if original is not None:
                    self.assertEqual(path.read_bytes(), original)
                else:
                    self.assertFalse(path.exists())
                self.assertEqual(list(self.root.glob(".pkos-write-*")), [])
                self.assertEqual(self.call("/api/file?path=" + name, "PUT", b"RETRIED", {"X-PKOS-Local":"1"})[0], 200)
                self.assertEqual(path.read_bytes(), b"RETRIED")

    def test_replace_failure_preserves_original(self):
        path = self.root / "protected.bin"
        path.write_bytes(b"ORIGINAL")
        with patch("server.os.replace", side_effect=PermissionError("injected disk failure")):
            status, _ = self.call("/api/file?path=protected.bin", "PUT", b"REPLACEMENT", {"X-PKOS-Local":"1"})
        self.assertEqual(status, 400)
        self.assertEqual(path.read_bytes(), b"ORIGINAL")
        self.assertEqual(list(self.root.glob(".pkos-write-*")), [])

    def test_32_mib_binary_roundtrip(self):
        blob = bytes(range(256)) * (128 * 1024)
        status, body = self.call("/api/file?path=32mib.bin", "PUT", blob, {"X-PKOS-Local":"1"})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["size"], len(blob))
        status, readback = self.call("/api/file?path=32mib.bin")
        self.assertEqual(status, 200)
        self.assertEqual(hashlib.sha256(readback).digest(), hashlib.sha256(blob).digest())

    def test_scope_and_origin(self):
        for path in ("../outside.txt", "%2e%2e/outside.txt", "C%3A/private.txt", "a%5Cb.txt"):
            self.assertEqual(self.call("/api/file?path=" + path)[0], 400)
        self.assertEqual(self.call("/api/file?path=x", "PUT", b"x")[0], 403)
        self.assertEqual(self.call("/api/file?path=x", "PUT", b"x", {"X-PKOS-Local":"1", "Origin":"https://elsewhere.invalid"})[0], 403)
        self.assertEqual(self.call("/api/status", headers={"Host":"elsewhere.invalid"})[0], 403)
        self.assertFalse((self.root / "x").exists())

    def test_background_changes_without_browser(self):
        worker = threading.Thread(target=self.store.watch)
        worker.start()
        try:
            (self.root / "note.txt").write_text("first", encoding="utf-8")
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if any(f["path"] == "note.txt" for f in self.store.snapshot["files"]):
                    break
                time.sleep(.05)
            self.assertTrue(any(f["path"] == "note.txt" for f in self.store.snapshot["files"]))
            (self.root / "note.txt").write_text("second changed", encoding="utf-8")
            time.sleep(2.2)
            self.assertIn("note.txt", self.store.snapshot["changes"]["modified"])
            (self.root / "note.txt").unlink()
            time.sleep(2.2)
            self.assertIn("note.txt", self.store.snapshot["changes"]["removed"])
            saved = json.loads(self.store.state.read_text(encoding="utf-8"))
            self.assertTrue(saved["ready"])
            self.assertEqual(saved["files"], [])
        finally:
            self.store.stop.set()
            worker.join()

    def test_browser_integration(self):
        self.store.scan()
        app = Path(__file__).resolve().parent.parent
        test = app / "docs" / "점검도구" / "PC폴더연결.mjs"
        url = self.url + "/?localBridge=1"
        first = subprocess.run(["node", str(test), url], capture_output=True, text=True, encoding="utf-8", timeout=60)
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        attachments = [p for p in self.root.rglob("*.txt") if p.read_text() == "BRIDGE-ORIGINAL"]
        self.assertEqual(len(attachments), 1)
        self.assertNotEqual(attachments[0].parent, self.root)
        self.assertTrue((self.root / "PKOS-index.json").is_file())
        # The browser process has exited; change a real disk file before reopening.
        (self.root / "while-closed.txt").write_text("ADDED-WITHOUT-BROWSER", encoding="utf-8")
        self.store.scan()
        second = subprocess.run(["node", str(test), url, "--reopen"], capture_output=True, text=True, encoding="utf-8", timeout=60)
        self.assertEqual(second.returncode, 0, second.stdout + second.stderr)

    def test_two_browser_writers(self):
        self.two_browser_writers(True)

    def test_two_browsers_first_connection(self):
        self.two_browser_writers(False)

    def two_browser_writers(self, seed):
        self.cleanup_test_browsers()
        if seed:
            (self.root / "PKOS-index.json").write_text(json.dumps({"version":3,"app":"PKOS","entries":[],"deleted":[]}), encoding="utf-8")
        trace = []
        original_put = self.server.RequestHandlerClass.do_PUT
        def traced(handler):
            raw = parse_qs(urlsplit(handler.path).query).get("path", [""])[0]
            if raw == "PKOS-index.json":
                trace.append({"expected": handler.headers.get("If-Match"), "actual": file_version(self.root / raw)})
            return original_put(handler)
        self.server.RequestHandlerClass.do_PUT = traced
        self.store.scan()
        app = Path(__file__).resolve().parent.parent
        script = app / "docs" / "점검도구" / "두창동시저장.mjs"
        processes = []
        try:
            for label in ("window-A", "window-B"):
                processes.append(subprocess.Popen(["node", str(script), self.url + "/?localBridge=1", label, str(self.base)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8"))
                # Windows에서 두 Edge 엔진을 같은 순간에 시작하면 한쪽 CDP가 멎는 경우가 있다.
                # 연결과 저장은 겹치되 프로세스 생성만 짧게 나눈다.
                time.sleep(.6)
            # Google Drive 경로의 첫 브라우저 실행은 엔진과 PDF 자산을 내려받느라
            # 25초를 넘길 수 있다. 제품 쓰기 제한 시간과 별개인 시험 준비 시간이다.
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline and not all((self.base / (label + ".ready")).exists() for label in ("window-A", "window-B")):
                if any(p.poll() is not None for p in processes):
                    break
                time.sleep(.1)
            ready = all((self.base / (label + ".ready")).exists() for label in ("window-A", "window-B"))
            if not ready:
                diagnostics = []
                for label in ("window-A", "window-B"):
                    stage = self.base / (label + ".stage")
                    diagnostics.append(label + ": " + (stage.read_text(encoding="utf-8") if stage.exists() else "시험 브라우저 시작 전"))
                for process in processes:
                    if process.poll() is not None:
                        out, err = process.communicate(timeout=5)
                        diagnostics.append(out + err)
                self.fail("both browsers must be ready\n" + "\n".join(diagnostics))
            (self.base / "go").write_text("go")
            for process in processes:
                out, err = process.communicate(timeout=40)
                self.assertEqual(process.returncode, 0, out + err + json.dumps(trace))
            index = json.loads((self.root / "PKOS-index.json").read_text(encoding="utf-8"))
            for label in ("window-A", "window-B"):
                record = next(n for n in index["entries"] if n["title"] == label)
                self.assertTrue((self.root / record["mdId"][6:]).is_file())
                attachment = next(b for b in record["blocks"] if b.get("fileId"))
                self.assertEqual((self.root / attachment["fileId"][6:]).read_text(), "bytes-" + label)
        finally:
            for process in processes:
                if process.poll() is None:
                    process.terminate()
                process.communicate(timeout=10)
            self.cleanup_test_browsers()

    def test_unavailable_root_keeps_last_snapshot(self):
        (self.root / "keep.txt").write_text("keep", encoding="utf-8")
        self.store.scan()
        old = self.store.state.read_bytes()
        self.root.rename(self.base / "temporarily-offline")
        self.store.scan()
        self.assertFalse(self.store.snapshot["ready"])
        self.assertEqual(self.store.snapshot["files"][0]["path"], "keep.txt")
        self.assertEqual(self.store.state.read_bytes(), old)


if __name__ == "__main__":
    unittest.main(verbosity=2)
