import unittest,struct,zlib
from unittest.mock import patch
from legacy_document import paragraph,section_text,inflate
class LegacyTests(unittest.TestCase):
 def test_korean_and_surrogate_text(self):self.assertEqual(paragraph('한글과 English 😀'.encode('utf-16le')),'한글과 English 😀')
 def test_embedded_controls_are_not_text(self):self.assertEqual(paragraph(b'\x02\x00'+b'X'*14+'본문'.encode('utf-16le')),'본문')
 def test_extended_record_length(self):
  text='두 번째 구역'.encode('utf-16le');data=struct.pack('<II',67|(4095<<20),len(text))+text;self.assertEqual(section_text(data),['두 번째 구역'])
 def test_corruption_rejected(self):
  for data in [b'\x00',struct.pack('<I',67|(99<<20)),struct.pack('<I',67|(4095<<20))]:
   with self.assertRaises(ValueError):section_text(data)
 def test_inflate_limit_and_truncated_stream(self):
  d=zlib.compress(b'x'*100)[2:-4]
  self.assertEqual(inflate(d),b'x'*100)
  with patch('legacy_document.LIMIT',10):
   with self.assertRaises(ValueError):inflate(d)
  with self.assertRaises(ValueError):inflate(d[:-1])
if __name__=='__main__':unittest.main()
