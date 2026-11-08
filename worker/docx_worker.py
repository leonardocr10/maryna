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
 ('hipotese',('HIPÓTESE DIAGNÓSTICA','HIPÓTESES DIAGNÓSTICAS')),
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
# Closing line with the place and date of the report ("Uberlândia, 30 de outubro de 2026."): the only fixed text the
# psychologist may change, as one whole line. The last match in the document is used (it sits above the signature).
PLACE_DATE_RE=re.compile(r'^[A-ZÀ-Ý][^,\d]{1,60},\s*\d{1,2}\s+de\s+[A-Za-zçÇ]+\s+de\s+\d{4}\.?$')
def place_date_paragraph(doc):
 found=None
 for ch in doc.element.body.iterchildren():
  if ch.tag.endswith('}p'):
   p=Paragraph(ch,doc)
   if PLACE_DATE_RE.match(clean(p.text)):found=p
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
 cells=list(dict.fromkeys(clean(c.text) for r in Table(ch,doc).rows for c in r.cells if clean(c.text)))
 if len(cells)!=1:return None
 t=re.sub(r'\s*:\s*$','',cells[0])
 if len(t)<4 or len(t)>80 or t.upper().startswith('INTERPRETA') or domain_of(t.upper()) or not re.search(r'[A-Za-zÀ-ÿ]{3}',t):return None
 return t
def paragraph_html(p):
 """One body paragraph as editor HTML: bold/italic/underline runs; Word list paragraphs become list items."""
 esc=lambda s:s.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')
 parts=[]
 for r in p.runs:
  t=esc(r.text)
  if not t:continue
  if r.underline:t='<u>'+t+'</u>'
  if r.italic:t='<i>'+t+'</i>'
  if r.bold:t='<b>'+t+'</b>'
  parts.append(t)
 body=''.join(parts).strip() or esc(p.text.strip())
 ppr=p._p.pPr
 is_list=ppr is not None and ppr.numPr is not None
 return ('li' if is_list else 'p'),body
def block_html(paragraphs):
 """Paragraphs (with text) as editor HTML, consecutive list items grouped in one <ul>."""
 out=[];open_list=False
 for p in paragraphs:
  if not clean(p.text):continue
  kind,body=paragraph_html(p)
  if kind=='li' and not open_list:out.append('<ul>');open_list=True
  if kind!='li' and open_list:out.append('</ul>');open_list=False
  out.append('<'+kind+'>'+body+'</'+kind+'>')
 if open_list:out.append('</ul>')
 return ''.join(out)
def fixed_blocks(doc):
 """[(key,label,heading element)] after the first section marker, in document order."""
 out=[];m=Markers();started=False;keys=set()
 for ch in doc.element.body.iterchildren():
  if not (ch.tag.endswith('}p') or ch.tag.endswith('}tbl')):continue
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
  if m.get('section_start') is not None and m['section_start']>0:t=text(elements[m['section_start']-1])
  else:t=m['label']
  t=re.sub(r'\s*:\s*$','',clean(t))
  if t and len(t)<=80 and not t.upper().startswith('INTERPRETA'):out[m['key']]=t
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
 return {'elements':elements,'markers':markers,'titled_domains':titled,'title_ranges':title_ranges(elements,markers),'identification':identification(d),'place_date':(lambda p:clean(p.text) if p is not None else None)(place_date_paragraph(d)),'fixed_blocks':[(lambda html:{'key':k,'label':label,'index':position[ch],'existing_html':html,'existing_text':plain_from_html(html)})(block_html([Paragraph(o,d) for o in existing_narrative(ch,d)])) for k,label,ch in fixed_blocks(d)],'titles':section_titles(elements,markers),'warnings':['Conferir visualmente a ordem dos marcadores e os resultados.']}

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

# ---------- formatted text from the app's editor (sanitized HTML subset, see web/src/app/rich-text.ts) ----------
from html.parser import HTMLParser
def _pt(v):
 m=re.fullmatch(r'\s*([\d.]+)\s*(pt|px|em)?\s*',v or '')
 if not m:return None
 try:n=float(m.group(1))
 except ValueError:return None
 u=m.group(2) or 'px'
 return n if u=='pt' else n*0.75 if u=='px' else n*11
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
  if _pt(st.get('font-size')):f['sz']=_pt(st['font-size'])
  if _hex(st.get('color')):f['color']=_hex(st['color'])
  if _hex(st.get('background-color')):f['bg']=_hex(st['background-color'])
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
def _twips(pt):return str(int(round(pt*20)))
def _rich_props(f,title=False,red=False):
 rpr=run_props(bool(f.get('b')) or title,red and not f.get('color'))
 sz=rpr.find(qn('w:sz'))
 def before_sz(tag,val=None):
  e=OxmlElement(tag)
  if val is not None:e.set(qn('w:val'),val)
  sz.addprevious(e)
 if f.get('i'):before_sz('w:i');before_sz('w:iCs')
 if f.get('s'):before_sz('w:strike')
 if f.get('color'):before_sz('w:color',f['color'])
 if f.get('sz'):
  for tag in ('w:sz','w:szCs'):rpr.find(qn(tag)).set(qn('w:val'),str(int(round(f['sz']*2))))
 if f.get('u'):u=OxmlElement('w:u');u.set(qn('w:val'),'single');rpr.append(u)
 if f.get('bg'):sh=OxmlElement('w:shd');sh.set(qn('w:val'),'clear');sh.set(qn('w:color'),'auto');sh.set(qn('w:fill'),f['bg']);rpr.append(sh)
 if f.get('va'):v=OxmlElement('w:vertAlign');v.set(qn('w:val'),f['va']);rpr.append(v)
 return rpr
def rich_paragraph(b,red=False):
 """Body paragraph with the report defaults (Arial 11, justified, 1.5) overridden by the editor's formatting."""
 st=b['style'];title=b['kind']=='h3'
 p=new_paragraph('',bold=title);ppr=p.find(qn('w:pPr'));sp=ppr.find(qn('w:spacing'))
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
def insert_rich_after(anchor,html,red=False):
 last=anchor;first=True
 for b in rich_blocks(html):
  if b['kind']=='h3' and not first:blank=new_paragraph('');last.addnext(blank);last=blank
  p=rich_paragraph(b,red);last.addnext(p);last=p;first=False
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
def created_anchors(d,keys,order):
 """Sections missing from the base document that the psychologist chose to create: {key: element they go before}.
 That is the title of the next section of the report found in the file; None when there is none (they then go
 before the closing place/date line, or at the end)."""
 elements=list(all_elements(d));m=Markers();starts={}
 children=[ch for ch in d.element.body.iterchildren() if ch.tag.endswith('}p') or ch.tag.endswith('}tbl')]
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
def export(base,out,sections,highlight=False,fields=None,rich=None,created=None):
 rich={k:v for k,v in (rich or {}).items() if k in sections and rich_matches(v,sections[k])}
 if os.path.abspath(base)==os.path.abspath(out):raise SystemExit('out must differ from base')
 before=sha256(base)
 d=open_docx(base);seen=[];m=Markers();replaced={}
 filled=fill_fields(d,{k:clean(v) for k,v in (fields or {}).items() if clean(v)})
 place=clean((fields or {}).get('__local_data'))
 if place:
  p=place_date_paragraph(d)
  if p is not None and (clean(p.text)==place or replace_span(p,0,len(p.text),place)):filled.append('__local_data')
 anchors=fieldless_anchors(d);added=[]
 # computed before any change, while the element order is still the file's
 created=created or {};made=created_anchors(d,[k for k in created.get('keys',[]) if k in sections and clean(sections[k])],created.get('order',[]))
 closing=place_date_paragraph(d)
 # fixed parts rewritten by the psychologist: same replacement as a section, under their heading box
 for k,label,ch in fixed_blocks(d):
  if k in sections and clean(sections[k]) and k not in seen:
   current=existing_narrative(ch,d);seen.append(k)
   if clean(' '.join(Paragraph(o,d).text for o in current))==clean(sections[k]):continue
   for old in current:
    if clean(Paragraph(old,d).text):replaced[k]=replaced.get(k,0)+1
    old.getparent().remove(old)
   insert_rich_after(ch,rich[k],highlight) if k in rich else insert_after(ch,sections[k],highlight)
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
   insert_rich_after(ch,rich[k],highlight) if k in rich else insert_after(ch,sections[k],highlight)
 # sections written by hand for a title without field: add the field label and the text after the section's content
 for k,anchor in anchors.items():
  if k in sections and clean(sections[k]) and k not in seen:
   label=new_paragraph(FIELD_LABEL,bold=True);anchor.addnext(label)
   insert_rich_after(label,rich[k],highlight) if k in rich else insert_after(label,sections[k],highlight)
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
  insert_rich_after(last,rich[k],highlight) if k in rich else insert_after(last,sections[k],highlight)
  seen.append(k);made_keys.append(k)
 d.save(out)
 after=sha256(base)
 if before!=after:raise SystemExit('base document changed during export')
 return {'inserted':seen,'missing':[k for k in sections if k not in seen],'fields_filled':filled,'replaced':replaced,'fields_added':added,'created':made_keys,'formatted':sorted(rich),'base_sha256':before,'out_sha256':sha256(out)}
def letter(out,title,subtitle,content):
 """Standalone document (the devolutiva): title, patient name and the approved text, same body style as the report."""
 if os.path.exists(out):raise SystemExit('output exists')
 d=Document();sect=d.element.body.sectPr
 head=new_paragraph(title,bold=True);jc=head.find(qn('w:pPr')).find(qn('w:jc'));jc.set(qn('w:val'),'center');sect.addprevious(head)
 if subtitle:
  sub=new_paragraph(subtitle);sub.find(qn('w:pPr')).find(qn('w:jc')).set(qn('w:val'),'center');sect.addprevious(sub)
 sect.addprevious(new_paragraph(''))
 for text,bold in blocks(content):sect.addprevious(new_paragraph(text,bold))
 d.save(out)
 return {'out':out,'paragraphs':len(blocks(content))}
# Pictures inside body paragraphs (score tables pasted as images, charts saved as pictures), by element index -- the
# same order as all_elements. Only for showing on screen; they are never sent to the AI.
MAX_IMAGE=4*1024*1024
def images(path):
 import base64
 d=open_docx(path);out={};i=0
 for ch in d.element.body.iterchildren():
  if not (ch.tag.endswith('}p') or ch.tag.endswith('}tbl')):continue
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
def main():
 op=sys.argv[1]
 sys.stdout.reconfigure(encoding='utf-8')
 if op=='inspect': print(json.dumps(inspect(sys.argv[2]),ensure_ascii=False))
 elif op=='export':
  spec=json.loads(sys.stdin.buffer.read().decode('utf-8')); print(json.dumps(export(spec['base'],spec['out'],spec['sections'],spec.get('highlight',False),spec.get('fields'),spec.get('rich'),spec.get('created')),ensure_ascii=False))
 elif op=='images': print(json.dumps(images(sys.argv[2])))
 elif op=='letter':
  spec=json.loads(sys.stdin.buffer.read().decode('utf-8')); print(json.dumps(letter(spec['out'],spec.get('title',''),spec.get('subtitle',''),spec['content']),ensure_ascii=False))
 else: raise SystemExit('unknown operation')
if __name__=='__main__':main()
