import unittest,tempfile,zipfile,stat
from pathlib import Path
from server import Store
from extract_zip import extract
class ZipTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.store=Store(self.root,self.root/'state.json')
 def archive(self,items):
  p=self.root/'sample.zip'
  with zipfile.ZipFile(p,'w',zipfile.ZIP_DEFLATED) as z:
   for name,data in items:
    if isinstance(name,str):
     info=zipfile.ZipInfo(name);info.filename=name
    else:info=name
    z.writestr(info,data)
  return p
 def test_nested_files_and_original_unchanged(self):
  p=self.archive([('문서/본문.txt','한글 본문'),('empty/',''),('slides/ppt.txt','slides')]);before=p.read_bytes();r=extract(self.store,'sample.zip')
  self.assertEqual(r['files'],2);self.assertEqual((self.root/r['folder']/'문서/본문.txt').read_text(encoding='utf-8'),'한글 본문');self.assertEqual(p.read_bytes(),before)
 def test_existing_destination_preserved(self):
  self.archive([('a.txt','NEW')]);d=self.root/'sample';d.mkdir();(d/'a.txt').write_text('OLD');r=extract(self.store,'sample.zip');self.assertEqual(r['folder'],'sample (2)');self.assertEqual((d/'a.txt').read_text(),'OLD')
 def test_bad_paths_leave_no_output(self):
  for name in ['../escape.txt','/absolute.txt','C:/escape','foo\\escape','NUL.txt','a:stream','a./b','ok/../../bad']:
   with self.subTest(name=name):
    self.archive([(name,'bad')])
    with self.assertRaises(ValueError):extract(self.store,'sample.zip')
    self.assertFalse((self.root/'sample').exists())
 def test_duplicate_case_names_rejected(self):
  self.archive([('A.txt','one'),('a.txt','two')])
  with self.assertRaises(ValueError):extract(self.store,'sample.zip')
 def test_symlink_rejected(self):
  i=zipfile.ZipInfo('link');i.create_system=3;i.external_attr=(stat.S_IFLNK|0o777)<<16;self.archive([(i,'../outside')])
  with self.assertRaises(ValueError):extract(self.store,'sample.zip')
 def test_broken_archive_preserved(self):
  p=self.root/'bad.zip';p.write_bytes(b'not a zip')
  with self.assertRaises(ValueError):extract(self.store,'bad.zip')
  self.assertEqual(p.read_bytes(),b'not a zip')
 def test_conflicting_parent_cleans_staging(self):
  self.archive([('a','file'),('a/b','other')])
  with self.assertRaises(OSError):extract(self.store,'sample.zip')
  self.assertFalse(list(self.root.glob('.pkos-write-*')));self.assertFalse((self.root/'sample').exists())
if __name__=='__main__':unittest.main()
