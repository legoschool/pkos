"""On-demand private PPT-to-PDF jobs; originals are never passed to Office."""
import os,shutil,subprocess,threading,uuid
from pathlib import Path

class PresentationPreviews:
 def __init__(self,store):
  self.store=store;self.lock=threading.RLock();self.jobs={}
  self.base=Path(store.state).parent/'presentation-previews'
 def version(self,path):
  s=path.stat();return (s.st_mtime_ns,s.st_size,s.st_ino)
 def start(self,raw):
  if os.name!='nt':raise ValueError('이 미리보기는 Windows PC와 PowerPoint가 필요합니다.')
  source=self.store.path(raw)
  if source.suffix.lower() not in ('.ppt','.pptx','.pps','.ppsx','.odp'):raise ValueError('프레젠테이션 파일만 변환할 수 있습니다.')
  with self.lock:
   version=self.version(source)
   if version[1]>128*1024*1024:raise ValueError('128MB가 넘는 파일은 원본 프로그램에서 열어 주세요.')
   for key,job in self.jobs.items():
    state=self.status(key)
    if job['raw']==raw and job['version']==version and state['state']!='error':return state
   if any(self.status(key)['state']=='running' for key in self.jobs):raise ValueError('다른 프레젠테이션을 변환 중입니다. 잠시 후 다시 요청해 주세요.')
   while len(self.jobs)>=12:
    key=next(iter(self.jobs));job=self.jobs.pop(key)
    for name in ('input'+job['suffix'],'preview.pdf','process.log'):
     try:(job['directory']/name).unlink(missing_ok=True)
     except OSError:pass
    try:job['directory'].rmdir()
    except OSError:pass
   key=uuid.uuid4().hex;directory=self.base/key;directory.mkdir(parents=True)
   copied=directory/('input'+source.suffix.lower());output=directory/'preview.pdf'
   shutil.copyfile(source,copied)
   if self.version(source)!=version:raise ValueError('파일이 변경됐습니다. 다시 요청해 주세요.')
   log=(directory/'process.log').open('wb')
   environment=os.environ.copy();environment.pop('PSModulePath',None)
   try:
    process=subprocess.Popen(['powershell.exe','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',str(Path(__file__).with_name('preview_powerpoint.ps1')),'-Source',str(copied),'-Destination',str(output)],stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW,env=environment)
   except Exception:log.close();raise
   log.close()
   self.jobs[key]={'raw':raw,'version':version,'suffix':source.suffix.lower(),'directory':directory,'process':process,'log':log,'output':output,'result':None}
   return {'id':key,'state':'running'}
 def status(self,key):
  with self.lock:
   if key not in self.jobs:raise FileNotFoundError('미리보기 요청을 다시 시작해 주세요.')
   job=self.jobs[key];process=job['process']
   if job['result'] is None and process.poll() is not None:
    job['log'].close();job['result']='ready' if process.returncode==0 and job['output'].is_file() else 'error'
   if job['result'] is None:return {'id':key,'state':'running'}
   try:unchanged=self.version(self.store.path(job['raw']))==job['version']
   except OSError:unchanged=False
   if not unchanged:return {'id':key,'state':'error','message':'원본이 바뀌었습니다. 미리보기를 다시 요청해 주세요.'}
   if job['result']=='error':return {'id':key,'state':'error','message':'변환하지 못했습니다. PowerPoint 설치·실행 상태, 파일 암호와 손상을 확인한 뒤 다시 요청해 주세요.'}
   return {'id':key,'state':'ready'}
 def output(self,key):
  if self.status(key)['state']!='ready':raise ValueError('미리보기가 아직 준비되지 않았습니다.')
  return self.jobs[key]['output']
