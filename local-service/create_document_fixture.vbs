Dim app,doc,fso
Set fso=CreateObject("Scripting.FileSystemObject")
If fso.FileExists(WScript.Arguments(0)) Then WScript.Quit 2
Set app=CreateObject("Word.Application")
If app.Documents.Count<>0 Then WScript.Quit 3
app.Visible=False
app.DisplayAlerts=0
Set doc=app.Documents.Add
 doc.Content.Text="PKOS DOC body test" & vbCr & "Second DOC paragraph"
 doc.SaveAs WScript.Arguments(0),0
 doc.Close 0
If app.Documents.Count=0 Then app.Quit 0
