from pathlib import Path
import sys,subprocess,tempfile,shutil
app=Path(__file__).resolve().parent
sys.path.insert(0,str(app/'runtime/test-vendor'))
import xlwt
root=Path(tempfile.mkdtemp(prefix='pkos-legacy-check-'))
book=xlwt.Workbook();sheet=book.add_sheet('첫 시트');sheet.write(0,0,'PKOS XLS first sheet');sheet.write(0,1,42);sheet.write(119,0,'LASTROW XLS TOKEN');second=book.add_sheet('두 번째');second.write(0,0,'SECOND XLS TOKEN');second.write(0,1,'<script>unsafe</script>');book.save(str(root/'sample.xls'))
subprocess.run(['cscript.exe','//B','//Nologo',str(app/'create_document_fixture.vbs'),str(root/'sample.doc')],check=True,timeout=40)
source=next(Path('C:/Program Files (x86)/Hnc/Office 2024/HOffice130/Shared/HwpTemplate').rglob('Present1.hwp'))
shutil.copyfile(source,root/'sample.hwp')
(app/'runtime/legacy-test-root.txt').write_text(str(root),encoding='utf-8')
print(root)
