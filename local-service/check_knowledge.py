from pathlib import Path
import tempfile,threading,subprocess,struct,zlib,wave
from server import Store,make_server
app=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='pkos-editor-media-') as tmp:
 root=Path(tmp)/'records';root.mkdir()
 def chunk(t,b):return struct.pack('>I',len(b))+t+b+struct.pack('>I',zlib.crc32(t+b)&0xffffffff)
 rows=b''.join(b'\0'+bytes(v for x in range(64) for v in ((255,255,255) if (x+y)%2 else (0,0,0))) for y in range(48))
 png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',64,48,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b'')
 (root/'sample.png').write_bytes(png)
 (root/'photo.md').write_text('---\nid: photo-test\ntitle: Photo\ntype: 자료\ntags: [test]\n---\n\n# Photo\n\n![photo](sample.png)\n',encoding='utf-8')
 source=Path(tmp)/'incoming.png';source.write_bytes(png)
 audio=Path(tmp)/'sample.wav'
 with wave.open(str(audio),'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(8000);w.writeframes(b'\0'*16000)
 (root/'예전폴더태그').mkdir();(root/'예전폴더태그/untagged.md').write_text('---\nid: untagged-source\ntitle: Untagged source\ntype: 미선택\ntags: []\n---\n\nEmpty tag source\n',encoding='utf-8')
 store=Store(root,Path(tmp)/'state.json');store.scan();server=make_server(store,app,0);threading.Thread(target=server.serve_forever,daemon=True).start()
 try:
  result=subprocess.run(['node',str(app/'docs/점검도구/지식탐색.mjs'),'http://127.0.0.1:'+str(server.server_port)+'/?localBridge=1',str(source),str(audio)],cwd=app,timeout=120)
  raise SystemExit(result.returncode)
 finally:server.shutdown();server.server_close()
