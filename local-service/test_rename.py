import tempfile, unittest, json, threading
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from rename_ops import rename
class RenameTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);(self.root/'old'/'nested').mkdir(parents=True)
  self.md=b'---\r\nid: r1\r\ntags: ["old"]\r\n---\r\n\r\nKEEP BODY\r\n';(self.root/'old'/'note.md').write_bytes(self.md);(self.root/'old'/'nested'/'file.bin').write_bytes(bytes(range(256)))
  self.store=SimpleNamespace(root=self.root,lock=threading.RLock(),path=self.path)
  self.data={'entries':[{'id':'r1','tags':['old'],'mdId':'local:old/note.md','srcId':'local:old/note.md','localDir':'old','srcPath':['old'],'updatedAt':1,'blocks':[{'fileId':'local:old/nested/file.bin'}]}]};self.index=self.root/'PKOS-index.json';self.index.write_text(json.dumps(self.data),encoding='utf-8')
 def path(self,raw):
  p=(self.root/raw).resolve()
  if not p.is_relative_to(self.root):raise ValueError('outside')
  return p
 def test_folder(self):
  rename(self.store,'old','new')
  self.assertFalse((self.root/'old').exists());self.assertEqual((self.root/'new/note.md').read_bytes(),self.md)
  n=json.loads(self.index.read_text())['entries'][0];self.assertEqual(n['blocks'][0]['fileId'],'local:new/nested/file.bin');self.assertEqual(n['srcPath'],['new']);self.assertEqual((self.root/'new/nested/file.bin').read_bytes(),bytes(range(256)))
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
 def test_invalid_names(self):
  for name in ['../bad','CON','x/y','bad.', '']:
   with self.assertRaises(ValueError):rename(self.store,'old',name)
if __name__=='__main__':unittest.main()
