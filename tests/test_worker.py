"""Run with: python -m unittest discover -s tests"""
import unittest,tempfile,subprocess,sys,json,os
from docx import Document
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class TestWorker(unittest.TestCase):
 def test_docx_insertion_preserves_existing_table_values(self):
  with tempfile.TemporaryDirectory() as temp:
   source=Path(temp)/'base.docx';out=Path(temp)/'result.docx';d=Document();d.add_paragraph('ANAMNESE');t=d.add_table(rows=2,cols=2);t.cell(0,0).text='Pontuação';t.cell(1,0).text='123';d.add_paragraph('Interpretação Clínica:');d.save(source)
   payload=json.dumps({'base':str(source),'out':str(out),'sections':{'anamnesis':'Histórico fictício.','inteligencia':'Interpretação fictícia.'}})
   result=subprocess.run([sys.executable,str(ROOT/'worker/docx_worker.py'),'export'],input=payload,text=True,capture_output=True,check=True)
   self.assertEqual(json.loads(result.stdout)['missing'],[])
   r=Document(out);self.assertEqual(r.tables[0].cell(1,0).text,'123');self.assertIn('Histórico fictício.', '\n'.join(p.text for p in r.paragraphs));self.assertIn('Interpretação fictícia.','\n'.join(p.text for p in r.paragraphs))
if __name__=='__main__':unittest.main()
