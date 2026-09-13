Option Explicit
Dim app, doc, fso, src, dst, temp, issue, oldLinks, oldNormal
Set fso=CreateObject("Scripting.FileSystemObject")
src=fso.GetAbsolutePathName(WScript.Arguments(0))
dst=fso.GetAbsolutePathName(WScript.Arguments(1))
If LCase(fso.GetExtensionName(src))<>"doc" Or LCase(fso.GetExtensionName(dst))<>"pdf" Then WScript.Quit 2
If fso.FileExists(dst) Then WScript.Quit 2
temp=dst & ".part.pdf"
If fso.FileExists(temp) Then WScript.Quit 2
On Error Resume Next
Set app=CreateObject("Word.Application")
If Err.Number<>0 Then WScript.Quit 3
If app.Documents.Count<>0 Then WScript.Quit 4
oldLinks=app.Options.UpdateLinksAtOpen
oldNormal=app.Options.SaveNormalPrompt
app.Visible=False
app.DisplayAlerts=0
app.AutomationSecurity=3
app.Options.UpdateLinksAtOpen=False
app.Options.SaveNormalPrompt=False
Err.Clear
Set doc=app.Documents.Open(src,False,True,False,"")
issue=Err.Number
WScript.Echo "Open: " & issue & " " & Err.Description
If issue=0 Then
 doc.ExportAsFixedFormat temp,17,False
 issue=Err.Number
 WScript.Echo "Export: " & issue & " " & Err.Description
 doc.Close 0
End If
app.Options.UpdateLinksAtOpen=oldLinks
app.Options.SaveNormalPrompt=oldNormal
If app.Documents.Count=0 Then app.Quit 0
If issue<>0 Then
 If fso.FileExists(temp) Then fso.DeleteFile temp
 WScript.Quit 5
End If
Err.Clear
fso.MoveFile temp,dst
If Err.Number<>0 Then WScript.Quit 6
