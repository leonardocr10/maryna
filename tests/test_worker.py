"""Run with: python -m unittest discover -s tests

All fixtures are 100% synthetic (AGENTS.md rule 7)."""
import unittest,tempfile,subprocess,sys,json,hashlib
from docx import Document
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
WORKER=str(ROOT/'worker/docx_worker.py')
SLOTS=['inteligencia','percepcao','memoria','atencao','funcoes_executivas','comportamento','comportamento_diva']

def run(op,*args,stdin=None):
 r=subprocess.run([sys.executable,WORKER,op,*args],input=json.dumps(stdin) if stdin else None,text=True,capture_output=True,encoding='utf-8')
 if r.returncode:raise AssertionError(r.stderr)
 return json.loads(r.stdout)

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def synthetic_base(path):
 """Reference layout: ANAMNESE + seven interpretation markers, each after a score table."""
 d=Document();d.sections[0].header.paragraphs[0].text='Cabeçalho fictício'
 d.add_paragraph('Paciente: Fulano Fictício')
 d.add_paragraph('ANAMNESE')
 for i,_ in enumerate(SLOTS):
  t=d.add_table(rows=2,cols=3)
  for c,v in enumerate(['Teste','Pontuação','Classificação']):t.cell(0,c).text=v
  for c,v in enumerate([f'Teste {i}',str(100+i),'Média']):t.cell(1,c).text=v
  d.add_paragraph('Interpretação Clínica:' if i%2 else 'INTERPRETAÇÃO E OBSERVAÇÕES CLÍNICAS')
 d.add_paragraph('CONCLUSÃO/RESULTADOS')
 d.save(path)

class TestWorker(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.dir=Path(self.tmp.name)
  self.base=self.dir/'base.docx';self.out=self.dir/'out.docx';synthetic_base(self.base)
 def tearDown(self):self.tmp.cleanup()

 def test_inspect_finds_anamnesis_and_seven_markers_in_order(self):
  r=run('inspect',str(self.base))
  self.assertEqual([m['key'] for m in r['markers']],['anamnesis',*SLOTS,'conclusao'])

 def test_export_inserts_all_eight_points_and_keeps_original(self):
  before=sha(self.base)
  sections={'anamnesis':'Histórico fictício.',**{k:f'Texto fictício {k}.' for k in SLOTS}}
  r=run('export',stdin={'base':str(self.base),'out':str(self.out),'sections':sections})
  self.assertEqual(r['missing'],[]);self.assertEqual(sorted(r['inserted']),sorted(sections))
  self.assertEqual(sha(self.base),before);self.assertEqual(r['base_sha256'],before)
  texts=[p.text for p in Document(self.out).paragraphs]
  for k,v in sections.items():self.assertEqual(texts.count(v),1,k)
  # inserted right after its marker
  self.assertEqual(texts[texts.index('ANAMNESE')+1],'Histórico fictício.')

 def test_export_preserves_tables_header_and_existing_text(self):
  run('export',stdin={'base':str(self.base),'out':str(self.out),'sections':{'inteligencia':'X.'}})
  a,b=Document(self.base),Document(self.out)
  self.assertEqual([[c.text for r in t.rows for c in r.cells] for t in a.tables],[[c.text for r in t.rows for c in r.cells] for t in b.tables])
  self.assertEqual(b.sections[0].header.paragraphs[0].text,'Cabeçalho fictício')
  original=[p.text for p in a.paragraphs];result=[p.text for p in b.paragraphs]
  result.remove('X.');self.assertEqual(original,result)

 def test_export_reports_missing_destination(self):
  d=Document();d.add_paragraph('Sem marcadores');d.save(self.base)
  r=run('export',stdin={'base':str(self.base),'out':str(self.out),'sections':{'anamnesis':'Y.'}})
  self.assertEqual(r['missing'],['anamnesis'])

 def test_export_refuses_to_overwrite_base(self):
  with self.assertRaises(AssertionError):
   run('export',stdin={'base':str(self.base),'out':str(self.base),'sections':{'anamnesis':'Z.'}})

 def test_heading_box_markers_get_body_paragraphs_with_bold_topics(self):
  d=Document()
  for label in ['DESCRIÇÃO DA DEMANDA','ANAMNESE:','Interpretação e Observações Clínicas:','Indicações e Recomendações Clínicas:']:
   d.add_table(rows=1,cols=1).cell(0,0).text=label;d.add_paragraph('')
  d.save(self.base)
  content='## Queixa\n\nTexto da queixa.\n\n## Sono\n\nTexto do sono.'
  r=run('export',stdin={'base':str(self.base),'out':str(self.out),'sections':{'demanda':'Demanda fictícia.','anamnesis':content,'inteligencia':'Interp.','recomendacoes':'Rec.'}})
  self.assertEqual(r['missing'],[])
  out=Document(self.out)
  self.assertEqual([t.cell(0,0).text for t in out.tables],['DESCRIÇÃO DA DEMANDA','ANAMNESE:','Interpretação e Observações Clínicas:','Indicações e Recomendações Clínicas:'])
  paras=[p for p in out.paragraphs if p.text]
  self.assertEqual([p.text for p in paras],['Demanda fictícia.','Queixa','Texto da queixa.','Sono','Texto do sono.','Interp.','Rec.'])
  self.assertTrue(paras[1].runs[0].bold);self.assertFalse(paras[2].runs[0].bold)
  self.assertEqual(paras[2].runs[0].font.name,'Arial')

if __name__=='__main__':unittest.main()
