"""Real process-exit tests for the private rename journal."""
import json,subprocess,sys,tempfile,unittest
from pathlib import Path
from server import Store, make_server
from rename_journal import location
CHILD = r"""
import os,sys
from pathlib import Path
from server import Store
import rename_ops,rename_journal
store=Store(sys.argv[1],sys.argv[2]);stage=sys.argv[3]
if stage=='prepared':
 original=rename_journal.prepare
 def prepare(*args):
  original(*args);os._exit(82)
 rename_journal.prepare=prepare
elif stage=='folder':
 original=Path.rename
 def move(self,target):
  result=original(self,target)
  if self==store.root/'old':os._exit(82)
  return result
 Path.rename=move
elif stage=='intent':
 original=rename_journal.commit_intent
 def intent(*args):
  original(*args);os._exit(82)
 rename_journal.commit_intent=intent
else:
 original=rename_ops.replace_bytes
 def publish(path,*args):
  result=original(path,*args)
  if (stage in ('document','recovery') and path.name=='note.md') or (stage=='index' and path.name=='PKOS-index.json'):os._exit(82)
  return result
 rename_ops.replace_bytes=publish
if stage=='recovery':store.scan()
else:rename_ops.rename(store,'old','new','old')
"""
class RecoveryTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='pkos-crash-test-');self.addCleanup(self.tmp.cleanup)
  self.base=Path(self.tmp.name);self.root=self.base/'records';(self.root/'old').mkdir(parents=True);self.state=self.base/'private/state.json'
  self.original=b'---\nid: first\ntags: ["old"]\n---\nORIGINAL CONTENT\n';self.binary=bytes(range(256))*32
  (self.root/'old/note.md').write_bytes(self.original);(self.root/'old/other.md').write_bytes(self.original.replace(b'first',b'second'));(self.root/'old/file.bin').write_bytes(self.binary)
  entries=[{'id':ident,'tags':['old'],'mdId':'local:old/'+name,'blocks':[{'fileId':'local:old/file.bin'}]} for ident,name in [('first','note.md'),('second','other.md')]]
  (self.root/'outside').mkdir();self.outside=b'[file](../old/file.bin)\r\n';(self.root/'outside/ref.md').write_bytes(self.outside)
  entries.append({'id':'outside','mdId':'local:outside/ref.md','blocks':[]})
  self.index=json.dumps({'entries':entries}).encode();(self.root/'PKOS-index.json').write_bytes(self.index)
 def kill_at(self,stage):
  p=subprocess.run([sys.executable,'-c',CHILD,str(self.root),str(self.state),stage],cwd=Path(__file__).parent,capture_output=True,timeout=15)
  self.assertEqual(p.returncode,82,p.stderr.decode(errors='replace'))
 def restart(self):
  store=Store(self.root,self.state);store.scan();return store
 def assert_restored(self,store):
  self.assertEqual((self.root/'outside/ref.md').read_bytes(),self.outside)
  self.assertTrue(store.snapshot['ready'],store.snapshot);self.assertFalse((self.root/'new').exists())
  self.assertEqual((self.root/'old/note.md').read_bytes(),self.original);self.assertEqual((self.root/'old/other.md').read_bytes(),self.original.replace(b'first',b'second'))
  self.assertEqual((self.root/'old/file.bin').read_bytes(),self.binary);self.assertEqual((self.root/'PKOS-index.json').read_bytes(),self.index);self.assertFalse(location(store).exists())
 def test_crash_after_journal(self):
  self.kill_at('prepared');self.assert_restored(self.restart())
 def test_crash_after_folder(self):
  self.kill_at('folder');self.assert_restored(self.restart())
 def test_crash_after_document(self):
  self.kill_at('document');self.assert_restored(self.restart())
 def test_crash_after_intent(self):
  self.kill_at('intent');self.assert_restored(self.restart())
 def test_crash_after_index_keeps_commit(self):
  self.kill_at('index');store=self.restart();self.assertTrue(store.snapshot['ready']);self.assertFalse((self.root/'old').exists())
  self.assertEqual((self.root/'outside/ref.md').read_bytes(),self.outside.replace(b'../old/',b'../new/'))
  self.assertIn(b'tags: ["new"]',(self.root/'new/note.md').read_bytes());self.assertEqual((self.root/'new/file.bin').read_bytes(),self.binary)
  self.assertEqual(json.loads((self.root/'PKOS-index.json').read_text())['entries'][0]['mdId'],'local:new/note.md');self.assertFalse(location(store).exists())
 def test_recovery_interrupted_again(self):
  self.kill_at('intent');self.kill_at('recovery');self.assert_restored(self.restart())
 def test_external_document_preserved(self):
  self.kill_at('document');changed=b'EXTERNAL CONTENT';(self.root/'new/note.md').write_bytes(changed);store=self.restart()
  self.assertFalse(store.snapshot['ready']);self.assertTrue(location(store).exists());self.assertEqual((self.root/'new/note.md').read_bytes(),changed)
  self.assertEqual((self.root/'PKOS-index.json').read_bytes(),self.index)
  (self.root/'new/note.md').write_bytes(self.original);self.assert_restored(self.restart())
 def test_unresolved_recovery_blocks_http_writes(self):
  from urllib.request import Request,urlopen
  from urllib.error import HTTPError
  import threading
  self.kill_at('document');(self.root/'new/note.md').write_bytes(b'EXTERNAL')
  store=self.restart();server=make_server(store,Path(__file__).resolve().parent.parent,0)
  worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
  try:
   for path,method,body in [('/api/file?path=extra.txt','PUT',b'NEW'),('/api/directory?path=extra','POST',b''),('/api/entry?path=new/file.bin','DELETE',None),('/api/rename','POST',b'{"path":"new","name":"third"}')]:
    req=Request('http://127.0.0.1:'+str(server.server_port)+path,data=body,method=method,headers={'X-PKOS-Local':'1'})
    with self.assertRaises(HTTPError) as err:urlopen(req,timeout=5)
    self.assertEqual(err.exception.code,400);err.exception.close()
  finally:server.shutdown();server.server_close();worker.join()
  self.assertEqual((self.root/'new/note.md').read_bytes(),b'EXTERNAL');self.assertEqual((self.root/'new/file.bin').read_bytes(),self.binary)
  self.assertFalse((self.root/'extra.txt').exists());self.assertFalse((self.root/'extra').exists());self.assertFalse((self.root/'third').exists())
 def test_external_index_preserved(self):
  self.kill_at('document');changed=b'{"entries":[],"external":true}';(self.root/'PKOS-index.json').write_bytes(changed);store=self.restart()
  self.assertFalse(store.snapshot['ready']);self.assertEqual((self.root/'PKOS-index.json').read_bytes(),changed);self.assertTrue(location(store).exists())
 def test_malformed_journal_blocks_without_changing_records(self):
  store=Store(self.root,self.state);path=location(store);path.parent.mkdir(parents=True);path.write_bytes(b'[]');store.scan()
  self.assertFalse(store.snapshot['ready']);self.assertEqual((self.root/'old/note.md').read_bytes(),self.original)
  self.assertEqual((self.root/'PKOS-index.json').read_bytes(),self.index);self.assertEqual(path.read_bytes(),b'[]')
 def test_recreated_old_path_preserved(self):
  self.kill_at('folder');(self.root/'old').mkdir();(self.root/'old/user.txt').write_bytes(b'USER');store=self.restart();self.assertFalse(store.snapshot['ready'])
  self.assertEqual((self.root/'old/user.txt').read_bytes(),b'USER');self.assertEqual((self.root/'new/file.bin').read_bytes(),self.binary);self.assertTrue(location(store).exists())
if __name__=='__main__':unittest.main(verbosity=2)
