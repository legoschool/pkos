from pathlib import Path
import tempfile,threading,subprocess,hashlib,shutil,zipfile,io,base64
from server import Store,make_server
from legacy_document import read_hwp
app=Path(__file__).resolve().parent.parent
fixtures=Path((app/'local-service/runtime/legacy-test-root.txt').read_text(encoding='utf-8'))
with tempfile.TemporaryDirectory(prefix='pkos-doc-zip-ui-') as tmp:
 root=Path(tmp)/'records';root.mkdir()
 for ext in ('doc','xls','hwp'):shutil.copyfile(fixtures/('sample.'+ext),root/('sample.'+ext))
 hwp_phrase=next(line.strip() for section in read_hwp(root/'sample.hwp')['sections'] for line in section['lines'] if line.strip())
 before={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in root.iterdir()}
 archive=io.BytesIO()
 with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:z.writestr('nested/note.txt','ZIP BODY TOKEN')
 store=Store(root,Path(tmp)/'state.json');store.scan();server=make_server(store,app,0);worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
 try:
  result=subprocess.run(['node',str(app/'docs/점검도구/구형문서ZIP.mjs'),f'http://127.0.0.1:{server.server_port}/?localBridge=1',base64.b64encode(archive.getvalue()).decode(),hwp_phrase],cwd=app,timeout=220)
  for name,digest in before.items():assert hashlib.sha256((root/name).read_bytes()).hexdigest()==digest
  assert (root/'받은 파일/bundle.zip').read_bytes()==archive.getvalue()
  assert (root/'받은 파일/bundle/nested/note.txt').read_text()=='ZIP BODY TOKEN'
  print('PASS original DOC XLS HWP ZIP bytes unchanged')
  if result.returncode:raise SystemExit(result.returncode)
 finally:
  server.shutdown();server.server_close();worker.join()
  for job in server.preview_jobs.jobs.values():job['process'].wait(timeout=40)
