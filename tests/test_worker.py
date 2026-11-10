"""Run with: python -m unittest discover -s tests

All fixtures are 100% synthetic (AGENTS.md rule 7)."""
import unittest,tempfile,subprocess,sys,json,hashlib
from docx import Document
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
WORKER=str(ROOT/'worker/docx_worker.py')
SLOTS=['inteligencia','percepcao','memoria','atencao','funcoes_executivas','comportamento','personalidade','comportamento_diva']

def run(op,*args,stdin=None):
 r=subprocess.run([sys.executable,WORKER,op,*args],input=json.dumps(stdin) if stdin else None,text=True,capture_output=True,encoding='utf-8')
 if r.returncode:raise AssertionError(r.stderr)
 return json.loads(r.stdout)

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def synthetic_base(path):
 """Reference layout: ANAMNESE + one interpretation marker per slot, each after a score table.
 Only the BFP field carries its own title, since an untitled extra behaviour field is the DIVA one."""
 d=Document();d.sections[0].header.paragraphs[0].text='Cabeçalho fictício'
 d.add_paragraph('Paciente: Fulano Fictício')
 d.add_paragraph('ANAMNESE')
 for i,k in enumerate(SLOTS):
  if k=='personalidade':d.add_paragraph('BATERIA FATORIAL DA PERSONALIDADE')
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

 def test_two_labels_on_one_line_keep_their_own_values(self):
  """Synthetic: "Data de início: - Data da finalização: -" on one line, separated by a single space."""
  d=Document();d.add_paragraph('Data de início da avaliação: - Data da finalização do laudo: -');d.add_paragraph('Nome: ')
  d.add_table(rows=1,cols=1).cell(0,0).text='DESCRIÇÃO DA DEMANDA';d.save(self.base)
  ident=run('inspect',str(self.base))['identification']
  self.assertEqual(ident['Data de início da avaliação'],'-')
  self.assertEqual(ident['Data da finalização do laudo'],'-')
  fields={'Data de início da avaliação':'15/09/2026','Data da finalização do laudo':'19/10/2026'}
  run('export',stdin={'base':str(self.base),'out':str(self.out),'sections':{},'fields':fields})
  self.assertEqual(Document(self.out).paragraphs[0].text,'Data de início da avaliação: 15/09/2026 Data da finalização do laudo: 19/10/2026')

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

 def test_preview_tags_inserted_paragraphs_for_the_word_tab_only(self):
  nl=chr(10);sec={'anamnesis':'## Sono'+nl+nl+'Texto.'}
  run('export',stdin={'base':str(self.base),'out':str(self.out),'sections':sec,'tags':True})
  xml=Document(self.out).element.xml
  self.assertIn('nlsec_anamnesis_0',xml);self.assertIn('nlsec_anamnesis_1',xml)
  plain=Path(str(self.out).replace('.docx','-final.docx'))
  run('export',stdin={'base':str(self.base),'out':str(plain),'sections':sec})
  self.assertNotIn('nlsec_',Document(plain).element.xml,'the downloaded file has no marks')
 def test_inserted_text_is_arial_11_with_1_5_spacing(self):
  nl=chr(10)
  run('export',stdin={'base':str(self.base),'out':str(self.out),'sections':{'anamnesis':'## Sono'+nl+nl+'Texto.'+nl+nl+'## Escola'+nl+nl+'Outro.'}})
  ps=Document(self.out).paragraphs
  start=[p.text for p in ps].index('Sono')
  # no blank paragraphs as spacing: 1.5 lines, 6 pt after each paragraph, 12 pt before a topic title (not the first)
  self.assertEqual([p.text for p in ps[start:start+4]],['Sono','Texto.','Escola','Outro.'])
  for p in ps[start:start+4]:
   self.assertEqual(p.paragraph_format.line_spacing,1.5)
   self.assertEqual(p.paragraph_format.space_after.pt,6.0)
   self.assertEqual((p.runs[0].font.name,p.runs[0].font.size.pt),('Arial',11.0))
  self.assertIsNone(ps[start].paragraph_format.space_before)
  self.assertEqual(ps[start+2].paragraph_format.space_before.pt,12.0)

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

 def test_text_identical_to_document_keeps_original_paragraph(self):
  d=Document();d.add_table(rows=1,cols=1).cell(0,0).text='DESCRIÇÃO DA DEMANDA'
  d.add_paragraph('Primeira parte.').runs[0].italic=True;d.add_paragraph('Segunda parte.');d.save(self.base)
  marker=run('inspect',str(self.base))['markers'][0]
  self.assertEqual(marker['existing_text'],'Primeira parte.'+chr(10)+chr(10)+'Segunda parte.')
  r=run('export',stdin={'base':str(self.base),'out':str(self.out),'sections':{'demanda':marker['existing_text']},'highlight':True})
  self.assertEqual((r['missing'],r['replaced']),([],{}))
  ps=Document(self.out).paragraphs
  self.assertEqual([p.text for p in ps],['Primeira parte.','Segunda parte.'])
  self.assertTrue(ps[0].runs[0].italic);self.assertIsNone(ps[0].runs[0].font.color.rgb)

 def test_tables_belong_to_their_section_even_after_the_field(self):
  d=Document()
  d.add_table(rows=1,cols=1).cell(0,0).text='HABILIDADES INTELECTUAIS E DE INTELIGÊNCIA:'
  d.add_table(rows=2,cols=2).cell(0,0).text='WISC'
  d.add_paragraph('Interpretação Clínica:')
  d.add_table(rows=2,cols=2).cell(0,0).text='Subtestes WISC'
  d.add_table(rows=1,cols=1).cell(0,0).text='PERCEPÇÃO E NOÇÕES BÁSICAS:'
  d.add_table(rows=2,cols=2).cell(0,0).text='Percepção'
  d.add_table(rows=1,cols=1).cell(0,0).text='Interpretação e Observações Clínicas:'
  d.add_table(rows=1,cols=1).cell(0,0).text='COMPORTAMENTO:'
  d.add_table(rows=1,cols=1).cell(0,0).text='Interpretação e Observações Clínicas:'
  d.add_table(rows=2,cols=2).cell(0,0).text='DIVA'
  d.add_table(rows=1,cols=1).cell(0,0).text='Interpretação e Observações Clínicas:'
  d.add_table(rows=1,cols=1).cell(0,0).text='CONCLUSÃO'
  d.save(self.base)
  r=run('inspect',str(self.base));els=r['elements']
  firsts={m['key']:[e['rows'][0][0] for e in els[m['section_start']:m['section_end']] if e['type']=='table' and len(e['rows'])>1] for m in r['markers'] if 'section_start' in m}
  self.assertEqual(firsts,{'inteligencia':['WISC','Subtestes WISC'],'percepcao':['Percepção'],'comportamento':[],'comportamento_diva':['DIVA']})

 def test_title_without_field_still_has_its_tables(self):
  d=Document()
  d.add_table(rows=1,cols=1).cell(0,0).text='HABILIDADES INTELECTUAIS E DE INTELIGÊNCIA'
  d.add_table(rows=2,cols=2).cell(0,0).text='WISC'
  d.add_table(rows=1,cols=1).cell(0,0).text='MEMÓRIA E APRENDIZAGEM:'
  d.add_table(rows=1,cols=1).cell(0,0).text='Interpretação e Observações Clínicas:'
  d.save(self.base)
  r=run('inspect',str(self.base))
  self.assertEqual([m['key'] for m in r['markers']],['memoria'])
  self.assertEqual(r['title_ranges'],{'inteligencia':[1,2]})

 def test_title_and_text_on_one_line_are_split(self):
  import importlib.util
  spec=importlib.util.spec_from_file_location('w',WORKER);w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
  long='A pessoa fictícia relatou dormir tarde e acordar cansada na maior parte dos dias da semana.'
  self.assertEqual(w.blocks('## Sono: '+long),[('Sono',True),(long,False)])
  self.assertEqual(w.blocks('## Sono'+chr(10)+chr(10)+'Texto.'),[('Sono',True),('Texto.',False)])

 def test_export_adds_field_for_title_without_one(self):
  d=Document()
  d.add_table(rows=1,cols=1).cell(0,0).text='HABILIDADES INTELECTUAIS E DE INTELIGÊNCIA'
  d.add_table(rows=2,cols=2).cell(0,0).text='WISC'
  d.add_paragraph('Tabela 1. Resultados fictícios.');d.add_paragraph('')
  d.add_table(rows=1,cols=1).cell(0,0).text='MEMÓRIA E APRENDIZAGEM:'
  d.add_table(rows=1,cols=1).cell(0,0).text='Interpretação e Observações Clínicas:'
  d.save(self.base);before=sha(self.base)
  r=run('export',stdin={'base':str(self.base),'out':str(self.out),'sections':{'inteligencia':'Texto manual sintético.','memoria':'Memória sintética.'}})
  self.assertEqual((r['missing'],r['fields_added']),([],['inteligencia']));self.assertEqual(sha(self.base),before)
  body=[e for e in Document(self.out).element.body.iterchildren() if e.tag.endswith('}p') or e.tag.endswith('}tbl')]
  texts=[''.join(t.text or '' for t in e.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t')) for e in body]
  i=texts.index('Tabela 1. Resultados fictícios.')
  self.assertEqual(texts[i+1:i+3],['Interpretação Clínica:','Texto manual sintético.'])
  self.assertEqual(texts.index('MEMÓRIA E APRENDIZAGEM:'),i+4)

 def test_export_creates_missing_section_before_the_next_one(self):
  d=Document()
  d.add_table(rows=1,cols=1).cell(0,0).text='HABILIDADES INTELECTUAIS E DE INTELIGÊNCIA'
  d.add_table(rows=1,cols=1).cell(0,0).text='Interpretação e Observações Clínicas:'
  d.add_table(rows=1,cols=1).cell(0,0).text='MEMÓRIA E APRENDIZAGEM:'
  d.add_table(rows=1,cols=1).cell(0,0).text='Interpretação e Observações Clínicas:'
  d.add_paragraph('HIPÓTESE DIAGNÓSTICA');d.add_paragraph('Cidade Fictícia, 1 de janeiro de 2026.')
  d.save(self.base);before=sha(self.base)
  order=['anamnesis','inteligencia','percepcao','memoria','atencao','conclusao','hipotese','recomendacoes']
  spec={'base':str(self.base),'out':str(self.out),'sections':{'inteligencia':'Inteligência sintética.','percepcao':'Percepção sintética.','memoria':'Memória sintética.','conclusao':'Conclusão sintética.',
        'recomendacoes':'Recomendações sintéticas.'},
        'created':{'keys':['percepcao','conclusao','recomendacoes'],'order':order,'titles':{'percepcao':'Percepção','conclusao':'Conclusão','recomendacoes':'Indicações e recomendações'}}}
  r=run('export',stdin=spec)
  self.assertEqual((sorted(r['created']),r['missing']),(['conclusao','percepcao','recomendacoes'],[]));self.assertEqual(sha(self.base),before)
  body=[e for e in Document(self.out).element.body.iterchildren() if e.tag.endswith('}p') or e.tag.endswith('}tbl')]
  texts=[''.join(t.text or '' for t in e.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t')) for e in body]
  i=texts.index('PERCEPÇÃO')
  self.assertEqual(texts[i+1:i+4],['Interpretação Clínica:','Percepção sintética.',''])
  self.assertEqual(texts[i+4],'MEMÓRIA E APRENDIZAGEM:')
  self.assertLess(texts.index('Inteligência sintética.'),i)
  # not an interpretation: no field label; goes before the next section the file has
  j=texts.index('CONCLUSÃO')
  self.assertEqual(texts[j+1:j+4],['Conclusão sintética.','','HIPÓTESE DIAGNÓSTICA'])
  # nothing after it in the file: right above the closing place/date line
  j=texts.index('INDICAÇÕES E RECOMENDAÇÕES')
  self.assertEqual(texts[j+1:j+4],['Recomendações sintéticas.','','Cidade Fictícia, 1 de janeiro de 2026.'])
  # not chosen: still missing, file untouched there
  spec['created']['keys']=[];r=run('export',stdin=spec)
  self.assertEqual(sorted(r['missing']),['conclusao','percepcao','recomendacoes'])

 def test_bfp_title_gets_its_own_section_before_diva(self):
  d=Document()
  d.add_table(rows=1,cols=1).cell(0,0).text='COMPORTAMENTO:'
  d.add_table(rows=1,cols=1).cell(0,0).text='Interpretação e Observações Clínicas:'
  d.add_table(rows=1,cols=1).cell(0,0).text='BATERIA FATORIAL DA PERSONALIDADE'
  d.add_table(rows=2,cols=2).cell(0,0).text='BFP'
  d.add_table(rows=1,cols=1).cell(0,0).text='Interpretação e Observações Clínicas:'
  d.add_table(rows=2,cols=2).cell(0,0).text='DIVA'
  d.add_table(rows=1,cols=1).cell(0,0).text='Interpretação e Observações Clínicas:'
  d.save(self.base)
  r=run('inspect',str(self.base))
  self.assertEqual([m['key'] for m in r['markers']],['comportamento','personalidade','comportamento_diva'])
  self.assertIn('personalidade',r['titled_domains'])

 def test_stacked_rows_in_one_row_become_separate_rows(self):
  d=Document();t=d.add_table(rows=2,cols=3)
  for c,v in enumerate(['Índice','QI','Classificação']):t.cell(0,c).text=v
  for c,v in enumerate(['Índice A'+chr(10)+'Índice B','90'+chr(10)+'101','Média'+chr(10)+'Média']):t.cell(1,c).text=v
  d.save(self.base)
  e=[e for e in run('inspect',str(self.base))['elements'] if e['type']=='table'][0]
  self.assertEqual(e['rows'],[['Índice','QI','Classificação'],['Índice A','90','Média'],['Índice B','101','Média']])
  self.assertEqual([[c['text'] for c in r] for r in e['grid']],e['rows'])

 def test_grid_keeps_merged_cells_once(self):
  d=Document();t=d.add_table(rows=3,cols=3)
  t.cell(0,0).merge(t.cell(0,2)).text='Título'
  t.cell(1,0).merge(t.cell(2,0)).text='Bloco'
  for r,c,v in [(1,1,'A'),(1,2,'Média'),(2,1,'B'),(2,2,'Média')]:t.cell(r,c).text=v
  d.save(self.base)
  g=[e for e in run('inspect',str(self.base))['elements'] if e['type']=='table'][0]['grid']
  self.assertEqual(g,[[{'text':'Título','rowspan':1,'colspan':3}],[{'text':'Bloco','rowspan':2,'colspan':1},{'text':'A','rowspan':1,'colspan':1},{'text':'Média','rowspan':1,'colspan':1}],[{'text':'B','rowspan':1,'colspan':1},{'text':'Média','rowspan':1,'colspan':1}]])

 def test_inspect_reports_titles_without_field(self):
  d=Document();d.add_paragraph('HABILIDADES INTELECTUAIS E DE INTELIGÊNCIA');d.add_paragraph('MEMÓRIA E APRENDIZAGEM:')
  d.add_table(rows=1,cols=1).cell(0,0).text='Interpretação e observações clínicas:';d.save(self.base)
  r=run('inspect',str(self.base))
  self.assertEqual([m['key'] for m in r['markers']],['memoria'])
  self.assertEqual(r['titled_domains'],['inteligencia','memoria'])

def word_constructs_base(path):
 """Synthetic file with what Word users leave behind: text typed with Track changes on (w:ins), deleted text
 (w:del), inline and block content controls (w:sdt), a smart tag and a simple field. All content fictitious."""
 from docx.oxml import OxmlElement
 from docx.oxml.ns import qn
 def run(text):
  r=OxmlElement('w:r');t=OxmlElement('w:t');t.set(qn('xml:space'),'preserve');t.text=text;r.append(t);return r
 def el(tag,*kids,**attrs):
  e=OxmlElement(tag)
  for k,v in attrs.items():e.set(qn('w:'+k),v)
  for c in kids:e.append(c)
  return e
 track=dict(id='1',author='Fictícia',date='2030-01-01T00:00:00Z')
 d=Document();sect=d.element.body.sectPr;add=sect.addprevious
 add(el('w:p',run('Nome: '),el('w:ins',run('Paciente Fictício'),**track)))
 add(el('w:p',run('ANAMNESE')));add(el('w:p',run('Histórico fictício.')))
 add(el('w:p',el('w:sdt',el('w:sdtPr'),el('w:sdtContent',run('PERCEPÇÃO')))))
 t=d.add_table(rows=1,cols=2);t.cell(0,0).text='Teste A';t.cell(0,1).text='91';add(t._tbl)
 add(el('w:p',el('w:ins',run('Interpretação Clínica:'),**track)))
 blk=el('w:sdtContent',el('w:p',run('MEMÓRIA E APRENDIZAGEM')))
 t2=d.add_table(rows=1,cols=2);t2.cell(0,0).text='Teste B';t2.cell(0,1).text='104';blk.append(t2._tbl)
 blk.append(el('w:p',run('Interpretação Clínica:')));add(el('w:sdt',el('w:sdtPr'),blk))
 dl=el('w:del',el('w:r',el('w:delText')),**track);dl[0][0].text=' TEXTO APAGADO';add(el('w:p',run('ATENÇÃO'),dl))
 add(el('w:p',el('w:smartTag',run('Interpretação Clínica:'),uri='urn:x',element='x')))
 add(el('w:p',el('w:fldSimple',run('FUNÇÕES EXECUTIVAS'),instr=' QUOTE x ')))
 add(el('w:p',run('Interpretação Clínica:')))
 d.save(path)

class TestWordConstructs(unittest.TestCase):
 """The reader sees the text Word shows, not only the paragraph's direct runs (python-docx Paragraph.text)."""
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.dir=Path(self.tmp.name)
  self.base=self.dir/'base.docx';self.out=self.dir/'out.docx';word_constructs_base(self.base)
 def tearDown(self):self.tmp.cleanup()

 def test_inspect_reads_tracked_inserts_content_controls_fields_and_skips_deleted_text(self):
  r=run('inspect',str(self.base))
  self.assertEqual([m['key'] for m in r['markers']],['anamnesis','percepcao','memoria','atencao','funcoes_executivas'])
  self.assertEqual(r['identification']['Nome'],'Paciente Fictício')
  texts=[e.get('text') for e in r['elements'] if e['type']=='p']
  self.assertIn('PERCEPÇÃO',texts);self.assertIn('MEMÓRIA E APRENDIZAGEM',texts);self.assertIn('FUNÇÕES EXECUTIVAS',texts)
  self.assertIn('ATENÇÃO',texts);self.assertFalse(any('APAGADO' in (t or '') for t in texts))
  self.assertIn([['Teste B','104']],[e.get('rows') for e in r['elements']])

 def test_export_writes_into_those_sections_and_keeps_tracked_text_untouched(self):
  before=sha(self.base)
  sections={k:f'Texto fictício de {k}.' for k in ('percepcao','memoria','atencao','funcoes_executivas')}
  r=run('export',stdin={'base':str(self.base),'out':str(self.out),'sections':sections,'fields':{'Nome':'Outro Nome'}})
  self.assertEqual(r['missing'],[]);self.assertEqual(sha(self.base),before)
  out=Document(self.out);xml=out.element.body.xml
  for v in sections.values():self.assertEqual(xml.count(v),1,v)
  # a value typed with track changes is not rewritten (the tracked insertion stays as the author left it)
  self.assertNotIn('Nome',r['fields_filled']);self.assertIn('Paciente Fictício',xml);self.assertNotIn('Outro Nome',xml)
  self.assertIn('TEXTO APAGADO',xml)   # deleted text stays in the file, as a deletion

class TestEditedReport(unittest.TestCase):
 def test_blocks_rebuild_the_report_keeping_page_setup_and_formatting(self):
  with tempfile.TemporaryDirectory() as t:
   base=Path(t)/'b.docx';synthetic_base(str(base));out=Path(t)/'o.docx'
   blocks=[{'t':'p','align':'center','runs':[{'text':'TÍTULO','b':True,'size':14}]},
    {'t':'p','line':1.5,'after':6,'runs':[{'text':'Texto ','i':True},{'text':'vermelho','color':'#FF0000'}]},
    {'t':'pagebreak'},
    {'t':'table','rows':[[{'blocks':[{'t':'p','runs':[{'text':'A'}]}]},{'blocks':[{'t':'p','runs':[{'text':'1'}]}]}]]}]
   before=sha(base);run('blocks',stdin={'base':str(base),'out':str(out),'blocks':blocks})
   self.assertEqual(sha(base),before,'the base never changes')
   d=Document(out);ps=[p for p in d.paragraphs if p.text]
   self.assertEqual([p.text for p in ps],['TÍTULO','Texto vermelho'])
   self.assertTrue(ps[0].runs[0].bold);self.assertEqual(ps[0].runs[0].font.size.pt,14.0);self.assertEqual(ps[0].alignment,1)
   self.assertEqual(ps[1].paragraph_format.line_spacing,1.5);self.assertTrue(ps[1].runs[0].italic);self.assertEqual(str(ps[1].runs[1].font.color.rgb),'FF0000')
   self.assertEqual([c.text for c in d.tables[0].rows[0].cells],['A','1'])
   self.assertEqual(d.sections[0].page_width,Document(base).sections[0].page_width,'page setup of the report')

class TestEditedReportKeep(unittest.TestCase):
 def test_elements_not_edited_are_copied_exactly_and_a_wrong_count_is_refused(self):
  with tempfile.TemporaryDirectory() as t:
   src=Path(t)/'s.docx';d=Document();d.add_paragraph('Topo fictício')
   tb=d.add_table(rows=1,cols=1);tb.style='Light List Accent 1';tb.cell(0,0).paragraphs[0].add_run('TÍTULO FICTÍCIO').bold=True
   d.add_paragraph('Texto sintético.');d.save(src);out=Path(t)/'o.docx'
   run('blocks',stdin={'base':str(src),'out':str(out),'count':3,'blocks':[{'t':'keep','i':0},{'t':'keep','i':1},{'t':'p','runs':[{'text':'Texto sintético. Editado.'}]}]})
   o=Document(out);self.assertEqual(o.tables[0].style.name,'Light List Accent 1');self.assertEqual(o.tables[0].cell(0,0).text,'TÍTULO FICTÍCIO')
   self.assertEqual([p.text for p in o.paragraphs],['Topo fictício','Texto sintético. Editado.'])
   with self.assertRaises(AssertionError):run('blocks',stdin={'base':str(src),'out':str(Path(t)/'x.docx'),'count':7,'blocks':[{'t':'keep','i':0}]})

class TestLetter(unittest.TestCase):
 def test_letter_builds_a_new_document_with_titles_and_paragraphs(self):
  with tempfile.TemporaryDirectory() as t:
   out=Path(t)/'devolutiva.docx'
   r=run('letter',stdin={'out':str(out),'title':'Devolutiva','subtitle':'Pessoa Fictícia','content':'## Pontos fortes\n\nTexto sintético.\n\n## Como ajudar\n\nOrientação sintética.'})
   ps=[(p.text,any(x.bold for x in p.runs)) for p in Document(out).paragraphs]
   self.assertEqual(ps[0],('Devolutiva',True));self.assertIn(('Pontos fortes',True),ps);self.assertIn(('Orientação sintética.',False),ps)
   self.assertEqual(r['paragraphs'],4)
   self.assertNotIn(('',False),ps[3:],'no blank paragraphs between topics')
 def test_letter_never_overwrites(self):
  with tempfile.TemporaryDirectory() as t:
   out=Path(t)/'x.docx';out.write_bytes(b'existente')
   with self.assertRaises(AssertionError):run('letter',stdin={'out':str(out),'content':'Texto.'})
   self.assertEqual(out.read_bytes(),b'existente')

 def test_export_removes_only_the_excluded_section(self):
  """Approved exception to rule 2: a section left out by the psychologist loses its title, tables and texts in the
  copy; the next section, the closing line and the base file stay untouched."""
  tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);self.dir=Path(tmp.name);self.out=self.dir/'out.docx'
  base=self.dir/'titled.docx';d=Document()
  d.add_paragraph('DESCRIÇÃO DA DEMANDA');d.add_paragraph('Demanda fictícia.')
  for title,score in (('PERCEPÇÃO','91'),('MEMÓRIA E APRENDIZAGEM','104')):
   d.add_paragraph(title);t=d.add_table(rows=1,cols=2);t.cell(0,0).text='Teste fictício';t.cell(0,1).text=score
   d.add_paragraph('Texto fixo fictício de '+title.lower()+'.');d.add_paragraph('Interpretação Clínica:')
  d.add_paragraph('Cidade Fictícia, 1 de janeiro de 2030.');d.save(base)
  before=sha(base)
  r=run('export',stdin={'base':str(base),'out':str(self.out),'sections':{'percepcao':'Não deve entrar.','memoria':'Memória fictícia.'},'excluded':['percepcao']})
  self.assertEqual(r['excluded'],['percepcao']);self.assertEqual(sha(base),before)
  out=Document(self.out);texts=[p.text for p in out.paragraphs]
  self.assertNotIn('PERCEPÇÃO',texts);self.assertNotIn('Não deve entrar.',texts);self.assertNotIn('Texto fixo fictício de percepção.',texts)
  self.assertEqual([[c.text for c in row.cells] for t in out.tables for row in t.rows],[['Teste fictício','104']])
  for kept in ('DESCRIÇÃO DA DEMANDA','Demanda fictícia.','MEMÓRIA E APRENDIZAGEM','Texto fixo fictício de memória e aprendizagem.','Memória fictícia.'):self.assertIn(kept,texts)
  # the last section, excluded, stops at the closing place/date line
  r=run('export',stdin={'base':str(base),'out':str(self.dir/'last.docx'),'sections':{},'excluded':['memoria']})
  last=[p.text for p in Document(self.dir/'last.docx').paragraphs]
  self.assertNotIn('MEMÓRIA E APRENDIZAGEM',last);self.assertIn('PERCEPÇÃO',last);self.assertEqual(last[-1],'Cidade Fictícia, 1 de janeiro de 2030.')
  # nothing excluded: same result as before the feature
  r=run('export',stdin={'base':str(base),'out':str(self.dir/'all.docx'),'sections':{}})
  self.assertEqual(r['excluded'],[]);self.assertIn('PERCEPÇÃO',[p.text for p in Document(self.dir/'all.docx').paragraphs])

 def test_export_keeps_the_font_chosen_in_the_editor(self):
  tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);d=Path(tmp.name)
  base=d/'b.docx';out=d/'o.docx';synthetic_base(base)
  html='<p>Texto <span style="font-family: Georgia">fictício</span> e <span style="font-family: Comic Sans MS">outro</span>.</p>'
  run('export',stdin={'base':str(base),'out':str(out),'sections':{'anamnesis':'Texto fictício e outro.'},'rich':{'anamnesis':html}})
  runs=[r for p in Document(out).paragraphs if p.text=='Texto fictício e outro.' for r in p.runs]
  fonts={r.text.strip():r.font.name for r in runs if r.text.strip()}
  self.assertEqual(fonts['fictício'],'Georgia')
  self.assertNotEqual(fonts['outro'],'Comic Sans MS')   # fonts outside the editor list are ignored

if __name__=='__main__':unittest.main()
