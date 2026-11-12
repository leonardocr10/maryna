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
import base64,io,copy
from docx.shared import Pt,RGBColor
from docx.enum.text import WD_BREAK

SLOTS=['inteligencia','percepcao','memoria','atencao','funcoes_executivas','comportamento','personalidade','comportamento_diva']
# Fixed (non-interpretation) destinations, matched by label prefix after normalisation.
FIXED=[
 ('demanda',('DESCRIÇÃO DA DEMANDA',)),
 ('anamnesis',('ANAMNESE',)),
 ('conclusao',('CONCLUSÃO',)),
 ('hipotese',('HIPÓTESE DIAGNÓSTICA','HIPÓTESES DIAGNÓSTICAS')),
 ('recomendacoes',('INDICAÇÕES E RECOMENDAÇÕES','SUGESTÕES E ENCAMINHAMENTOS')),
]
def clean(v):return re.sub(r'\s+',' ',v or '').strip()
# ---- Reading what Word shows ----
# python-docx's Paragraph.text only reads runs that are direct children of the paragraph (and hyperlinks). Text typed
# with "Track changes" on (w:ins), inside content controls (w:sdt), smart tags, simple fields (w:fldSimple) or custom
# XML is missed, and whole blocks inside a block content control are skipped. These helpers read the text as Word
# shows it (deleted text excluded) and walk the body through those wrappers. Writing still goes through python-docx.
_W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
_MC='{http://schemas.openxmlformats.org/markup-compatibility/2006}'
_SKIP={_W+'del',_W+'moveFrom',_W+'delText',_W+'instrText',_W+'delInstrText',_W+'txbxContent',_W+'pPr',_W+'rPr',_W+'sdtPr',_W+'sdtEndPr',_MC+'Fallback',_W+'footnoteReference',_W+'endnoteReference',_W+'commentReference'}
def ptext(p_el):
 """Visible text of a w:p element: tracked insertions, content controls, smart tags and field results included;
 deleted text, field codes and text boxes (their own paragraphs) left out. Tabs and line breaks as in Paragraph.text."""
 out=[]
 def walk(el):
  for c in el:
   tag=c.tag
   if not isinstance(tag,str) or tag in _SKIP:continue
   if tag==_W+'p':continue                      # nested paragraph (text box): not part of this line
   if tag==_W+'t':out.append(c.text or '')
   elif tag==_W+'tab' or tag==_W+'ptab':out.append('\t')
   elif tag in (_W+'br',_W+'cr'):out.append('\n')
   elif tag==_W+'noBreakHyphen':out.append('-')
   elif tag==_W+'softHyphen':pass
   else:walk(c)
 walk(p_el)
 return ''.join(out)
def body_elements(container):
 """Paragraphs and tables of a body (or table cell) in reading order, entering block content controls and custom
 XML wrappers, as Word displays them."""
 for ch in container.iterchildren():
  tag=ch.tag
  if not isinstance(tag,str):continue
  if tag==_W+'p' or tag==_W+'tbl':yield ch
  elif tag in (_W+'sdt',_W+'customXml'):
   inner=ch.find(_W+'sdtContent') if tag==_W+'sdt' else ch
   if inner is not None:yield from body_elements(inner)
def body_children(doc):return list(body_elements(doc.element.body))
def cell_text(cell):
 """Text of a table cell: its paragraphs (also inside content controls), one per line, as cell.text does."""
 return '\n'.join(ptext(e) for e in body_elements(cell._tc) if e.tag==_W+'p')
def element_text(ch,doc):
 if ch.tag.endswith('}p'):return clean(ptext(ch))
 if ch.tag.endswith('}tbl'):return clean(' '.join(cell_text(c) for r in Table(ch,doc).rows for c in r.cells))
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
  text=clean(ptext(sib))
  if text and is_boundary(ptext(sib)):break
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
  texts=[cell_text(c) for c in row.cells]
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
    raw=cell_text(c);cells[tc]={'text':clean(raw),'raw':raw,'rowspan':1,'colspan':1};new.add(tc);line.append(cells[tc])
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
 for ch in body_elements(doc.element.body):
  if ch.tag.endswith('}p'):
   yield {'type':'p','text':clean(ptext(ch))}
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
# Closing line with the place and date of the report ("Uberlândia, 30 de outubro de 2026."): the only fixed text the
# psychologist may change, as one whole line. The last match in the document is used (it sits above the signature).
PLACE_DATE_RE=re.compile(r'^[A-ZÀ-Ý][^,\d]{1,60},\s*\d{1,2}\s+de\s+[A-Za-zçÇ]+\s+de\s+\d{4}\.?$')
def place_date_paragraph(doc):
 found=None
 for ch in body_elements(doc.element.body):
  if ch.tag.endswith('}p'):
   p=Paragraph(ch,doc)
   if PLACE_DATE_RE.match(clean(ptext(ch))):found=p
 return found
# Fixed parts the intern fills under a one-cell heading box ("FONTES FUNDAMENTAIS DE INFORMAÇÕES", "INSTRUMENTOS/
# AVALIAÇÕES APLICADAS"...). The psychologist may rewrite them: key "fixo_<heading>", text = paragraphs under the box.
import unicodedata
def fixed_slug(label):
 t=unicodedata.normalize('NFD',label).encode('ascii','ignore').decode().lower()
 return 'fixo_'+re.sub(r'[^a-z0-9]+','_',t).strip('_')[:60]
def fixed_heading(ch,doc):
 """Label of a one-cell all-caps heading box that is not a section the system writes, else None."""
 if not ch.tag.endswith('}tbl'):return None
 cells=list(dict.fromkeys(clean(cell_text(c)) for r in Table(ch,doc).rows for c in r.cells if clean(cell_text(c))))
 if len(cells)!=1:return None
 t=re.sub(r'\s*:\s*$','',cells[0])
 if len(t)<4 or len(t)>80 or t.upper().startswith('INTERPRETA') or domain_of(t.upper()) or not re.search(r'[A-Za-zÀ-ÿ]{3}',t):return None
 return t
def visible_runs(p):
 """Runs Word shows in a paragraph, wherever they sit (insertions, content controls, smart tags, hyperlinks)."""
 from docx.text.run import Run
 bad=('del','moveFrom','txbxContent','Fallback')
 return [Run(r,p) for r in p._p.iter(_W+'r') if not any(isinstance(a.tag,str) and a.tag.rsplit('}',1)[-1] in bad for a in r.iterancestors()) and next((a for a in r.iterancestors(_W+'p')),None) is p._p]
def paragraph_html(p):
 """One body paragraph as editor HTML: bold/italic/underline runs; Word list paragraphs become list items."""
 esc=lambda s:s.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')
 parts=[]
 for r in visible_runs(p):
  t=esc(r.text)
  if not t:continue
  if r.underline:t='<u>'+t+'</u>'
  if r.italic:t='<i>'+t+'</i>'
  if r.bold:t='<b>'+t+'</b>'
  parts.append(t)
 body=''.join(parts).strip() or esc(ptext(p._p).strip())
 ppr=p._p.pPr
 is_list=ppr is not None and ppr.numPr is not None
 return ('li' if is_list else 'p'),body
def block_html(paragraphs):
 """Paragraphs (with text) as editor HTML, consecutive list items grouped in one <ul>."""
 out=[];open_list=False
 for p in paragraphs:
  if not clean(ptext(p._p)):continue
  kind,body=paragraph_html(p)
  if kind=='li' and not open_list:out.append('<ul>');open_list=True
  if kind!='li' and open_list:out.append('</ul>');open_list=False
  out.append('<'+kind+'>'+body+'</'+kind+'>')
 if open_list:out.append('</ul>')
 return ''.join(out)
def fixed_blocks(doc):
 """[(key,label,heading element)] after the first section marker, in document order."""
 out=[];m=Markers();started=False;keys=set()
 for ch in body_elements(doc.element.body):
  if m.key(element_text(ch,doc)):started=True;continue
  if not started:continue
  label=fixed_heading(ch,doc)
  if label and fixed_slug(label) not in keys:keys.add(fixed_slug(label));out.append((fixed_slug(label),label,ch))
 return out
def section_titles(elements,markers):
 """Heading of each section as written in the document (\"COMPORTAMENTO SOCIAL:\", \"SUGESTÕES E ENCAMINHAMENTOS:\")."""
 text=lambda e:e.get('text','') if e['type']=='p' else ' '.join(dict.fromkeys(x.strip() for row in e['rows'] for x in row if x.strip()))
 out={}
 for m in markers:
  if m.get('section_start') is not None and m['section_start']>0:
   t=text(elements[m['section_start']-1])
   # a second field in the same section (DIVA after the behaviour field) starts after the first field: it takes the
   # section's own heading from the document, the last title above it
   if clean(t).upper().startswith('INTERPRETA'):
    t=next((text(elements[j]) for j in range(m['section_start']-2,-1,-1) if domain_of(text(elements[j]))),'')
  else:t=m['label']
  t=re.sub(r'\s*:\s*$','',clean(t))
  if t and len(t)<=80 and not t.upper().startswith('INTERPRETA'):out[m['key']]=t
 return out
def inspect(path):
 d=open_docx(path);elements=list(all_elements(d));markers=[];m=Markers()
 children=body_children(d)
 position={ch:i for i,ch in enumerate(children)}
 for i,e in enumerate(elements):
  txt=e['text'] if e['type']=='p' else ' '.join(x for row in e['rows'] for x in row)
  k=m.key(txt)
  if k:
   old=existing_narrative(children[i],d)
   # old text is flagged so it is never sent to the AI as if it were evidence
   for ch in old:elements[position[ch]]['replaceable']=k
   markers.append({'key':k,'index':i,'label':txt,'existing_paragraphs':sum(1 for ch in old if clean(ptext(ch))),'existing_text':'\n\n'.join(t for t in (ptext(ch).strip() for ch in old) if t)})
 section_ranges(elements,markers)
 titled=sorted({domain_of(e['text'] if e['type']=='p' else ' '.join(x for row in e['rows'] for x in row)) for e in elements}-{None})
 return {'elements':elements,'markers':markers,'titled_domains':titled,'title_ranges':title_ranges(elements,markers),'identification':identification(d),'place_date':(lambda p:clean(ptext(p._p)) if p is not None else None)(place_date_paragraph(d)),'fixed_blocks':[(lambda html:{'key':k,'label':label,'index':position[ch],'existing_html':html,'existing_text':plain_from_html(html)})(block_html([Paragraph(o,d) for o in existing_narrative(ch,d)])) for k,label,ch in fixed_blocks(d)],'titles':section_titles(elements,markers),'warnings':['Conferir visualmente a ordem dos marcadores e os resultados.']}

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
# Inserted text follows the reports finished by hand in Word: Arial 11, justified, line spacing 1.15, no space before
# or after; one blank line between the heading (title box or "Interpretação..." label) and the text, between topics
# and after the text. A topic title is bold at the start of its first paragraph ("1. Sono: texto..."), numbered when
# the section has two or more topics. Headings are kept with the text that follows (keepNext).
LINE_115='276';AFTER_PARA='120';BEFORE_TITLE='240'
def keep_next(p):
 """Word keeps this paragraph on the same page as the next one (a title is never left alone at the page end)."""
 ppr=p.find(qn('w:pPr'))
 if ppr is None:ppr=OxmlElement('w:pPr');p.insert(0,ppr)
 if ppr.find(qn('w:keepNext')) is None:
  k=OxmlElement('w:keepNext')
  # schema order: pStyle first, keepNext right after it
  st=ppr.find(qn('w:pStyle'))
  if st is not None:st.addnext(k)
  else:ppr.insert(0,k)
def new_paragraph(text,bold=False,red=False,title_gap=False,after='0'):
 """Body paragraph matching the report layout: Arial 11 pt, justified, 1.15 line spacing, no space after (the
 devolutiva passes 6 pt). A bold one is a title: kept with the next paragraph."""
 p=OxmlElement('w:p');ppr=OxmlElement('w:pPr')
 if bold:ppr.append(OxmlElement('w:keepNext'))
 sp=OxmlElement('w:spacing')
 if title_gap:sp.set(qn('w:before'),BEFORE_TITLE)
 sp.set(qn('w:after'),after);sp.set(qn('w:line'),LINE_115);sp.set(qn('w:lineRule'),'auto');ppr.append(sp)
 ind=OxmlElement('w:ind');ind.set(qn('w:left'),'0');ind.set(qn('w:firstLine'),'0');ppr.append(ind)
 jc=OxmlElement('w:jc');jc.set(qn('w:val'),'both');ppr.append(jc)
 ppr.append(run_props(bold))  # paragraph mark too, so blank lines between topics are also Arial 11
 p.append(ppr)
 if text:
  r=OxmlElement('w:r');r.append(run_props(bold,red))
  t=OxmlElement('w:t');t.set(qn('xml:space'),'preserve');t.text=text;r.append(t);p.append(r)
 return p
def blocks(content):
 """Split section text into (text,bold) paragraphs. Topics are separated by the title's spacing, not by blank paragraphs."""
 out=[]
 for chunk in re.split(r'\n\s*\n',content.replace('\r','').strip()):
  for line in [l.strip() for l in chunk.split('\n') if l.strip()]:
   # ChatGPT often marks topic titles as a whole bold line instead of "## ".
   whole_bold=re.fullmatch(r'\*\*([^*]{1,80})\*\*:?',line)
   if whole_bold:line='## '+whole_bold.group(1)
   line=re.sub(r'\*\*(.+?)\*\*',r'\1',line)
   if line.startswith('#'):
    line=line.lstrip('#').strip()
    # "## Título: texto..." on one line: bold title, then the text as a normal paragraph
    inline=re.fullmatch(r'([^:.]{2,80}):\s+(.+)',line) if len(line)>80 else None
    if inline:out.append((inline.group(1).strip(),True));out.append((inline.group(2).strip(),False))
    else:out.append((line,True))
   else:out.append((line,False))
 return out
def insert_after(anchor,content,red=False):
 bl=[{'kind':'h3' if bold else 'p','list':None,'n':0,'style':{},'runs':[(text,{})],'text':clean(text)} for text,bold in blocks(content) if text.strip()]
 return insert_blocks(anchor,bl,red)
def _blank(p):return p is not None and p.tag==_W+'p' and not clean(ptext(p)) and not has_protected_content(p)
def topic_layout(bl):
 """Blocks grouped by topic. Each group: its title merged in bold at the start of its first paragraph
 ("2. Histórico escolar: texto..."), numbered when there are two or more topics."""
 groups=[]
 for b in bl:
  if b['kind']=='h3':groups.append({'title':b,'items':[]})
  else:
   if not groups:groups.append({'title':None,'items':[]})
   groups[-1]['items'].append(b)
 numbered=sum(1 for g in groups if g['title'])>=2;n=0;out=[]
 for g in groups:
  items=list(g['items']);t=g['title']
  if t:
   n+=1
   # the title keeps its own formatting (font, color...), always bold; number in front, colon after
   runs=[(x,{**f,'b':True}) for x,f in t['runs'] if x]
   if runs:
    runs[0]=((str(n)+'. ' if numbered else '')+re.sub(r'^\s*\d+\s*[.)-]\s*','',runs[0][0]).lstrip(),runs[0][1])
    runs[-1]=(runs[-1][0].rstrip().rstrip(':').rstrip(),runs[-1][1])
   if items and items[0]['kind']=='p':items[0]={**items[0],'runs':runs[:-1]+[(runs[-1][0]+': ',runs[-1][1])]+list(items[0]['runs'])}
   else:items.insert(0,{**t,'runs':runs})
  out.append(items)
 return out
def insert_blocks(anchor,bl,red=False):
 """Blank line, the topics separated by blank lines, blank line. A blank line already under the heading is reused."""
 made=[];last=anchor
 if not bl:return made
 nxt=anchor.getnext()
 if _blank(nxt):last=nxt
 else:last=new_paragraph('');anchor.addnext(last)
 for i,group in enumerate(topic_layout(bl)):
  if i:gap=new_paragraph('');last.addnext(gap);last=gap
  for b in group:
   p=rich_paragraph(b,red);last.addnext(p);last=p;made.append(p)
 nxt=last.getnext()
 if nxt is not None and nxt.tag!=_W+'sectPr' and not _blank(nxt):last.addnext(new_paragraph(''))
 return made

# ---------- formatted text from the app's editor (sanitized HTML subset, see web/src/app/rich-text.ts) ----------
from html.parser import HTMLParser
def _pt(v):
 m=re.fullmatch(r'\s*([\d.]+)\s*(pt|px|em)?\s*',v or '')
 if not m:return None
 try:n=float(m.group(1))
 except ValueError:return None
 u=m.group(2) or 'px'
 return n if u=='pt' else n*0.75 if u=='px' else n*11
# The app's own text colors (web/src/tokens.css --text, light and dark): the browser copies them into spans by itself.
SCREEN_TEXT_COLORS={'1C2B29','E6EEEC'}
def _font_pt(v,around=11):
 """Font size chosen in the editor: pt, or em of the size around it (report default 11 pt). Sizes in px are written by
 the browser itself while editing (its own screen size), never chosen, so they are ignored (same as web/src/app/rich-text.ts)."""
 m=re.fullmatch(r'\s*([\d.]+)\s*(pt|em)\s*',v or '')
 if not m:return None
 try:n=float(m.group(1))
 except ValueError:return None
 pt=n if m.group(2)=='pt' else n*around
 return round(pt,2) if 4<=pt<=96 else None
def _hex(v):
 v=(v or '').strip().lower()
 m=re.fullmatch(r'#([0-9a-f]{6})',v) or re.fullmatch(r'#([0-9a-f]{3})',v)
 if m:h=m.group(1);return (h if len(h)==6 else ''.join(c*2 for c in h)).upper()
 m=re.fullmatch(r'rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)',v)
 if m and (m.group(4) is None or float(m.group(4))>0):return ''.join('%02X'%min(255,int(m.group(i))) for i in (1,2,3))
 return None
def _style(v):
 out={}
 for part in (v or '').split(';'):
  if ':' in part:k,val=part.split(':',1);out[k.strip().lower()]=val.strip()
 return out
class _Rich(HTMLParser):
 """Collects blocks: {'kind':'p'|'h3'|'li','list':'ul'|'ol'|None,'n':int,'style':{},'runs':[(text,fmt)]}."""
 BLOCK={'p','h3','li','div','h1','h2','h4','h5','h6'}
 def __init__(s):
  super().__init__(convert_charrefs=True);s.blocks=[];s.cur=None;s.fmt=[{}];s.lists=[]
 def _open(s,tag,style):
  kind='h3' if tag[0]=='h' else 'li' if tag=='li' else 'p'
  lst=s.lists[-1] if s.lists else None;n=0
  if kind=='li' and lst:lst[1]+=1;n=lst[1]
  s.cur={'kind':kind,'list':lst[0] if (kind=='li' and lst) else None,'n':n,'style':style,'runs':[]};s.blocks.append(s.cur)
 def handle_starttag(s,tag,attrs):
  st=_style(dict(attrs).get('style'))
  if tag in ('ul','ol'):s.lists.append([tag,0]);s.cur=None;return
  if tag in s.BLOCK:s._open(tag,st);s.fmt.append(dict(s.fmt[-1]));return
  if tag=='br':
   if s.cur is not None:s.cur['runs'].append(('\n',dict(s.fmt[-1])))
   return
  f=dict(s.fmt[-1])
  if tag in ('b','strong'):f['b']=True
  elif tag in ('i','em'):f['i']=True
  elif tag=='u':f['u']=True
  elif tag in ('s','strike'):f['s']=True
  elif tag=='sub':f['va']='subscript'
  elif tag=='sup':f['va']='superscript'
  sz=_font_pt(st.get('font-size'),f.get('sz') or 11)
  if sz:f['sz']=sz
  if _hex(st.get('color')) and _hex(st['color']) not in SCREEN_TEXT_COLORS:f['color']=_hex(st['color'])
  if _hex(st.get('background-color')):f['bg']=_hex(st['background-color'])
  fam=(st.get('font-family') or '').split(',')[0].strip().strip(chr(34)+chr(39))
  if fam in EDITOR_FONTS:f['font']=fam
  if st.get('font-weight') in ('bold','600','700','800','900'):f['b']=True
  if st.get('font-style')=='italic':f['i']=True
  td=st.get('text-decoration','')+' '+st.get('text-decoration-line','')
  if 'underline' in td:f['u']=True
  if 'line-through' in td:f['s']=True
  s.fmt.append(f)
 def handle_endtag(s,tag):
  if tag in ('ul','ol'):
   if s.lists:s.lists.pop()
   s.cur=None;return
  if tag=='br':return
  if len(s.fmt)>1:s.fmt.pop()
  if tag in s.BLOCK:s.cur=None
 def handle_data(s,d):
  if not d:return
  if s.cur is None:
   if not d.strip():return
   s._open('p',{})
  s.cur['runs'].append((d,dict(s.fmt[-1])))
def rich_blocks(html):
 r=_Rich();r.feed(html or '');r.close()
 out=[]
 for b in r.blocks:
  b['text']=clean(''.join(t for t,_ in b['runs']))
  if b['text']:out.append(b)
 return out
def plain_from_html(html):
 """Same rules as textFromHtml in web/src/app/rich-text.ts."""
 lines=[]
 for b in rich_blocks(html):
  if b['kind']=='h3':lines.append('## '+b['text'])
  elif b['kind']=='li':lines.append((str(b['n'])+'. ' if b['list']=='ol' else '- ')+b['text'])
  else:lines.append(b['text'])
 return '\n\n'.join(lines)
def rich_matches(html,content):
 """The formatting is used only while it still describes the saved text (a new AI draft or a restore drops it)."""
 return bool(html) and clean(plain_from_html(html))==clean(content)
# Fonts the editor offers (web/src/app/rich-text.ts EDITOR_FONTS); any other name is ignored.
EDITOR_FONTS={'Arial','Calibri','Cambria','Georgia','Segoe UI','Tahoma','Times New Roman','Verdana'}
def _twips(pt):return str(int(round(pt*20)))
def _rich_props(f,title=False,red=False):
 rpr=run_props(bool(f.get('b')) or title,red and not f.get('color'))
 sz=rpr.find(qn('w:sz'))
 def before_sz(tag,val=None):
  e=OxmlElement(tag)
  if val is not None:e.set(qn('w:val'),val)
  sz.addprevious(e)
 if f.get('font'):
  rf=rpr.find(qn('w:rFonts'))
  for a in ('ascii','hAnsi','cs','eastAsia'):rf.set(qn('w:'+a),f['font'])
 if f.get('i'):before_sz('w:i');before_sz('w:iCs')
 if f.get('s'):before_sz('w:strike')
 if f.get('color'):before_sz('w:color',f['color'])
 if f.get('sz'):
  for tag in ('w:sz','w:szCs'):rpr.find(qn(tag)).set(qn('w:val'),str(int(round(f['sz']*2))))
 if f.get('u'):u=OxmlElement('w:u');u.set(qn('w:val'),'single');rpr.append(u)
 if f.get('bg'):sh=OxmlElement('w:shd');sh.set(qn('w:val'),'clear');sh.set(qn('w:color'),'auto');sh.set(qn('w:fill'),f['bg']);rpr.append(sh)
 if f.get('va'):v=OxmlElement('w:vertAlign');v.set(qn('w:val'),f['va']);rpr.append(v)
 return rpr
def rich_paragraph(b,red=False,title_gap=False):
 """Body paragraph with the report defaults (Arial 11, justified, 1.15, no space after) overridden by the editor's formatting."""
 st=b['style'];title=b['kind']=='h3'
 p=new_paragraph('',bold=title,title_gap=title_gap);ppr=p.find(qn('w:pPr'));sp=ppr.find(qn('w:spacing'))
 lh=st.get('line-height','')
 if re.fullmatch(r'[\d.]+',lh):
  try:sp.set(qn('w:line'),str(int(round(float(lh)*240))));sp.set(qn('w:lineRule'),'auto')
  except ValueError:pass
 elif _pt(lh):sp.set(qn('w:line'),_twips(_pt(lh)));sp.set(qn('w:lineRule'),'atLeast')
 if _pt(st.get('margin-top')) is not None:sp.set(qn('w:before'),_twips(_pt(st['margin-top'])))
 if _pt(st.get('margin-bottom')) is not None:sp.set(qn('w:after'),_twips(_pt(st['margin-bottom'])))
 ind=ppr.find(qn('w:ind'));left=_pt(st.get('margin-left')) or 0
 if b['kind']=='li':left+=18;ind.set(qn('w:hanging'),_twips(18));ind.attrib.pop(qn('w:firstLine'),None)
 ind.set(qn('w:left'),_twips(left))
 al={'left':'left','start':'left','center':'center','right':'right','end':'right','justify':'both'}.get(st.get('text-align',''))
 if al:ppr.find(qn('w:jc')).set(qn('w:val'),al)
 runs=list(b['runs'])
 if b['kind']=='li':runs.insert(0,((str(b['n'])+'.' if b['list']=='ol' else '•')+'\t',runs[0][1] if runs else {}))
 start=True
 for text,f in runs:
  r=OxmlElement('w:r');r.append(_rich_props(f,title,red))
  if text=='\n':r.append(OxmlElement('w:br'));p.append(r);start=True;continue
  head,tab,tail=text.partition('\t')
  parts=[re.sub(r'\s+',' ',head)]+(['\t',tail] if tab else [])
  for part in parts:
   if part=='\t':r.append(OxmlElement('w:tab'));start=False;continue
   if start:part=part.lstrip()
   if not part:continue
   t=OxmlElement('w:t');t.set(qn('xml:space'),'preserve');t.text=part;r.append(t);start=False
  if len(r)>1:p.append(r)
 return p
def insert_rich_after(anchor,html,red=False):return insert_blocks(anchor,rich_blocks(html),red)
# Preview only ("Word" tab of the app): every inserted paragraph carries a bookmark nlsec_<key>_<n>, so the screen knows
# which section it belongs to and makes only those paragraphs editable. Never in the downloaded file.
_BM=[1000]
def tag_section(k,paragraphs):
 for n,p in enumerate(paragraphs):
  _BM[0]+=1;i=str(_BM[0])
  st=OxmlElement('w:bookmarkStart');st.set(qn('w:id'),i);st.set(qn('w:name'),('nlsec_'+re.sub(r'[^A-Za-z0-9_]','_',k)+'_'+str(n))[:40])
  en=OxmlElement('w:bookmarkEnd');en.set(qn('w:id'),i)
  ppr=p.find(qn('w:pPr'))
  if ppr is not None:ppr.addnext(st)
  else:p.insert(0,st)
  p.append(en)
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
 for ch in body_elements(doc.element.body):
  if not ch.tag.endswith('}p'):
   if ch.tag.endswith('}tbl') and m.key(element_text(ch,doc)):break
   continue
  text=ptext(ch)
  for label,(a,b) in field_spans(text).items():out.setdefault(label,text[a:b].strip())
 return out
def replace_span(p,start,end,new):
 """Replace characters [start,end) of a paragraph, keeping the formatting of the run where the value starts."""
 runs=list(p.runs)
 if ''.join(r.text for r in runs)!=ptext(p._p):return False  # tracked changes/controls/fields inside: leave untouched
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
 for ch in body_children(doc):
  if ch.tag.endswith('}tbl'):
   if m.key(element_text(ch,doc)):break
   continue
  p=Paragraph(ch,doc);text=ptext(ch)
  # right-to-left so earlier offsets stay valid
  for label,(a,b) in sorted(field_spans(text).items(),key=lambda x:-x[1][0]):
   value=fields.get(label)
   if value is None or label in filled:continue
   if ptext(ch)[a:b]==value or replace_span(p,a,b,value):filled.append(label)
 return filled
FIELD_LABEL='Interpretação Clínica:'
def fieldless_anchors(d):
 """{key: last element of the section} for sections whose title exists but that have no interpretation field.
 The export adds the field label and the text right after it, i.e. after the section's tables and captions."""
 elements=list(all_elements(d));m=Markers();markers=[]
 children=body_children(d)
 for i,e in enumerate(elements):
  k=m.key(e['text'] if e['type']=='p' else ' '.join(x for row in e['rows'] for x in row))
  if k:markers.append({'key':k,'index':i})
 out={}
 for k,(start,end) in title_ranges(elements,markers).items():
  # skip trailing blank paragraphs so the new field sits right under the last table or caption
  last=max([i for i in range(start-1,end) if elements[i]['type']=='table' or elements[i].get('text')],default=start-1)
  out[k]=children[last]
 return out
def created_anchors(d,keys,order):
 """Sections missing from the base document that the psychologist chose to create: {key: element they go before}.
 That is the title of the next section of the report found in the file; None when there is none (they then go
 before the closing place/date line, or at the end)."""
 elements=list(all_elements(d));m=Markers();starts={}
 children=body_children(d)
 fixed={k for k,_ in FIXED}
 for i,e in enumerate(elements):
  t=e['text'] if e['type']=='p' else ' '.join(x for row in e['rows'] for x in row)
  k=m.key(t)
  if k in fixed:starts.setdefault(k,i)
  dom=domain_of(t)
  if dom:starts.setdefault(dom,i)
 out={}
 for k in keys:
  if k not in order or k in starts:continue
  nxt=next((n for n in order[order.index(k)+1:] if n in starts),None)
  out[k]=children[starts[nxt]] if nxt is not None else None
 return out
END_RE=re.compile(r'^(REFER[ÊE]NCIAS|LAUDO REALIZADO|_{3,})')
def excluded_elements(d,keys):
 """Sections the psychologist chose to leave out of the report (approved exception to rule 2, always her choice):
 {key: [elements]} from the section's title up to the next section title, fixed heading box, references,
 signature or closing place/date line. A section with no title of its own in the file (e.g. the DIVA field)
 cannot be found and is not removed."""
 if not keys:return {}
 elements=list(all_elements(d));m=Markers();starts={}
 children=body_children(d)
 fixed={k for k,_ in FIXED};stops=set()
 for i,e in enumerate(elements):
  t=e['text'] if e['type']=='p' else ' '.join(x for row in e['rows'] for x in row)
  k=m.key(t)
  if k in fixed:starts.setdefault(k,i);stops.add(i)
  dom=domain_of(t)
  if dom:starts.setdefault(dom,i);stops.add(i)
  if fixed_heading(children[i],d) or END_RE.match(clean(t).upper()):stops.add(i)
 closing=place_date_paragraph(d)
 if closing is not None:
  stops.update(i for i,ch in enumerate(children) if ch is closing._p)
 out={}
 for k in keys:
  if k not in starts:continue
  s=starts[k];e=min([x for x in stops if x>s],default=len(children))
  out[k]=children[s:e]
 return out
def is_heading(ch,doc):
 """Section heading of the report: a one-cell title box, a section title ("MEMÓRIA E APRENDIZAGEM:"), an
 interpretation label ("Interpretação e observações clínicas:") or another short all-caps title."""
 if ch.tag==_W+'tbl':
  try:t=Table(ch,doc);cells=list(dict.fromkeys(clean(cell_text(c)) for r in t.rows for c in r.cells if clean(cell_text(c))))
  except Exception:return False
  return len(t.rows)==1 and len(cells)==1 and 2<len(cells[0])<=80
 if ch.tag!=_W+'p' or has_protected_content(ch):return False
 text=clean(ptext(ch))
 if not text or len(text)>80:return False
 label=text.upper()
 if is_interpretation(label):return True
 caps=text==label and re.search(r'[A-ZÀ-Ý]{3}',text) is not None
 return caps or (text.endswith(':') and domain_of(text) is not None)
def keep_titles(doc):
 """Pagination only (no text, value or style changes): every heading, and the blank lines right under it, stays on the
 page of the first text, table or chart that follows, so a title is never left alone at the bottom of a page."""
 els=list(body_elements(doc.element.body))
 for i,ch in enumerate(els):
  if not is_heading(ch,doc):continue
  chain=[ch];j=i+1
  while j<len(els) and els[j].tag==_W+'p' and not clean(ptext(els[j])) and not has_protected_content(els[j]):chain.append(els[j]);j+=1
  if j>=len(els):continue
  for el in chain:
   if el.tag==_W+'tbl':
    for p in el.iter(_W+'p'):keep_next(p)
   else:keep_next(el)
def export(base,out,sections,highlight=False,fields=None,rich=None,created=None,excluded=None,tags=False):
 excluded=[k for k in (excluded or [])]
 sections={k:v for k,v in sections.items() if k not in excluded}
 rich={k:v for k,v in (rich or {}).items() if k in sections and rich_matches(v,sections[k])}
 if os.path.abspath(base)==os.path.abspath(out):raise SystemExit('out must differ from base')
 before=sha256(base)
 d=open_docx(base);seen=[];m=Markers();replaced={}
 filled=fill_fields(d,{k:clean(v) for k,v in (fields or {}).items() if clean(v)})
 place=clean((fields or {}).get('__local_data'))
 if place:
  p=place_date_paragraph(d)
  if p is not None and (clean(ptext(p._p))==place or replace_span(p,0,len(ptext(p._p)),place)):filled.append('__local_data')
 anchors=fieldless_anchors(d);added=[]
 # computed before any change, while the element order is still the file's
 created=created or {};made=created_anchors(d,[k for k in created.get('keys',[]) if k in sections and clean(sections[k])],created.get('order',[]))
 gone=excluded_elements(d,excluded)
 closing=place_date_paragraph(d)
 # fixed parts rewritten by the psychologist: same replacement as a section, under their heading box
 for k,label,ch in fixed_blocks(d):
  if k in sections and clean(sections[k]) and k not in seen:
   current=existing_narrative(ch,d);seen.append(k)
   if clean(' '.join(ptext(o) for o in current))==clean(sections[k]):continue
   for old in current:
    if clean(ptext(old)):replaced[k]=replaced.get(k,0)+1
    old.getparent().remove(old)
   made_p=insert_rich_after(ch,rich[k],highlight) if k in rich else insert_after(ch,sections[k],highlight)
   if tags:tag_section(k,made_p)
 for ch in body_children(d):
  if ch.getparent() is None:continue
  k=m.key(element_text(ch,d))
  if k in sections and clean(sections[k]) and k not in seen:
   current=existing_narrative(ch,d);seen.append(k)
   # same text as the document (e.g. demand copied from the file): keep the original paragraphs and formatting
   if clean(' '.join(ptext(o) for o in current))==clean(sections[k]):continue
   for old in current:
    if clean(ptext(old)):replaced[k]=replaced.get(k,0)+1
    old.getparent().remove(old)
   made_p=insert_rich_after(ch,rich[k],highlight) if k in rich else insert_after(ch,sections[k],highlight)
   if tags:tag_section(k,made_p)
 # sections written by hand for a title without field: add the field label and the text after the section's content
 for k,anchor in anchors.items():
  if k in sections and clean(sections[k]) and k not in seen:
   label=new_paragraph(FIELD_LABEL,bold=True);anchor.addnext(label)
   made_p=insert_rich_after(label,rich[k],highlight) if k in rich else insert_after(label,sections[k],highlight)
   if tags:tag_section(k,made_p)
   seen.append(k);added.append(k)
 # sections the file does not have, created by the psychologist's choice: title (+ field label for an interpretation),
 # the text, and a blank line, right before the next section of the report
 made_keys=[]
 for k,where in made.items():
  if k in seen:continue
  if where is None:where=closing._p if closing is not None else d.element.body.sectPr
  gap=new_paragraph('')
  if where is None:d.element.body.append(gap)
  else:where.addprevious(gap)
  title=new_paragraph(clean(created.get('titles',{}).get(k) or k).upper(),bold=True,red=highlight);gap.addprevious(title)
  last=title
  if k in SLOTS:label=new_paragraph(FIELD_LABEL,bold=True,red=highlight);title.addnext(label);last=label
  made_p=insert_rich_after(last,rich[k],highlight) if k in rich else insert_after(last,sections[k],highlight)
  if tags:tag_section(k,made_p)
  seen.append(k);made_keys.append(k)
 # sections left out by the psychologist's choice: their title, tables and texts are removed from the copy
 for els in gone.values():
  for el in els:
   if el.getparent() is not None:el.getparent().remove(el)
 keep_titles(d)
 d.save(out)
 after=sha256(base)
 if before!=after:raise SystemExit('base document changed during export')
 return {'excluded':sorted(gone),'inserted':seen,'missing':[k for k in sections if k not in seen],'fields_filled':filled,'replaced':replaced,'fields_added':added,'created':made_keys,'formatted':sorted(rich),'base_sha256':before,'out_sha256':sha256(out)}
def letter(out,title,subtitle,content):
 """Standalone document (the devolutiva): title, patient name and the approved text, same body style as the report."""
 if os.path.exists(out):raise SystemExit('output exists')
 d=Document();sect=d.element.body.sectPr
 head=new_paragraph(title,bold=True);jc=head.find(qn('w:pPr')).find(qn('w:jc'));jc.set(qn('w:val'),'center');sect.addprevious(head)
 if subtitle:
  sub=new_paragraph(subtitle);sub.find(qn('w:pPr')).find(qn('w:jc')).set(qn('w:val'),'center');sect.addprevious(sub)
 sect.addprevious(new_paragraph(''))
 first=True
 for text,bold in blocks(content):
  if not text.strip():continue
  sect.addprevious(new_paragraph(text,bold,title_gap=bold and not first,after=AFTER_PARA));first=False
 d.save(out)
 return {'out':out,'paragraphs':len(blocks(content))}
# Pictures inside body paragraphs (score tables pasted as images, charts saved as pictures), by element index -- the
# same order as all_elements. Only for showing on screen; they are never sent to the AI.
MAX_IMAGE=4*1024*1024
def images(path):
 import base64
 d=open_docx(path);out={};i=0
 for ch in body_children(d):
  if ch.tag.endswith('}p'):
   srcs=[]
   for blip in ch.iter(qn('a:blip')):
    rid=blip.get(qn('r:embed'))
    part=d.part.related_parts.get(rid) if rid else None
    if part is None or not str(part.content_type).startswith('image/') or len(part.blob)>MAX_IMAGE:continue
    if part.content_type not in ('image/png','image/jpeg','image/gif','image/webp'):continue
    srcs.append('data:'+part.content_type+';base64,'+base64.b64encode(part.blob).decode())
   if srcs:out[str(i)]=srcs
  i+=1
 return out

# ---------- "Word" tab of the app: the report edited freely in the browser, rebuilt as .docx ----------
# The screen sends the edited body as blocks (paragraphs with runs, tables, pictures) with the styles it computed. The page
# setup, headers, footers (logo) and styles come from the report generated from the sections (base). Never the uploaded base.
def _rgb(v):
 m=re.fullmatch(r'#?([0-9a-fA-F]{6})',str(v or ''))
 return m.group(1).upper() if m else None
def _blk_paragraph(p,b,d):
 pf=p.paragraph_format
 al={'left':0,'center':1,'right':2,'justify':3}.get(b.get('align'))
 if al is not None:pf.alignment=al
 for k,attr in (('before','space_before'),('after','space_after'),('indent','first_line_indent'),('left','left_indent'),('right','right_indent')):
  v=b.get(k)
  if isinstance(v,(int,float)) and -400<v<400:setattr(pf,attr,Pt(v))
 ln=b.get('line')
 if isinstance(ln,(int,float)) and 0.5<=ln<=4:pf.line_spacing=ln
 for r in b.get('runs') or []:
  if r.get('img'):
   try:
    raw=base64.b64decode(str(r['img']).split(',',1)[-1])
    w=r.get('w');run=p.add_run()
    run.add_picture(io.BytesIO(raw),width=Pt(w) if isinstance(w,(int,float)) and 4<w<1000 else None)
   except Exception:pass
   continue
  text=str(r.get('text') or '')
  if not text:continue
  if r.get('br'):p.add_run().add_break()
  parts=text.split('\t')
  for i,part in enumerate(parts):
   if i:p.add_run().add_tab()
   if not part:continue
   run=p.add_run(part);fo=run.font
   if r.get('b'):fo.bold=True
   if r.get('i'):fo.italic=True
   if r.get('u'):fo.underline=True
   if r.get('s'):fo.strike=True
   if r.get('sup'):fo.superscript=True
   if r.get('sub'):fo.subscript=True
   sz=r.get('size')
   if isinstance(sz,(int,float)) and 4<=sz<=96:fo.size=Pt(sz)
   if r.get('font'):
    fo.name=str(r['font'])[:60];rpr=run._r.get_or_add_rPr();rf=rpr.find(qn('w:rFonts'))
    if rf is not None:
     for a in ('ascii','hAnsi','cs','eastAsia'):rf.set(qn('w:'+a),str(r['font'])[:60])
   c=_rgb(r.get('color'))
   if c and c!='000000':fo.color.rgb=RGBColor.from_string(c)
   bg=_rgb(r.get('bg'))
   if bg and bg!='FFFFFF':
    sh=OxmlElement('w:shd');sh.set(qn('w:val'),'clear');sh.set(qn('w:color'),'auto');sh.set(qn('w:fill'),bg);run._r.get_or_add_rPr().append(sh)
def _blk_table(d,b,where):
 rows=b.get('rows') or []
 if not rows:return
 cols=max(len(r) for r in rows) or 1
 t=d.add_table(rows=len(rows),cols=cols)
 for i,row in enumerate(rows):
  for j,cell in enumerate(row[:cols]):
   c=t.cell(i,j);first=True
   for pb in (cell.get('blocks') if isinstance(cell,dict) else cell) or []:
    if pb.get('t')!='p':continue
    p=c.paragraphs[0] if first else c.add_paragraph();first=False
    _blk_paragraph(p,pb,d)
   bd=cell.get('borders') if isinstance(cell,dict) else None
   if isinstance(bd,dict):
    tcPr=c._tc.get_or_add_tcPr();tb=OxmlElement('w:tcBorders')
    for side in ('top','left','bottom','right'):
     v=bd.get(side) or {};x=OxmlElement('w:'+side)
     w=v.get('w') if isinstance(v.get('w'),(int,float)) else 0
     if w>0:x.set(qn('w:val'),'single');x.set(qn('w:sz'),str(max(2,min(48,int(round(w*8))))));x.set(qn('w:color'),_rgb(v.get('color')) or '000000')
     else:x.set(qn('w:val'),'nil')
     tb.append(x)
    tcPr.append(tb)
   bg=_rgb(cell.get('bg')) if isinstance(cell,dict) else None
   if bg and bg!='FFFFFF':
    tcPr=c._tc.get_or_add_tcPr();sh=OxmlElement('w:shd');sh.set(qn('w:val'),'clear');sh.set(qn('w:color'),'auto');sh.set(qn('w:fill'),bg);tcPr.append(sh)
 return t
def from_blocks(base,out,blocks,count=None):
 if os.path.abspath(base)==os.path.abspath(out):raise SystemExit('out must differ from base')
 d=Document(base);body=d.element.body
 orig=[ch for ch in body if ch.tag!=qn('w:sectPr')]
 keeps=[b for b in blocks if b.get('t')=='keep']
 # the screen numbered the elements of the same document; another count means another document: nothing is copied by index
 if keeps and count!=len(orig):raise SystemExit('KEEP_MISMATCH '+str(count)+' '+str(len(orig)))
 sect=body.find(qn('w:sectPr'))
 for ch in orig:body.remove(ch)
 def put(el):
  if sect is not None:sect.addprevious(el)
  else:body.append(el)
 for b in blocks:
  if b.get('t')=='keep':
   i=b.get('i')
   if isinstance(i,int) and 0<=i<len(orig):put(copy.deepcopy(orig[i]))
  elif b.get('t')=='table':_blk_table(d,b,None)
  elif b.get('t')=='pagebreak':d.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
  elif b.get('t')=='p':_blk_paragraph(d.add_paragraph(),b,d)
 if not len([c for c in body if c.tag!=qn('w:sectPr')]):d.add_paragraph()
 keep_titles(d)
 d.save(out)
 return {'out':out,'blocks':len(blocks)}
def main():
 op=sys.argv[1]
 sys.stdout.reconfigure(encoding='utf-8')
 if op=='inspect': print(json.dumps(inspect(sys.argv[2]),ensure_ascii=False))
 elif op=='export':
  spec=json.loads(sys.stdin.buffer.read().decode('utf-8')); print(json.dumps(export(spec['base'],spec['out'],spec['sections'],spec.get('highlight',False),spec.get('fields'),spec.get('rich'),spec.get('created'),spec.get('excluded'),spec.get('tags',False)),ensure_ascii=False))
 elif op=='blocks':
  spec=json.loads(sys.stdin.buffer.read().decode('utf-8')); print(json.dumps(from_blocks(spec['base'],spec['out'],spec['blocks'],spec.get('count')),ensure_ascii=False))
 elif op=='images': print(json.dumps(images(sys.argv[2])))
 elif op=='letter':
  spec=json.loads(sys.stdin.buffer.read().decode('utf-8')); print(json.dumps(letter(spec['out'],spec.get('title',''),spec.get('subtitle',''),spec['content']),ensure_ascii=False))
 else: raise SystemExit('unknown operation')
if __name__=='__main__':main()
