from pathlib import Path
import tempfile,json,threading,subprocess,base64
from server import Store,make_server
app=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory() as tmp:
 root=Path(tmp)/'records';(root/'old').mkdir(parents=True)
 (root/'old/note.md').write_text('---\nid: fixture-note\ntitle: 이름 시험\ntags: ["old"]\ntype: 자료\n---\n\n본문 그대로\n',encoding='utf-8')
 (root/'old/nested').mkdir()
 fixture=json.loads((app/'docs/점검도구/문서-fixtures.json').read_text(encoding='utf-8'))
 (root/'old/nested/연수자료.docx').write_bytes(base64.b64decode(fixture['sample.docx']))
 with (root/'old/note.md').open('a',encoding='utf-8') as stream:stream.write('\n📎 [연수자료.docx](nested/연수자료.docx)\n')
 original_body=(root/'old/note.md').read_text(encoding='utf-8').split('---\n',2)[-1]
 (root/'PKOS-index.json').write_text(json.dumps({'entries':[],'deleted':[]}),encoding='utf-8')
 store=Store(root,Path(tmp)/'state.json');store.scan();server=make_server(store,app,0);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 try:
  result=subprocess.run(['node',str(app/'docs/점검도구/태그폴더이름.mjs'),f'http://127.0.0.1:{server.server_port}/?localBridge=1'],cwd=app)
  if result.returncode:raise SystemExit(result.returncode)
  assert (root/'final/note.md').read_text(encoding='utf-8').split('---\n',2)[-1]==original_body
  assert (root/'final/nested/연수자료.docx').read_bytes()==base64.b64decode(fixture['sample.docx'])
  print('PASS actual filesystem and browser rename')
 finally:server.shutdown();server.server_close()
