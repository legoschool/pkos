from pathlib import Path
import tempfile,threading,subprocess,json,urllib.request
from unittest.mock import patch
from server import Store,make_server
app=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='pkos-file-cards-') as tmp:
 root=Path(tmp)/'records';root.mkdir();(root/'sample.txt').write_text('CARD BODY',encoding='utf-8')
 store=Store(root,Path(tmp)/'state.json');store.scan();server=make_server(store,app,0);threading.Thread(target=server.serve_forever,daemon=True).start()
 base='http://127.0.0.1:'+str(server.server_port)
 try:
  with patch('os.startfile',create=True) as opened:
   req=urllib.request.Request(base+'/api/open-local',data=json.dumps({'path':'sample.txt','action':'open'}).encode(),headers={'X-PKOS-Local':'1','Content-Type':'application/json'})
   with urllib.request.urlopen(req) as response:assert response.status==200
   opened.assert_called_once_with(str(root/'sample.txt'))
  result=subprocess.run(['node',str(app/'docs/점검도구/파일카드.mjs'),base+'/?localBridge=1'],cwd=app,timeout=70)
  assert (root/'sample.txt').read_text()=='CARD BODY'
  raise SystemExit(result.returncode)
 finally:server.shutdown();server.server_close()
