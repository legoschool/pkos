"""Private, bounded XLS and HWP5 text extraction. No document code runs."""
import sys,json,struct,zlib,hashlib,re
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent/'vendor'))
import olefile,xlrd
LIMIT=32*1024*1024

def inflate(data):
 d=zlib.decompressobj(-15);out=d.decompress(data,LIMIT+1)
 if len(out)>LIMIT or d.unconsumed_tail or not d.eof:raise ValueError('압축 본문이 너무 크거나 손상됐습니다.')
 return out

def paragraph(data):
 if len(data)%2:raise ValueError('문단 텍스트가 손상됐습니다.')
 out=bytearray();i=0
 wide={1,2,3,4,5,6,7,8,9,11,12,14,15,16,17,18,19,20,21,22,23}
 while i<len(data):
  c=struct.unpack_from('<H',data,i)[0]
  if c in wide:
   if i+16>len(data):raise ValueError('문단 제어 정보가 손상됐습니다.')
   if c==9:out.extend(b'\t\x00')
   i+=16
  else:
   if c in (10,13):out.extend(b'\n\x00')
   elif c==30:out.extend(b'-\x00')
   elif c==31:out.extend(b' \x00')
   elif c>=32:out.extend(data[i:i+2])
   i+=2
 return out.decode('utf-16le')

def section_text(data):
 lines=[];i=0
 while i<len(data):
  if len(data)-i<4:raise ValueError('본문 레코드가 잘렸습니다.')
  header=struct.unpack_from('<I',data,i)[0];i+=4;size=header>>20;tag=header&1023
  if size==4095:
   if len(data)-i<4:raise ValueError('본문 길이 정보가 잘렸습니다.')
   size=struct.unpack_from('<I',data,i)[0];i+=4
  if size>len(data)-i:raise ValueError('본문 레코드가 잘렸습니다.')
  if tag==67:lines.append(paragraph(data[i:i+size]))
  i+=size
 return lines

def read_hwp(path):
 with olefile.OleFileIO(str(path)) as ole:
  if not ole.exists('FileHeader'):raise ValueError('HWP 5 형식만 본문 미리보기를 지원합니다.')
  head=ole.openstream('FileHeader').read()
  if len(head)<40 or not head.startswith(b'HWP Document File'):raise ValueError('HWP 파일 머리말이 손상됐습니다.')
  flags=struct.unpack_from('<I',head,36)[0]
  if flags&6:raise ValueError('암호 또는 배포용 HWP는 한글에서 직접 열어 주세요.')
  paths=sorted([p for p in ole.listdir() if len(p)==2 and p[0]=='BodyText' and re.fullmatch(r'Section\d+',p[1])],key=lambda p:int(p[1][7:]))
  if not paths:raise ValueError('HWP 본문 구역이 없습니다.')
  sections=[];total=0
  for p in paths:
   if ole.get_size(p)>LIMIT:raise ValueError('본문이 너무 큽니다.')
   data=ole.openstream(p).read();data=inflate(data) if flags&1 else data
   total+=len(data)
   if total>LIMIT:raise ValueError('본문 합계가 32MB를 넘습니다.')
   sections.append({'title':'구역 '+str(int(p[1][7:])+1),'lines':section_text(data)})
  return {'note':'HWP 본문 보기입니다. 표 안의 글도 읽지만 쪽 배치·그림·수식 모양은 재현하지 않습니다.','sections':sections}

def read_xls(path):
 book=xlrd.open_workbook(str(path),on_demand=True);sections=[];cells=0
 try:
  for sheet in book.sheets():
   cells+=sheet.nrows*sheet.ncols
   if cells>500000:raise ValueError('전체 셀 수가 50만 개를 넘습니다. Excel에서 직접 열어 주세요.')
   rows=[]
   for row in sheet.get_rows():
    values=[]
    for cell in row:
     value=cell.value
     if cell.ctype==xlrd.XL_CELL_DATE:
      try:value=xlrd.xldate_as_datetime(value,book.datemode).isoformat(sep=' ')
      except (ValueError,OverflowError):value=str(value)
     elif cell.ctype==xlrd.XL_CELL_BOOLEAN:value='TRUE' if value else 'FALSE'
     elif cell.ctype==xlrd.XL_CELL_ERROR:value=xlrd.error_text_from_code.get(value,'#ERROR')
     elif cell.ctype==xlrd.XL_CELL_NUMBER and value==int(value):value=int(value)
     values.append(str(value))
    rows.append(values)
   sections.append({'title':sheet.name+(' (숨김 시트)' if sheet.visibility else ''),'rows':rows})
  return {'note':'시트별 셀 값입니다. 수식은 파일에 저장된 계산 결과를 표시하며 다시 계산하거나 외부 연결을 실행하지 않습니다. 차트·그림·셀 서식은 재현하지 않습니다.','sections':sections}
 finally:book.release_resources()

if __name__=='__main__':
 source,destination=map(Path,sys.argv[1:3])
 try:
  before=hashlib.sha256(source.read_bytes()).digest()
  result=read_xls(source) if source.suffix.lower()=='.xls' else read_hwp(source)
  encoded=json.dumps(result,ensure_ascii=False).encode('utf-8')
  if len(encoded)>LIMIT:raise ValueError('미리보기 결과가 32MB를 넘습니다.')
  if hashlib.sha256(source.read_bytes()).digest()!=before:raise ValueError('변환 중 파일이 변경됐습니다.')
  with destination.open('xb') as f:f.write(encoded)
 except Exception as error:
  message=str(error) if isinstance(error,ValueError) else '파일을 읽지 못했습니다. 암호와 파일 손상을 확인해 주세요.'
  (destination.parent/'error.json').write_text(json.dumps({'message':message},ensure_ascii=False),encoding='utf-8')
  raise SystemExit(1)
