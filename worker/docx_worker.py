#!/usr/bin/env python3
"""Isolated DOCX reader / conservative content inserter. Never overwrites the original."""
import sys,json,re,os
from docx import Document
from docx.oxml import OxmlElement
from docx.text.paragraph import Paragraph

TARGETS = [
 ('inteligencia','HABILIDADES INTELECTUAIS E DE INTELIGÊNCIA'),
 ('percepcao','PERCEPÇÃO E NOÇÕES BÁSICAS'),
 ('memoria','MEMÓRIA E APRENDIZAGEM'),
 ('atencao','PROCESSOS ATENCIONAIS'),
 ('funcoes_executivas','FUNÇÕES EXECUTIVAS'),
 ('comportamento','COMPORTAMENTO'),
]
HEADINGS={'ANAMNESE','CONCLUSÃO/RESULTADOS','HIPÓTESE DIAGNÓSTICA','REFERÊNCIAS'}
def clean(v):return re.sub(r'\s+',' ',v or '').strip()
def all_elements(doc):
 for ch in doc.element.body.iterchildren():
  if ch.tag.endswith('}p'):
   p=Paragraph(ch,doc)
   yield {'type':'p','text':clean(p.text)}
  elif ch.tag.endswith('}tbl'):
   from docx.table import Table
   tbl=Table(ch,doc)
   yield {'type':'table','rows':[[clean(c.text) for c in row.cells] for row in tbl.rows]}
def inspect(path):
 d=Document(path); elements=list(all_elements(d)); markers=[]
 slots=['inteligencia','percepcao','memoria','atencao','funcoes_executivas','comportamento','comportamento_diva']
 n=0
 for i,e in enumerate(elements):
  txt=e.get('text','') if e['type']=='p' else ' '.join(x for row in e['rows'] for x in row)
  label=clean(txt).upper()
  if label=='ANAMNESE':markers.append({'key':'anamnesis','index':i,'label':txt})
  if ('INTERPRETAÇÃO E OBSERVAÇÕES CLÍNICAS' in label or label=='INTERPRETAÇÃO CLÍNICA:') and len(label)<130:
   if n<len(slots):markers.append({'key':slots[n],'index':i,'label':txt});n+=1
 return {'elements':elements,'markers':markers,'warnings':['Conferir visualmente a ordem dos marcadores e os resultados.']}
def export(base,out,sections):
 d=Document(base); slots=['inteligencia','percepcao','memoria','atencao','funcoes_executivas','comportamento','comportamento_diva'];seen=[]; n=0
 from docx.table import Table
 for ch in list(d.element.body.iterchildren()):
  if ch.tag.endswith('}p'):
   p=Paragraph(ch,d); text=clean(p.text)
   destination=('anamnesis' if text.upper()=='ANAMNESE' else None)
   if ('INTERPRETAÇÃO E OBSERVAÇÕES CLÍNICAS' in text.upper() or text.upper()=='INTERPRETAÇÃO CLÍNICA:') and len(text)<130:
    destination=slots[n] if n<len(slots) else None;n+=1
   if destination in sections and clean(sections[destination]):
    elt=OxmlElement('w:p');ch.addnext(elt);Paragraph(elt,p._parent).add_run(sections[destination]);seen.append(destination)
  elif ch.tag.endswith('}tbl'):
   t=Table(ch,d);text=clean(' '.join(c.text for r in t.rows for c in r.cells))
   destination='anamnesis' if text.upper()=='ANAMNESE' else None
   if ('INTERPRETAÇÃO E OBSERVAÇÕES CLÍNICAS' in text.upper() or text.upper()=='INTERPRETAÇÃO CLÍNICA:') and len(text)<130:
    destination=slots[n] if n<len(slots) else None;n+=1
   if destination in sections and clean(sections[destination]):
    # Append within same heading cell; preserve heading and all existing table values.
    t.cell(len(t.rows)-1,0).add_paragraph(sections[destination]);seen.append(destination)
 d.save(out)
 return {'inserted':seen,'missing':[k for k in sections if k not in seen]}
def main():
 op=sys.argv[1]
 if op=='inspect': print(json.dumps(inspect(sys.argv[2]),ensure_ascii=False))
 elif op=='export':
  spec=json.load(sys.stdin); print(json.dumps(export(spec['base'],spec['out'],spec['sections']),ensure_ascii=False))
 else: raise SystemExit('unknown operation')
if __name__=='__main__':main()
