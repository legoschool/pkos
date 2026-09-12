import tempfile, unittest, json, threading
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from rename_ops import rename
class RenameTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);(self.root/'old'/'nested').mkdir(parents=True)
  self.md=b'---\r\nid: r1\r\ntags: ["old"]\r\n---\r\n\r\nKEEP BODY\r\n';(self.root/'old'/'note.md').write_bytes(self.md);(self.root/'old'/'nested'/'file.bin').write_bytes(bytes(range(256)))
  self.store=SimpleNamespace(root=self.root,state=self.root/"state.json",lock=threading.RLock(),path=self.path)
  self.data={'entries':[{'id':'r1','tags':['old'],'mdId':'local:old/note.md','srcId':'local:old/note.md','localDir':'old','srcPath':['old'],'updatedAt':1,'blocks':[{'fileId':'local:old/nested/file.bin'}]}]};self.index=self.root/'PKOS-index.json';self.index.write_text(json.dumps(self.data),encoding='utf-8')
 def path(self,raw):
  p=(self.root/raw).resolve()
  if not p.is_relative_to(self.root):raise ValueError('outside')
  return p
 def test_folder(self):
  rename(self.store,'old','new')
  self.assertFalse((self.root/'old').exists());self.assertEqual((self.root/'new/note.md').read_bytes(),self.md)
  n=json.loads(self.index.read_text())['entries'][0];self.assertEqual(n['blocks'][0]['fileId'],'local:new/nested/file.bin');self.assertEqual(n['srcPath'],['new']);self.assertEqual((self.root/'new/nested/file.bin').read_bytes(),bytes(range(256)))
 def test_folder_preserves_attachment_names_and_extensions(self):
  names=['연수자료.pdf','수업안.pptx','사진.png','기록.hwp']
  blocks=[]
  for name in names:
   (self.root/'old/nested'/name).write_bytes(bytes(range(32)))
   blocks.append({'kind':'file','name':name,'original':name,'fileId':'local:old/nested/'+name})
  self.data['entries'][0]['blocks']=blocks;self.data['entries'][0]['mdName']='note.md'
  self.index.write_text(json.dumps(self.data),encoding='utf-8')
  rename(self.store,'old','새 지식 폴더')
  record=json.loads(self.index.read_text(encoding='utf-8'))['entries'][0]
  self.assertEqual([b['name'] for b in record['blocks']],names)
  self.assertEqual([b['original'] for b in record['blocks']],names)
  self.assertEqual(record['mdName'],'note.md')
  for block in record['blocks']:
   self.assertEqual(block['fileId'],'local:새 지식 폴더/nested/'+block['name'])
   self.assertEqual((self.root/'새 지식 폴더/nested'/block['name']).read_bytes(),bytes(range(32)))
 def test_folder_updates_reference_from_other_folder(self):
  (self.root/'outside').mkdir()
  text='\ufeff---\r\nid: outside\r\n---\r\n[attachment](../old/nested/file.bin)\r\n<!-- [example](../old/nested/file.bin) -->\r\n~~~\r\n[code](../old/nested/file.bin)\r\n~~~\r\n'
  # Escape sequences above are materialized for an exact BOM/CRLF comparison.
  text=text.replace('\\ufeff','\ufeff').replace('\\r','\r').replace('\\n','\n')
  (self.root/'outside/ref.md').write_bytes(text.encode('utf-8'))
  self.data['entries'].append({'id':'outside','mdId':'local:outside/ref.md','blocks':[]})
  self.index.write_text(json.dumps(self.data),encoding='utf-8')
  rename(self.store,'old','new')
  self.assertEqual((self.root/'outside/ref.md').read_bytes(),text.replace('[attachment](../old/','[attachment](../new/').encode('utf-8'))
 def test_file_rename_does_not_change_same_name_elsewhere(self):
  text=self.md+b'[target](nested/file.bin)\n[unrelated](other/file.bin)\n'
  (self.root/'old/note.md').write_bytes(text)
  rename(self.store,'old/nested/file.bin','renamed.bin')
  self.assertEqual((self.root/'old/note.md').read_bytes(),text.replace(b'(nested/file.bin)',b'(nested/renamed.bin)'))
 def test_tag_and_folder(self):
  rename(self.store,'old','new','old');text=(self.root/'new/note.md').read_bytes();self.assertIn(b'tags: ["new"]',text);self.assertEqual(text.split(b'---\r\n')[-1],self.md.split(b'---\r\n')[-1]);n=json.loads(self.index.read_text())['entries'][0];self.assertEqual(n['tags'],['new']);self.assertEqual(n['localMtime'],(self.root/'new/note.md').stat().st_mtime_ns//1000000)
 def test_tag_without_folder(self):
  rename(self.store,'','new','old');self.assertTrue((self.root/'old').exists());self.assertEqual(json.loads(self.index.read_text())['entries'][0]['tags'],['new'])
 def test_collision_preserves(self):
  (self.root/'new').mkdir()
  with self.assertRaises(ValueError):rename(self.store,'old','new','old')
  self.assertEqual((self.root/'old/note.md').read_bytes(),self.md)
 def test_failure_rolls_back(self):
  before=self.index.read_bytes()
  with patch('rename_ops.os.replace',side_effect=OSError('test failure')):
   with self.assertRaises(OSError):rename(self.store,'old','new','old')
  self.assertTrue((self.root/'old').is_dir());self.assertFalse((self.root/'new').exists());self.assertEqual((self.root/'old/note.md').read_bytes(),self.md);self.assertEqual(self.index.read_bytes(),before)
 def test_file_rename_preserves_bytes_and_reference(self):
  (self.root/'old/note.md').write_bytes(self.md+b'\n[attachment](nested/file.bin)\n')
  rename(self.store,'old/nested/file.bin','renamed.bin')
  self.assertFalse((self.root/'old/nested/file.bin').exists())
  self.assertEqual((self.root/'old/nested/renamed.bin').read_bytes(),bytes(range(256)))
  n=json.loads(self.index.read_text())['entries'][0]
  self.assertEqual(n['blocks'][0]['fileId'],'local:old/nested/renamed.bin')
  self.assertEqual(n['blocks'][0]['name'],'renamed.bin')
  self.assertIn(b'(nested/renamed.bin)',(self.root/'old/note.md').read_bytes())
 def test_file_extension_unchanged(self):
  with self.assertRaises(ValueError):rename(self.store,'old/nested/file.bin','file.pdf')
 def test_flush_failure_does_not_truncate_original(self):
  before=self.index.read_bytes()
  with patch('rename_ops.os.fsync',side_effect=OSError('disk flush failed')):
   with self.assertRaises(OSError):rename(self.store,'old','new','old')
  self.assertEqual((self.root/'old/note.md').read_bytes(),self.md)
  self.assertEqual(self.index.read_bytes(),before)
  self.assertEqual(list(self.root.rglob('.pkos-write-rename-*')),[])
 def test_index_publication_failure_restores_complete_document(self):
  import os
  real_replace=os.replace;before=self.index.read_bytes()
  def fail_index(source,destination):
   if Path(destination)==self.index:raise OSError('index commit failed')
   return real_replace(source,destination)
  with patch('rename_ops.os.replace',side_effect=fail_index):
   with self.assertRaises(OSError):rename(self.store,'old','new','old')
  self.assertEqual((self.root/'old/note.md').read_bytes(),self.md)
  self.assertEqual(self.index.read_bytes(),before)
  self.assertFalse((self.root/'new').exists())
  self.assertEqual(list(self.root.rglob('.pkos-write-rename-*')),[])
 def test_external_edit_during_staging_is_preserved(self):
  import os
  real_sync=os.fsync;changed=self.md+b'EXTERNAL CHANGE\n'
  def external_write(fd):
   real_sync(fd)
   target=self.root/'new/note.md'
   if target.exists():target.write_bytes(changed)
  with patch('rename_ops.os.fsync',side_effect=external_write):
   with self.assertRaises(ValueError):rename(self.store,'old','new','old')
  self.assertEqual((self.root/'old/note.md').read_bytes(),changed)
  self.assertEqual(list(self.root.rglob('.pkos-write-rename-*')),[])
 def test_invalid_names(self):
  for name in ['../bad','CON','x/y','bad.', '']:
   with self.assertRaises(ValueError):rename(self.store,'old',name)
if __name__=='__main__':unittest.main()
