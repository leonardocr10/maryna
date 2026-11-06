#!/usr/bin/env python3
"""Isolated DOCX reader / conservative content inserter. Never overwrites the original.

Inserted text becomes new body paragraphs placed right after each destination marker
(heading box or "Interpretação Clínica:" line). Old narrative already sitting in that destination
is replaced; everything else (tables, charts, fixed text, references) is never edited.
Section content format: blank line separates paragraphs; a line starting with "## " is a bold topic title.
"""
import sys,json,re,os,hashlib,zipfile
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph
from docx.table import Table

SLOTS=['inteligencia','percepcao','memoria','atencao','funcoes_executivas','comportamento','personalidade','comportamento_diva']
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
# Section titles that say which domain the next interpretation marker belongs to (templates differ in order).
DOMAINS=[
 ('inteligencia',('HABILIDADES INTELECTUAIS',)),
 ('percepcao',('PERCEPÇÃO',)),
 ('memoria',('MEMÓRIA',)),
 ('atencao',('PROCESSOS ATENCIONAIS','ATENÇÃO')),
 ('funcoes_executivas',('FUNÇÕES EXECUTIVAS',)),
 ('personalidade',('BATERIA FATORIAL',)),
 ('comportamento',('COMPORTAMENTO',)),
]
def domain_of(text):
 """Domain key when the text is an all-caps section title, else None."""
 t=clean(text)
 if len(t)>80 or t!=t.upper():return None
 for k,prefixes in DOMAINS:
  if t.startswith(prefixes):return k
 return None
class Markers:
 """Maps marker labels to section keys. An interpretation takes the domain of the title before it,
 or the next free slot in document order when there is no such title."""
 def __init__(self):self.used=set();self.domain=None;self.last=None
 def _slot(self):
  k=self.domain;self.domain=None
  # a second untitled field in the behaviour section (after its own field or the BFP one) is the DIVA slot
  if (k is None and self.last in ('comportamento','personalidade')) or (k=='comportamento' and k in self.used):k='comportamento_diva'
  if k is None or k in self.used:k=next((s for s in SLOTS if s not in self.used),None)
  if k:self.used.add(k)
  self.last=k
  return k
 def key(self,text):
  label=clean(text).upper()
  if is_interpretation(label):return self._slot()
  if len(label)>80:return None
  for k,prefixes in FIXED:
   if k not in self.used and any(label.rstrip(':').startswith(p) for p in prefixes):self.used.add(k);return k
  self.domain=domain_of(text) or self.domain
  return None

# ---- Old narrative inside a destination ----
# Fixed report text that follows some destinations and must survive the replacement.
KEEP_RE=re.compile(r'^(REFER[ÊE]NCIAS|HIP[ÓO]TESE|TABELA\b|SUBTESTES D|BASE CONCEITUAL|SALIENTA-SE|À EQUIPE|LAUDO REALIZADO|_{3,})')
def is_boundary(text):
 """True for a paragraph that starts other content: replacement stops before it."""
 label=clean(text).upper()
 if KEEP_RE.match(label) or is_interpretation(label):return True
 if len(label)>80:return False
 # a title is all caps or ends with a colon; "Conclusão antiga." is still narrative
 looks_like_title=clean(text)==label or label.endswith(':')
 return domain_of(text) is not None or (looks_like_title and any(label.rstrip(':').startswith(p) for _,ps in FIXED for p in ps))
def has_protected_content(p):
 """Charts, images, section breaks and manual page breaks are layout, not narrative."""
 W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
 return any(True for tag in ('drawing','pict','object','sectPr') for _ in p.iter(W+tag)) or any(b.get(W+'type')=='page' for b in p.iter(W+'br'))
def existing_narrative(marker,doc):
 """Paragraphs with old text right after a marker, up to the next table, chart or fixed text.
 Trailing blank lines stay, so the spacing of the template is kept."""
 run=[];last=-1;sib=marker.getnext()
 while sib is not None and sib.tag.endswith('}p') and not has_protected_content(sib):
  text=clean(Paragraph(sib,doc).text)
  if text and is_boundary(Paragraph(sib,doc).text):break
  run.append(sib)
  if text:last=len(run)-1
  sib=sib.getnext()
 return run[:last+1]

MAX_UNZIPPED=200*1024*1024;MAX_ENTRIES=5000
def open_docx(path):
 """Document() with a zip-bomb guard: rejects archives that expand too much or hold too many entries."""
 with zipfile.ZipFile(path) as z:
  infos=z.infolist()
  if len(infos)>MAX_ENTRIES or sum(i.file_size for i in infos)>MAX_UNZIPPED:raise SystemExit('docx too large when uncompressed')
  if 'word/document.xml' not in z.namelist():raise SystemExit('not a Word document')
 return Document(path)
def stacked_lines(texts):
 """Some templates put several results in one row, one per line inside each cell (e.g. three indexes and
 their scores). When every cell of the row has the same number of lines, those lines are separate rows."""
 lines=[[clean(x) for x in t.split(chr(10)) if clean(x)] for t in texts]
 n=len(lines[0]) if lines else 0
 return [list(r) for r in zip(*lines)] if n>1 and all(len(l)==n for l in lines) else None
def table_rows(table):
 """Plain rows of cell text, with stacked rows split apart."""
 out=[]
 for i,row in enumerate(table.rows):
  texts=[c.text for c in row.cells]
  # the header row keeps its line breaks ("SOMA DOS / ESCORES T" is one title)
  out.extend((i and stacked_lines(texts)) or [[clean(t) for t in texts]])
 return out
def table_grid(table):
 """Rows of {text,rowspan,colspan} for display: merged cells appear once, as in the document."""
 grid=[];cells={}
 for row in table.rows:
  line=[];new=set();counted=set()
  for c in row.cells:
   tc=c._tc
   if tc in new:cells[tc]['colspan']+=1
   elif tc in cells:
    if tc not in counted:cells[tc]['rowspan']+=1;counted.add(tc)
   else:
    cells[tc]={'text':clean(c.text),'raw':c.text,'rowspan':1,'colspan':1};new.add(tc);line.append(cells[tc])
  grid.append(line)
 out=[];width=max((sum(c['colspan'] for c in l) for l in grid),default=0)
 for i,line in enumerate(grid):
  # header and rows with merged cells stay as they are; plain stacked rows become one row per line
  plain=i and len(line)==width and all(c['rowspan']==1 and c['colspan']==1 for c in line)
  split=stacked_lines([c['raw'] for c in line]) if plain else None
  out.extend([[{'text':t,'rowspan':1,'colspan':1} for t in r] for r in split] if split else [line])
 for line in out:
  for c in line:c.pop('raw',None)
 return out
def all_elements(doc):
 for ch in doc.element.body.iterchildren():
  if ch.tag.endswith('}p'):
   yield {'type':'p','text':clean(Paragraph(ch,doc).text)}
  elif ch.tag.endswith('}tbl'):
   t=Table(ch,doc);yield {'type':'table','rows':table_rows(t),'grid':table_grid(t)}
def section_ranges(elements,markers):
 """Elements that belong to each interpretation: from its section title to the next title, so tables placed
 after the interpretation field still count. A section with another interpretation ahead ends at its own field."""
 text=lambda e:e['text'] if e['type']=='p' else ' '.join(x for row in e['rows'] for x in row)
 fields=[m['index'] for m in markers if m['key'] in SLOTS]
 titles=sorted({i for i,e in enumerate(elements) if domain_of(text(e))}|{m['index'] for m in markers if m['key'] not in SLOTS})
 for m in markers:
  if m['key'] not in SLOTS:continue
  i=m['index']
  start=max([t for t in titles if t<i]+[f for f in fields if f<i]+[-1])+1
  next_title=min([t for t in titles if t>i],default=None);next_field=min([f for f in fields if f>i],default=None)
  if next_field is not None and (next_title is None or next_field<next_title):end=i
  else:end=next_title if next_title is not None else len(elements)
  m['section_start'],m['section_end']=start,end
def title_ranges(elements,markers):
 """For a section whose title exists but has no interpretation field: its elements, from the title to the next
 title or field. Lets a draft be written from its tables even though the export has no place to put it."""
 text=lambda e:e['text'] if e['type']=='p' else ' '.join(x for row in e['rows'] for x in row)
 has_field={m['key'] for m in markers}
 titles=[(i,domain_of(text(e))) for i,e in enumerate(elements) if domain_of(text(e))]
 stops=sorted({i for i,_ in titles}|{m['index'] for m in markers})
 out={}
 for i,k in titles:
  if k in has_field or k in out:continue
  out[k]=[i+1,min([s for s in stops if s>i],default=len(elements))]
 return out
def inspect(path):
 d=open_docx(path);elements=list(all_elements(d));markers=[];m=Markers()
 children=[ch for ch in d.element.body.iterchildren() if ch.tag.endswith('}p') or ch.tag.endswith('}tbl')]
 position={ch:i for i,ch in enumerate(children)}
 for i,e in enumerate(elements):
  txt=e['text'] if e['type']=='p' else ' '.join(x for row in e['rows'] for x in row)
  k=m.key(txt)
  if k:
   old=existing_narrative(children[i],d)
   # old text is flagged so it is never sent to the AI as if it were evidence
   for ch in old:elements[position[ch]]['replaceable']=k
   markers.append({'key':k,'index':i,'label':txt,'existing_paragraphs':sum(1 for ch in old if clean(Paragraph(ch,d).text)),'existing_text':'\n\n'.join(t for t in (Paragraph(ch,d).text.strip() for ch in old) if t)})
 section_ranges(elements,markers)
 titled=sorted({domain_of(e['text'] if e['type']=='p' else ' '.join(x for row in e['rows'] for x in row)) for e in elements}-{None})
 return {'elements':elements,'markers':markers,'titled_domains':titled,'title_ranges':title_ranges(elements,markers),'identification':identification(d),'warnings':['Conferir visualmente a ordem dos marcadores e os resultados.']}

REPORT_FONT='Arial';REPORT_HALF_POINTS='22'  # Arial 11 pt
def run_props(bold=False,red=False):
 rpr=OxmlElement('w:rPr')
 f=OxmlElement('w:rFonts')
 for a in ('ascii','hAnsi','cs','eastAsia'):f.set(qn('w:'+a),REPORT_FONT)
 rpr.append(f)
 if bold:rpr.append(OxmlElement('w:b'));rpr.append(OxmlElement('w:bCs'))
 if red:c=OxmlElement('w:color');c.set(qn('w:val'),'FF0000');rpr.append(c)
 for tag in ('w:sz','w:szCs'):s=OxmlElement(tag);s.set(qn('w:val'),REPORT_HALF_POINTS);rpr.append(s)
 return rpr
def new_paragraph(text,bold=False,red=False):
 """Body paragraph matching the report layout: Arial 11 pt, justified, 1.5 line spacing."""
 p=OxmlElement('w:p');ppr=OxmlElement('w:pPr')
 sp=OxmlElement('w:spacing');sp.set(qn('w:line'),'360');sp.set(qn('w:lineRule'),'auto');ppr.append(sp)
 ind=OxmlElement('w:ind');ind.set(qn('w:left'),'0');ind.set(qn('w:firstLine'),'0');ppr.append(ind)
 jc=OxmlElement('w:jc');jc.set(qn('w:val'),'both');ppr.append(jc)
 ppr.append(run_props(bold))  # paragraph mark too, so blank lines between topics are also Arial 11
 p.append(ppr)
 if text:
  r=OxmlElement('w:r');r.append(run_props(bold,red))
  t=OxmlElement('w:t');t.set(qn('xml:space'),'preserve');t.text=text;r.append(t);p.append(r)
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
    line=line.lstrip('#').strip()
    # "## Título: texto..." on one line: bold title, then the text as a normal paragraph
    inline=re.fullmatch(r'([^:.]{2,80}):\s+(.+)',line) if len(line)>80 else None
    if inline:out.append((inline.group(1).strip(),True));out.append((inline.group(2).strip(),False))
    else:out.append((line,True))
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
# Identification fields at the top of the report ("Nome: ...", "Data de início da avaliação: ...   Data da finalização do laudo: ...").
# Only the value after the colon is ever replaced; labels, other text, tables and scores are untouched.
ID_LABELS=['Nome','Data de Nascimento','Idade','Sexo','Escolaridade','Data de início da avaliação','Data da finalização do laudo']
def field_spans(text):
 """{label:(start,end)} of each identification value in a paragraph; values end at 3+ spaces, a tab, the next label
 of the same line or line end."""
 spans={}
 starts=sorted(x.start() for l in ID_LABELS for x in re.finditer(r'(?<![\w])'+re.escape(l)+r'\s*:',text,re.I))
 for label in ID_LABELS:
  m=re.search(r'(?<![\w])'+re.escape(label)+r'\s*:[  ]*(.*?)[  ]*(?=[  ]{3,}|\t|$)',text,re.I)
  if not m:continue
  a,b=m.start(1),m.end(1)
  # a second label on the same line ends this value ("Data de início da avaliação: - Data da finalização do laudo: -")
  nxt=next((x for x in starts if a<=x<b),None)
  if nxt is not None:
   b=nxt
   while b>a and text[b-1].isspace():b-=1
  spans[label]=(a,b)
 return spans
def identification(doc):
 """Values currently written in the identification lines (before the first section heading)."""
 out={};m=Markers()
 for ch in doc.element.body.iterchildren():
  if not ch.tag.endswith('}p'):
   if ch.tag.endswith('}tbl') and m.key(element_text(ch,doc)):break
   continue
  text=Paragraph(ch,doc).text
  for label,(a,b) in field_spans(text).items():out.setdefault(label,text[a:b].strip())
 return out
def replace_span(p,start,end,new):
 """Replace characters [start,end) of a paragraph, keeping the formatting of the run where the value starts."""
 runs=list(p.runs)
 if ''.join(r.text for r in runs)!=p.text:return False  # hyperlinks/fields inside: leave untouched
 pos=0;done=False
 for r in runs:
  rs,re_=pos,pos+len(r.text);pos=re_
  if not done and rs<=start<=re_ and (start<re_ or end==start or re_==len(p.text)):
   a=start-rs;b=min(end,re_)-rs;r.text=r.text[:a]+new+r.text[b:];done=True
  elif done and rs<end:
   b=min(end,re_)-rs;r.text=r.text[b:]
 return done
def fill_fields(doc,fields):
 filled=[];m=Markers()
 for ch in list(doc.element.body.iterchildren()):
  if ch.tag.endswith('}tbl'):
   if m.key(element_text(ch,doc)):break
   continue
  if not ch.tag.endswith('}p'):continue
  p=Paragraph(ch,doc)
  # right-to-left so earlier offsets stay valid
  for label,(a,b) in sorted(field_spans(p.text).items(),key=lambda x:-x[1][0]):
   value=fields.get(label)
   if value is None or label in filled:continue
   if p.text[a:b]==value or replace_span(p,a,b,value):filled.append(label)
 return filled
FIELD_LABEL='Interpretação Clínica:'
def fieldless_anchors(d):
 """{key: last element of the section} for sections whose title exists but that have no interpretation field.
 The export adds the field label and the text right after it, i.e. after the section's tables and captions."""
 elements=list(all_elements(d));m=Markers();markers=[]
 children=[ch for ch in d.element.body.iterchildren() if ch.tag.endswith('}p') or ch.tag.endswith('}tbl')]
 for i,e in enumerate(elements):
  k=m.key(e['text'] if e['type']=='p' else ' '.join(x for row in e['rows'] for x in row))
  if k:markers.append({'key':k,'index':i})
 out={}
 for k,(start,end) in title_ranges(elements,markers).items():
  # skip trailing blank paragraphs so the new field sits right under the last table or caption
  last=max([i for i in range(start-1,end) if elements[i]['type']=='table' or elements[i].get('text')],default=start-1)
  out[k]=children[last]
 return out
def export(base,out,sections,highlight=False,fields=None):
 if os.path.abspath(base)==os.path.abspath(out):raise SystemExit('out must differ from base')
 before=sha256(base)
 d=open_docx(base);seen=[];m=Markers();replaced={}
 filled=fill_fields(d,{k:clean(v) for k,v in (fields or {}).items() if clean(v)})
 anchors=fieldless_anchors(d);added=[]
 for ch in list(d.element.body.iterchildren()):
  if not (ch.tag.endswith('}p') or ch.tag.endswith('}tbl')) or ch.getparent() is None:continue
  k=m.key(element_text(ch,d))
  if k in sections and clean(sections[k]) and k not in seen:
   current=existing_narrative(ch,d);seen.append(k)
   # same text as the document (e.g. demand copied from the file): keep the original paragraphs and formatting
   if clean(' '.join(Paragraph(o,d).text for o in current))==clean(sections[k]):continue
   for old in current:
    if clean(Paragraph(old,d).text):replaced[k]=replaced.get(k,0)+1
    old.getparent().remove(old)
   insert_after(ch,sections[k],highlight)
 # sections written by hand for a title without field: add the field label and the text after the section's content
 for k,anchor in anchors.items():
  if k in sections and clean(sections[k]) and k not in seen:
   label=new_paragraph(FIELD_LABEL,bold=True);anchor.addnext(label)
   insert_after(label,sections[k],highlight);seen.append(k);added.append(k)
 d.save(out)
 after=sha256(base)
 if before!=after:raise SystemExit('base document changed during export')
 return {'inserted':seen,'missing':[k for k in sections if k not in seen],'fields_filled':filled,'replaced':replaced,'fields_added':added,'base_sha256':before,'out_sha256':sha256(out)}
def main():
 op=sys.argv[1]
 sys.stdout.reconfigure(encoding='utf-8')
 if op=='inspect': print(json.dumps(inspect(sys.argv[2]),ensure_ascii=False))
 elif op=='export':
  spec=json.loads(sys.stdin.buffer.read().decode('utf-8')); print(json.dumps(export(spec['base'],spec['out'],spec['sections'],spec.get('highlight',False),spec.get('fields')),ensure_ascii=False))
 else: raise SystemExit('unknown operation')
if __name__=='__main__':main()
