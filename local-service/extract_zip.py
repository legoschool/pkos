"""Extract into a private staging folder, then publish a new sibling directory."""
import os,re,stat,tempfile,zipfile,shutil
from pathlib import Path,PurePosixPath
MAX_BYTES=512*1024*1024
RESERVED=re.compile(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)',re.I)
def member_parts(info):
 name=info.orig_filename
 if '\\' in name or name.startswith('/') or '\x00' in name:raise ValueError('안전하지 않은 ZIP 경로입니다.')
 parts=name.rstrip('/').split('/')
 if not parts or any(not p or p in ('.','..') or re.search(r'[<>:"|?*\x00-\x1f]',p) or p.endswith((' ','.')) or RESERVED.match(p) for p in parts):raise ValueError('사용할 수 없는 ZIP 파일 경로입니다.')
 mode=info.external_attr>>16
 if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0,stat.S_IFREG,stat.S_IFDIR)):raise ValueError('ZIP의 링크와 특수 파일은 풀지 않습니다.')
 if info.flag_bits&1:raise ValueError('암호 ZIP은 압축 프로그램에서 직접 풀어 주세요.')
 return parts

def extract(store,raw):
 source=store.path(raw)
 if source.suffix.lower()!='.zip' or not source.is_file():raise ValueError('ZIP 파일을 선택해 주세요.')
 if source.stat().st_size>128*1024*1024:raise ValueError('128MB 이하 ZIP만 자동으로 풉니다.')
 stage=None
 try:
  with source.open('rb') as stream,zipfile.ZipFile(stream) as archive:
   before=os.fstat(stream.fileno());infos=archive.infolist()
   if len(infos)>2000:raise ValueError('ZIP 항목이 2,000개를 넘습니다.')
   seen=set();plan=[];total=0
   for info in infos:
    parts=member_parts(info);key='/'.join(parts).casefold()
    if key in seen:raise ValueError('ZIP 안에 같은 이름의 항목이 겹칩니다.')
    seen.add(key);total+=info.file_size
    if total>MAX_BYTES:raise ValueError('압축 해제 크기가 512MB를 넘습니다.')
    plan.append((info,parts))
   stage=Path(tempfile.mkdtemp(prefix='.pkos-write-unzip-',dir=source.parent))
   written=0
   for info,parts in plan:
    dest=stage.joinpath(*parts)
    if info.is_dir():dest.mkdir(parents=True,exist_ok=True);continue
    dest.parent.mkdir(parents=True,exist_ok=True)
    with archive.open(info) as reader,dest.open('xb') as writer:
     count=0
     while chunk:=reader.read(1024*1024):
      count+=len(chunk);written+=len(chunk)
      if count>info.file_size or written>MAX_BYTES:raise ValueError('압축 해제 크기 제한을 넘었습니다.')
      writer.write(chunk)
     writer.flush();os.fsync(writer.fileno())
   current=source.stat()
   if (current.st_ino,current.st_mtime_ns,current.st_size)!=(before.st_ino,before.st_mtime_ns,before.st_size):raise ValueError('ZIP 원본이 변경됐습니다. 다시 시도해 주세요.')
   for number in range(1,10001):
    target=source.with_name(source.stem+('' if number==1 else ' ('+str(number)+')'))
    if target.exists():continue
    try:stage.rename(target);stage=None;break
    except FileExistsError:continue
   else:raise ValueError('저장할 폴더 이름을 만들지 못했습니다.')
   return {'folder':target.relative_to(store.root).as_posix(),'files':sum(not i.is_dir() for i in infos),'bytes':written}
 except (zipfile.BadZipFile,NotImplementedError,RuntimeError) as e:raise ValueError('ZIP을 풀지 못했습니다. 파일 손상·암호·압축 방식을 확인해 주세요.') from e
 finally:
  if stage is not None:
   # Only this invocation's freshly created staging directory can be removed.
   if stage.parent==source.parent and stage.name.startswith('.pkos-write-unzip-') and stage.resolve().is_relative_to(store.root):shutil.rmtree(stage)
