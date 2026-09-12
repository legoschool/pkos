import os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from server import Store
from presentation_preview import PresentationPreviews
class Process:
 def __init__(self):self.returncode=None
 def poll(self):return self.returncode
@unittest.skipUnless(os.name=='nt','Windows preview worker')
class PreviewTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=Path(self.tmp.name)
  self.root=self.base/'records';self.root.mkdir();self.source=self.root/'input.ppt';self.source.write_bytes(b'ORIGINAL PRESENTATION')
  self.manager=PresentationPreviews(Store(self.root,self.base/'private/state.json'))
  self.process=Process();self.launch=patch('presentation_preview.subprocess.Popen',return_value=self.process).start();self.addCleanup(patch.stopall)
 def ready(self):
  job=self.manager.start('input.ppt');self.manager.jobs[job['id']]['output'].write_bytes(b'%PDF-test');self.process.returncode=0;return job
 def test_private_copy_and_original_preserved(self):
  job=self.manager.start('input.ppt');args=self.launch.call_args.args[0]
  copied=Path(args[args.index('-Source')+1]);self.assertNotEqual(copied,self.source)
  self.assertEqual(copied.read_bytes(),self.source.read_bytes());self.assertEqual(self.source.read_bytes(),b'ORIGINAL PRESENTATION')
  self.assertNotIn('PSModulePath',self.launch.call_args.kwargs['env'])
 def test_reuses_ready_preview(self):
  job=self.ready();again=self.manager.start('input.ppt');self.assertEqual(again['id'],job['id']);self.assertEqual(again['state'],'ready');self.assertEqual(self.launch.call_count,1)
 def test_source_change_invalidates_result(self):
  job=self.ready();self.source.write_bytes(b'USER CHANGED ORIGINAL')
  self.assertEqual(self.manager.status(job['id'])['state'],'error')
  with self.assertRaises(ValueError):self.manager.output(job['id'])
 def test_other_request_waits_for_running_conversion(self):
  first=self.manager.start('input.ppt');self.assertEqual(self.manager.start('input.ppt')['id'],first['id'])
  (self.root/'second.ppt').write_bytes(b'SECOND')
  with self.assertRaises(ValueError):self.manager.start('second.ppt')
  self.assertEqual(self.launch.call_count,1)
 def test_paths_types_and_size_rejected(self):
  for raw in ['../outside.ppt','data.exe']:
   with self.assertRaises(ValueError):self.manager.start(raw)
  with patch.object(self.manager,'version',return_value=(1,129*1024*1024,1)):
   with self.assertRaises(ValueError):self.manager.start('input.ppt')
  self.assertEqual(self.launch.call_count,0)
 def test_failure_and_unknown_job(self):
  job=self.manager.start('input.ppt');self.process.returncode=1
  self.assertEqual(self.manager.status(job['id'])['state'],'error')
  with self.assertRaises(FileNotFoundError):self.manager.output('unknown')
if __name__=='__main__':unittest.main()
