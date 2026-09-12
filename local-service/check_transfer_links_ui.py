from pathlib import Path
import tempfile,threading,subprocess
from server import Store,make_server
app=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix="pkos-transfer-links-") as tmp:
 root=Path(tmp)/"records";root.mkdir()
 store=Store(root,Path(tmp)/"state.json");store.scan()
 server=make_server(store,app,0);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 try:
  result=subprocess.run(["node",str(app/"docs/점검도구/첨부이동연결.mjs"),f"http://127.0.0.1:{server.server_port}/?localBridge=1"],cwd=app)
  if result.returncode:raise SystemExit(result.returncode)
  assert (root/"link-move/target/data.png").read_bytes()==bytes([1,2,3,4])
  assert "![그림](../target/data.png)" in (root/"link-move/source/note.md").read_text(encoding="utf-8")
  print("PASS actual PC filesystem preserves moved attachment references")
 finally:server.shutdown();server.server_close();thread.join()
