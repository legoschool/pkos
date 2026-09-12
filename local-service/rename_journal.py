"""Private write-ahead journal for interrupted explicit renames."""
import base64
import hashlib
import json
import os
from pathlib import Path
import tempfile


def location(store):
    root_key = hashlib.sha256(str(store.root).encode("utf-8")).hexdigest()[:20]
    return Path(store.state).parent / ("rename-" + root_key + ".json")


def persist(store, payload):
    path = location(store)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".rename-journal-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def encode(data):
    return base64.b64encode(data).decode("ascii")


def decode(data):
    return base64.b64decode(data, validate=True)


def prepare(store, old_path, new_path, backups, writes, original_index):
    if location(store).exists():
        raise ValueError("이전 이름 변경의 복구가 아직 끝나지 않았습니다.")
    identity = None
    if old_path:
        stat = store.path(old_path).stat()
        identity = [stat.st_dev, stat.st_ino]
    payload = {"version": 1, "root": str(store.root), "old": old_path,
               "new": new_path, "identity": identity,
               "indexBefore": encode(original_index), "indexAfter": None,
               "documents": [{"path": p.relative_to(store.root).as_posix(),
                              "before": encode(backups[p]), "after": encode(data)}
                             for p, data in writes.items()]}
    persist(store, payload)
    return payload


def commit_intent(store, payload, data):
    payload["indexAfter"] = encode(data)
    persist(store, payload)


def finish(store):
    location(store).unlink(missing_ok=True)


def recover(store):
    """Idempotent rollback, or retain a completed index publication. Caller holds lock."""
    path = location(store)
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict) or payload.get("version") != 1 or payload.get("root") != str(store.root):
            raise ValueError("복구 기록의 폴더 정보가 다릅니다.")
        index = store.root / "PKOS-index.json"
        before = decode(payload["indexBefore"])
        after = decode(payload["indexAfter"]) if payload["indexAfter"] is not None else None
        current_index = index.read_bytes()
        if after is not None and current_index == after:
            finish(store)
            return "committed"
        if current_index != before:
            raise ValueError("색인이 외부에서 변경됐습니다.")
        raw, new_raw = payload["old"], payload["new"]
        moved = False
        if raw:
            old, destination = store.path(raw), store.path(new_raw)
            if old.exists() == destination.exists():
                raise ValueError("원래 경로와 새 경로를 구분하지 못했습니다.")
            current = old if old.exists() else destination
            stat = current.stat()
            if [stat.st_dev, stat.st_ino] != payload["identity"]:
                raise ValueError("이름 변경 대상이 다른 파일로 바뀌었습니다.")
            moved = current == destination
        planned = []
        for document in payload["documents"]:
            relative = document["path"]
            # Validate both original and remapped paths before any writes.
            store.path(relative)
            mapped = new_raw + relative[len(raw):] if moved and (relative == raw or relative.startswith(raw + "/")) else relative
            target = store.path(mapped)
            original, replacement = decode(document["before"]), decode(document["after"])
            observed = target.read_bytes()
            if observed not in (original, replacement):
                raise ValueError("외부에서 수정된 문서가 있습니다: " + relative)
            planned.append((target, original, replacement, observed))
        from rename_ops import replace_bytes
        for target, original, replacement, observed in planned:
            if observed != original:
                replace_bytes(target, original, replacement)
        if moved:
            # Never overwrite a path created by another program during recovery.
            if old.exists():
                raise ValueError("복구 도중 원래 이름의 파일이 생겼습니다.")
            stat = destination.stat()
            if [stat.st_dev, stat.st_ino] != payload["identity"]:
                raise ValueError("복구 도중 대상이 다른 파일로 바뀌었습니다.")
            destination.rename(old)
        if index.read_bytes() != before:
            raise ValueError("복구 도중 색인이 변경됐습니다.")
        finish(store)
        return "rolled_back"
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise ValueError("이름 변경 복구를 멈췄습니다. 원본과 복구 기록은 보존했습니다. " + str(exc)) from exc
