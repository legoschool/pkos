import unittest
from markdown_paths import rewrite
class MarkdownPathTests(unittest.TestCase):
 def change(self,text,old_doc='outside/note.md',new_doc='outside/note.md'):
  return rewrite(text,old_doc,new_doc,lambda p:'new'+p[3:] if p=='old' or p.startswith('old/') else p)
 def test_inner_relative_link_unchanged(self):
  text='![image](nested/%EA%B7%B8%EB%A6%BC%20%281%29.png "title")\r\n'
  self.assertEqual(self.change(text,'old/note.md','new/note.md'),text)
 def test_encoded_reference_html_query_fragment(self):
  text='[ref]: <../old/a%20b.png?x=1#page> "title"\n<img src="../old/a%20b.png">\n'
  self.assertEqual(self.change(text),text.replace('../old/','../new/'))
 def test_external_and_code_comments_preserved(self):
  text='[external](https://example.com/old/a.png)\n`[code](../old/a.png)`\n<!--\n[comment](../old/a.png)\n-->\n    [indented](../old/a.png)\n'
  self.assertEqual(self.change(text),text)
 def test_local_identifier_header(self):
  text='---\nid: example\nattachments:\n  - file: "a.png"\n    driveId: "local:old/a.png"\n---\n![picture](../old/a.png)\n'
  self.assertEqual(self.change(text),text.replace('local:old/','local:new/').replace('../old/','../new/'))
 def test_outside_root_not_remapped(self):
  text='[outside](../../../old/file.bin)\n'
  self.assertEqual(self.change(text),text)
if __name__=='__main__':unittest.main()
