from pathlib import Path
import tempfile,json,threading,subprocess
from server import Store,make_server
app=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory() as tmp:
 root=Path(tmp)/'records';(root/'old').mkdir(parents=True)
 (root/'old/note.md').write_text('---\nid: fixture-note\ntitle: 이름 시험\ntags: ["old"]\ntype: 자료\n---\n\n본문 그대로\n',encoding='utf-8')
 (root/'PKOS-index.json').write_text(json.dumps({'entries':[],'deleted':[]}),encoding='utf-8')
 store=Store(root,Path(tmp)/'state.json');store.scan();server=make_server(store,app,0);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 try:
  result=subprocess.run(['node',str(app/'docs/점검도구/외부파일이름.mjs'),f'http://127.0.0.1:{server.server_port}/?localBridge=1'],cwd=app)
  if result.returncode:raise SystemExit(result.returncode)
  assert (root/'old/note.md').read_text(encoding='utf-8').endswith('본문 그대로\n')
  print('PASS actual filesystem and browser rename')
 finally:server.shutdown();server.server_close()
