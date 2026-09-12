from pathlib import Path
import tempfile,threading,subprocess,hashlib
from server import Store,make_server
app=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='pkos-ppt-test-') as tmp:
 root=Path(tmp)/'records';root.mkdir();source=root/'legacy.ppt'
 subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',str(app/'local-service/create_presentation_fixture.ps1'),'-Target',str(source)],check=True,timeout=45)
 before=hashlib.sha256(source.read_bytes()).hexdigest()
 store=Store(root,Path(tmp)/'state.json');store.scan();server=make_server(store,app,0)
 worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
 try:
  result=subprocess.run(['node',str(app/'docs/점검도구/구형PPT미리보기.mjs'),f'http://127.0.0.1:{server.server_port}/?localBridge=1'],cwd=app,timeout=100)
  if result.returncode:raise SystemExit(result.returncode)
  assert hashlib.sha256(source.read_bytes()).hexdigest()==before
  print('PASS original legacy PPT bytes unchanged')
 finally:
  server.shutdown();server.server_close();worker.join()
  for job in server.preview_jobs.jobs.values():job["process"].wait(timeout=45)
