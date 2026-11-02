#!/usr/bin/env python3
"""Isolated DOCX reader / conservative content inserter. Never overwrites the original.

Inserted text becomes new body paragraphs placed right after each destination marker
(heading box or "Interpretação Clínica:" line). Existing elements are never edited.
Section content format: blank line separates paragraphs; a line starting with "## " is a bold topic title.
"""
import sys,json,re,os,hashlib
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph
from docx.table import Table

SLOTS=['inteligencia','percepcao','memoria','atencao','funcoes_executivas','comportamento','comportamento_diva']
# Fixed (non-interpretation) destinations, matched by label prefix after normalisation.
FIXED=[
 ('demanda',('DESCRIÇÃO DA DEMANDA',)),
 ('anamnesis',('ANAMNESE',)),
 ('conclusao',('CONCLUSÃO',)),
 ('recomendacoes',('INDICAÇÕES E RECOMENDAÇÕES','SUGESTÕES E ENCAMINHAMENTOS')),
]
def clean(v):return re.sub(r'\s+',' ',v or '').strip()
def element_text(ch,doc):
 if ch.tag.endswith('}p'):return clean(Paragraph(ch,doc).text)
 if ch.tag.endswith('}tbl'):return clean(' '.join(c.text for r in Table(ch,doc).rows for c in r.cells))
 return ''
def is_interpretation(label):
 return len(label)<130 and ('INTERPRETAÇÃO E OBSERVAÇÕES CLÍNICAS' in label or label=='INTERPRETAÇÃO CLÍNICA:')
class Markers:
 """Maps marker labels to section keys; interpretation markers are numbered in document order."""
 def __init__(self):self.n=0;self.used=set()
 def key(self,text):
  label=clean(text).upper()
  if is_interpretation(label):
   k=SLOTS[self.n] if self.n<len(SLOTS) else None;self.n+=1;return k
  if len(label)>80:return None
  for k,prefixes in FIXED:
   if k not in self.used and any(label.rstrip(':').startswith(p) for p in prefixes):self.used.add(k);return k
  return None

def all_elements(doc):
 for ch in doc.element.body.iterchildren():
  if ch.tag.endswith('}p'):
   yield {'type':'p','text':clean(Paragraph(ch,doc).text)}
  elif ch.tag.endswith('}tbl'):
   yield {'type':'table','rows':[[clean(c.text) for c in row.cells] for row in Table(ch,doc).rows]}
def inspect(path):
 d=Document(path);elements=list(all_elements(d));markers=[];m=Markers()
 for i,e in enumerate(elements):
  txt=e['text'] if e['type']=='p' else ' '.join(x for row in e['rows'] for x in row)
  k=m.key(txt)
  if k:markers.append({'key':k,'index':i,'label':txt})
 return {'elements':elements,'markers':markers,'warnings':['Conferir visualmente a ordem dos marcadores e os resultados.']}

def new_paragraph(text,bold=False,red=False):
 """Body paragraph matching the report layout: Arial 11, justified, 1.5 line spacing."""
 p=OxmlElement('w:p');ppr=OxmlElement('w:pPr')
 sp=OxmlElement('w:spacing');sp.set(qn('w:line'),'360');sp.set(qn('w:lineRule'),'auto');ppr.append(sp)
 ind=OxmlElement('w:ind');ind.set(qn('w:left'),'0');ind.set(qn('w:firstLine'),'0');ppr.append(ind)
 jc=OxmlElement('w:jc');jc.set(qn('w:val'),'both');ppr.append(jc);p.append(ppr)
 if text:
  r=OxmlElement('w:r');rpr=OxmlElement('w:rPr')
  f=OxmlElement('w:rFonts')
  for a in ('ascii','hAnsi','cs','eastAsia'):f.set(qn('w:'+a),'Arial')
  rpr.append(f)
  if bold:rpr.append(OxmlElement('w:b'));rpr.append(OxmlElement('w:bCs'))
  if red:c=OxmlElement('w:color');c.set(qn('w:val'),'FF0000');rpr.append(c)
  for tag in ('w:sz','w:szCs'):s=OxmlElement(tag);s.set(qn('w:val'),'22');rpr.append(s)
  r.append(rpr);t=OxmlElement('w:t');t.set(qn('xml:space'),'preserve');t.text=text;r.append(t);p.append(r)
 return p
def blocks(content):
 """Split section text into (text,bold) paragraphs; blank paragraph between topics."""
 out=[]
 for chunk in re.split(r'\n\s*\n',content.replace('\r','').strip()):
  for line in [l.strip() for l in chunk.split('\n') if l.strip()]:
   # ChatGPT often marks topic titles as a whole bold line instead of "## ".
   whole_bold=re.fullmatch(r'\*\*([^*]{1,80})\*\*:?',line)
   if whole_bold:line='## '+whole_bold.group(1)
   line=re.sub(r'\*\*(.+?)\*\*',r'\1',line)
   if line.startswith('#'):
    if out:out.append(('',False))
    out.append((line.lstrip('#').strip(),True))
   else:out.append((line,False))
 return out
def insert_after(anchor,content,red=False):
 last=anchor
 for text,bold in blocks(content):
  p=new_paragraph(text,bold,red);last.addnext(p);last=p

def sha256(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for chunk in iter(lambda:f.read(65536),b''):h.update(chunk)
 return h.hexdigest()
def export(base,out,sections,highlight=False):
 if os.path.abspath(base)==os.path.abspath(out):raise SystemExit('out must differ from base')
 before=sha256(base)
 d=Document(base);seen=[];m=Markers()
 for ch in list(d.element.body.iterchildren()):
  if not (ch.tag.endswith('}p') or ch.tag.endswith('}tbl')):continue
  k=m.key(element_text(ch,d))
  if k in sections and clean(sections[k]) and k not in seen:
   insert_after(ch,sections[k],highlight);seen.append(k)
 d.save(out)
 after=sha256(base)
 if before!=after:raise SystemExit('base document changed during export')
 return {'inserted':seen,'missing':[k for k in sections if k not in seen],'base_sha256':before,'out_sha256':sha256(out)}
def main():
 op=sys.argv[1]
 sys.stdout.reconfigure(encoding='utf-8')
 if op=='inspect': print(json.dumps(inspect(sys.argv[2]),ensure_ascii=False))
 elif op=='export':
  spec=json.loads(sys.stdin.buffer.read().decode('utf-8')); print(json.dumps(export(spec['base'],spec['out'],spec['sections'],spec.get('highlight',False)),ensure_ascii=False))
 else: raise SystemExit('unknown operation')
if __name__=='__main__':main()
