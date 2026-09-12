"""Explicit user-requested folder/tag renames with rollback on failure."""
import json, os, re, time, tempfile
from pathlib import Path


def replace_bytes(path, data, expected):
    """Publish complete bytes only; never truncate the existing document."""
    fd, temporary = tempfile.mkstemp(prefix='.pkos-write-rename-', dir=path.parent)
    temporary = Path(temporary)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        if path.read_bytes() != expected:
            raise ValueError('저장 중 다른 곳에서 파일을 변경했습니다. 해당 파일을 덮어쓰지 않았습니다.')
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def rename(store, raw, new_name, tag=None):
    if not isinstance(new_name,str) or not new_name.strip() or new_name!=new_name.strip() or re.search(r'[\\/:*?"<>|\x00-\x1f]',new_name) or new_name.endswith(('.', ' ')) or new_name in ('.','..') or new_name.startswith('.'):
        raise ValueError('사용할 수 없는 이름입니다.')
    if re.fullmatch(r'(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?',new_name):
        raise ValueError('Windows 예약 이름은 사용할 수 없습니다.')
    if tag is not None and (not isinstance(tag,str) or not tag):raise ValueError('태그 이름을 확인해 주세요.')
    if not raw and not tag:raise ValueError('연결한 최상위 폴더는 이 메뉴에서 바꿀 수 없습니다.')
    index=store.root/'PKOS-index.json'
    with store.lock:
        original_index=index.read_bytes()
        data=json.loads(original_index.decode('utf-8-sig'))
        old=store.path(raw) if raw else None
        dest=old.with_name(new_name) if old else None
        if old:
            if not old.exists() or old==store.root:raise ValueError('하위 폴더나 파일을 선택해 주세요.')
            if old.is_file():
                if old.name in ('PKOS-index.json','PKOS-settings.json','TRACE-index.json','TRACE-settings.json'):raise ValueError('설정 파일은 이름을 바꿀 수 없습니다.')
                if old.suffix.lower()!=dest.suffix.lower():raise ValueError('파일 확장자는 유지해 주세요.')
            if not dest.resolve().is_relative_to(store.root):raise ValueError('연결한 폴더 밖으로 옮길 수 없습니다.')
            if dest.exists():raise ValueError('같은 이름의 폴더가 있습니다. 다른 이름을 입력해 주세요.')
        new_raw=dest.relative_to(store.root).as_posix() if dest else None
        def pathmap(value):
            if raw and (value==raw or value.startswith(raw+'/')):return new_raw+value[len(raw):]
            return value
        def remap(obj):
            if isinstance(obj,list):return [remap(x) for x in obj]
            if not isinstance(obj,dict):return obj
            out={}
            for k,v in obj.items():
                if k in ('mdId','srcId','fileId','docId','htmlId') and isinstance(v,str) and v.startswith('local:'):v='local:'+pathmap(v[6:])
                elif k in ('localDir',) and isinstance(v,str):v=pathmap(v)
                elif k in ('srcPath','deskPath') and isinstance(v,list):v=pathmap('/'.join(v)).split('/') if v else []
                elif k=='tags' and isinstance(v,list) and tag:v=list(dict.fromkeys(new_name if x==tag else x for x in v))
                else:v=remap(v)
                out[k]=v
            if isinstance(obj.get('fileId'),str) and out.get('fileId')!=obj['fileId']:out['name']=new_name
            if isinstance(obj.get('mdId'),str) and out.get('mdId')!=obj['mdId'] and old and old.is_file():out['mdName']=new_name
            return out
        modified=[]; backups={};writes={};now=int(time.time()*1000)
        for n in data.get('entries',[]):
            revised=remap(n)
            changed=revised!=n
            if changed:revised['updatedAt']=now
            if tag and tag in n.get('tags',[]) and str(n.get('mdId','')).startswith('local:'):
                p=store.path(n['mdId'][6:]);original=p.read_bytes();text=original.decode('utf-8-sig')
                header=re.match(r'^(---\r?\n)(.*?)(\r?\n---(?:\r?\n|$))',text,re.S)
                if not header or not re.search(r'^tags:\s*\[[^\r\n]*\]\s*$',header[2],re.M):
                    raise ValueError('태그 형식을 확인하지 못했습니다. 원본을 보존했습니다: '+p.name)
                h=re.sub(r'^tags:[^\r\n]*','tags: '+json.dumps(revised['tags'],ensure_ascii=False),header[2],flags=re.M)
                replaced=header[1]+h+header[3]+text[header.end():]
                encoded=replaced.encode('utf-8')
                if original.startswith(b'\xef\xbb\xbf'):encoded=b'\xef\xbb\xbf'+encoded
                backups[p]=original;writes[p]=encoded
            if old and old.is_file() and any(b.get('fileId')=='local:'+raw for b in n.get('blocks',[])) and str(n.get('mdId','')).startswith('local:'):
                p=store.path(n['mdId'][6:]);original=p.read_bytes();text=original.decode('utf-8-sig')
                from urllib.parse import quote
                for before,after in [(old.name,new_name),(quote(old.name),quote(new_name))]:
                    text=re.sub(r'([/\("\'])'+re.escape(before)+r'(?=[\)"\'#?])',lambda m:m[1]+after,text)
                encoded=text.encode('utf-8')
                if original.startswith(b'\xef\xbb\xbf'):encoded=b'\xef\xbb\xbf'+encoded
                if encoded!=original:backups[p]=original;writes[p]=encoded
            n.clear();n.update(revised)
            if changed:modified.append(n)
        renamed=False;touched=[]
        try:
            for p,b in backups.items():
                if p.read_bytes()!=b:raise ValueError('작업 중 원본이 바뀌었습니다. 다시 시도해 주세요.')
            if index.read_bytes()!=original_index:raise ValueError('다른 창에서 기록을 변경했습니다. 다시 시도해 주세요.')
            if old:old.rename(dest);renamed=True
            for p,b in writes.items():
                current=store.path(pathmap(p.relative_to(store.root).as_posix()))
                replace_bytes(current, b, backups[p])
                touched.append(p)
            for n in modified:
                ident=n.get('mdId','')
                if ident.startswith('local:'):
                    p=store.path(ident[6:])
                    if p.exists():n['localMtime']=p.stat().st_mtime_ns//1000000
            replace_bytes(index, json.dumps(data,ensure_ascii=False).encode('utf-8'), original_index)
        except Exception:
            if renamed:dest.rename(old)
            for p in touched:replace_bytes(p, backups[p], writes[p])
            raise
        return {'renamed':bool(old),'oldPath':raw,'newPath':new_raw,'tag':tag,'name':new_name,'updatedRecords':len(modified)}
