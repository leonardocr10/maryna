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

 def test_chatgpt_bold_line_becomes_topic_title(self):
  d=Document();d.add_paragraph('ANAMNESE');d.save(self.base)
  nl=chr(10)
  run('export',stdin={'base':str(self.base),'out':str(self.out),'sections':{'anamnesis':'**Sono**'+nl+nl+'Dorme **pouco**.'}})
  paras=[p for p in Document(self.out).paragraphs if p.text]
  self.assertEqual([p.text for p in paras],['ANAMNESE','Sono','Dorme pouco.'])
  self.assertTrue(paras[1].runs[0].bold)

 def test_highlight_marks_generated_text_red_only(self):
  run('export',stdin={'base':str(self.base),'out':str(self.out),'sections':{'anamnesis':'Gerado.'},'highlight':True})
  paras={p.text:p for p in Document(self.out).paragraphs}
  self.assertEqual(str(paras['Gerado.'].runs[0].font.color.rgb),'FF0000')
  self.assertIsNone(paras['ANAMNESE'].runs[0].font.color.rgb)

 def test_rejects_zip_that_is_not_word(self):
  import zipfile
  with zipfile.ZipFile(self.base,'w') as z:z.writestr('x.txt','not a docx')
  with self.assertRaises(AssertionError):run('inspect',str(self.base))

 def test_rejects_zip_bomb(self):
  import zipfile
  with zipfile.ZipFile(self.base,'w',zipfile.ZIP_DEFLATED) as z:
   z.writestr('word/document.xml','<w/>');z.writestr('big.bin',b'0'*(201*1024*1024))
  with self.assertRaises(AssertionError):run('inspect',str(self.base))

 def test_fills_identification_values_only(self):
  d=Document()
  p=d.add_paragraph();p.add_run('Data de início da avaliação: ').bold=True;p.add_run('25/08/2026       Data da finalização do laudo: 00/11/2026')
  d.add_paragraph('Nome: Fulano Antigo');d.add_paragraph('Data de Nascimento: -');d.add_paragraph('Idade: ')
  d.add_paragraph('Escolaridade: 6º ano')
  d.add_table(rows=1,cols=1).cell(0,0).text='DESCRIÇÃO DA DEMANDA'
  d.add_paragraph('Nome: não deve mudar depois do primeiro título')
  t=d.add_table(rows=1,cols=2);t.cell(0,0).text='Nome:';t.cell(0,1).text='123'
  d.save(self.base)
  self.assertEqual(run('inspect',str(self.base))['identification']['Nome'],'Fulano Antigo')
  fields={'Nome':'Ciclana Fictícia','Data de Nascimento':'31/05/1993','Idade':'33 anos','Data de início da avaliação':'15/09/2026','Data da finalização do laudo':'19/10/2026'}
  r=run('export',stdin={'base':str(self.base),'out':str(self.out),'sections':{},'fields':fields})
  self.assertEqual(sorted(r['fields_filled']),sorted(fields))
  out=Document(self.out);texts=[p.text for p in out.paragraphs]
  self.assertEqual(texts[0],'Data de início da avaliação: 15/09/2026       Data da finalização do laudo: 19/10/2026')
  self.assertTrue(out.paragraphs[0].runs[0].bold)
  self.assertEqual(texts[1:5],['Nome: Ciclana Fictícia','Data de Nascimento: 31/05/1993','Idade: 33 anos','Escolaridade: 6º ano'])
  self.assertEqual(texts[5],'Nome: não deve mudar depois do primeiro título')
  self.assertEqual(out.tables[1].cell(0,1).text,'123')

 def test_inserted_text_is_arial_11_with_1_5_spacing(self):
  nl=chr(10)
  run('export',stdin={'base':str(self.base),'out':str(self.out),'sections':{'anamnesis':'## Sono'+nl+nl+'Texto.'+nl+nl+'## Escola'+nl+nl+'Outro.'}})
  ps=Document(self.out).paragraphs
  start=[p.text for p in ps].index('Sono')
  for p in ps[start:start+5]:
   self.assertEqual(p.paragraph_format.line_spacing,1.5)
   if p.text:self.assertEqual((p.runs[0].font.name,p.runs[0].font.size.pt),('Arial',11.0))
   else:
    sz=p._p.pPr.find('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}rPr').find('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}sz')
    self.assertEqual(sz.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val'),'22')

 def filled_report(self):
  """Report already written by someone: old narrative, chart, fixed text and references around the destinations."""
  d=Document()
  d.add_table(rows=1,cols=1).cell(0,0).text='DESCRIÇÃO DA DEMANDA';d.add_paragraph('');d.add_paragraph('Demanda antiga.');d.add_paragraph('')
  d.add_table(rows=1,cols=1).cell(0,0).text='ANAMNESE:';d.add_paragraph('Identificação');d.add_paragraph('Anamnese antiga.')
  d.add_table(rows=1,cols=1).cell(0,0).text='MEMÓRIA E APRENDIZAGEM:'
  t=d.add_table(rows=1,cols=2);t.cell(0,0).text='RAVLT';t.cell(0,1).text='42'
  d.add_table(rows=1,cols=1).cell(0,0).text='Interpretação e observações clínicas:'
  d.add_paragraph('Memória antiga.')
  chart=d.add_paragraph();chart._p.get_or_add_pPr();r=chart.add_run();from docx.oxml import OxmlElement;r._r.append(OxmlElement('w:drawing'))
  d.add_paragraph('Tabela 3. Legenda fixa.')
  d.add_table(rows=1,cols=1).cell(0,0).text='CONCLUSÃO:';d.add_paragraph('Conclusão antiga.');d.add_paragraph('Salienta-se que a avaliação é um retrato do momento.')
  d.add_table(rows=1,cols=1).cell(0,0).text='Indicações e Recomendações Clínicas:';d.add_paragraph('Psicoterapia: antiga.');d.add_paragraph('REFERÊNCIAS:');d.add_paragraph('AUTOR, Fictício. Livro. 2020.')
  d.save(self.base)

 def test_old_text_is_replaced_and_fixed_content_survives(self):
  self.filled_report()
  sections={'demanda':'Demanda nova.','anamnesis':'## Sono'+chr(10)+chr(10)+'Anamnese nova.','memoria':'Memória nova.','conclusao':'Conclusão nova.','recomendacoes':'Psicoterapia: nova.'}
  r=run('export',stdin={'base':str(self.base),'out':str(self.out),'sections':sections})
  self.assertEqual(r['missing'],[]);self.assertEqual(r['replaced'],{'demanda':1,'anamnesis':2,'memoria':1,'conclusao':1,'recomendacoes':1})
  out=Document(self.out);texts=[p.text for p in out.paragraphs if p.text]
  self.assertEqual(texts,['Demanda nova.','Sono','Anamnese nova.','Memória nova.','Tabela 3. Legenda fixa.','Conclusão nova.','Salienta-se que a avaliação é um retrato do momento.','Psicoterapia: nova.','REFERÊNCIAS:','AUTOR, Fictício. Livro. 2020.'])
  self.assertEqual(out.tables[3].cell(0,1).text,'42')
  self.assertEqual(len(out.element.body.findall('.//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}drawing')),1)

 def test_section_without_new_text_keeps_old_text(self):
  self.filled_report()
  run('export',stdin={'base':str(self.base),'out':str(self.out),'sections':{'demanda':'Demanda nova.'}})
  texts=[p.text for p in Document(self.out).paragraphs]
  self.assertIn('Conclusão antiga.',texts);self.assertIn('Memória antiga.',texts);self.assertNotIn('Demanda antiga.',texts)

 def test_inspect_flags_old_text_and_maps_interpretation_by_title(self):
  self.filled_report()
  r=run('inspect',str(self.base));by={m['key']:m for m in r['markers']}
  self.assertEqual(by['memoria']['existing_paragraphs'],1);self.assertNotIn('inteligencia',by)
  old=[e['text'] for e in r['elements'] if e.get('replaceable')]
  self.assertIn('Memória antiga.',old);self.assertNotIn('Tabela 3. Legenda fixa.',old);self.assertNotIn('REFERÊNCIAS:',old)

if __name__=='__main__':unittest.main()
