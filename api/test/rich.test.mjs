// Formatted section text (rich editor HTML) reaching the Word export. Synthetic text only; needs Python with python-docx.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PYTHON = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
const run = code => {
  const r = spawnSync(PYTHON, ['-c', 'import sys,json;sys.path.insert(0,"worker");import docx_worker as w\n' + code], {cwd: ROOT, encoding: 'utf8'});
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

const HTML = '<h3>Atenção</h3><p style="text-align: center; line-height: 2; margin-top: 12pt; margin-bottom: 6pt; margin-left: 36pt;">Texto <b>forte</b> '
  + '<span style="font-size: 14pt; color: rgb(192, 0, 0);">grande</span> <span style="background-color: rgb(255, 255, 0);">realce</span> <i>it</i> <u>sub</u> <s>tach</s></p>'
  + '<ul><li>um</li></ul><ol><li>dois</li></ol>';
const PLAIN = '## Atenção\n\nTexto forte grande realce it sub tach\n\n- um\n\n1. dois';

test('plain text of the editor HTML matches the saved content rules', () => {
  const r = run(`print(json.dumps([w.plain_from_html(${JSON.stringify(HTML)}), w.rich_matches(${JSON.stringify(HTML)}, ${JSON.stringify(PLAIN)}), w.rich_matches(${JSON.stringify(HTML)}, "texto novo da IA")]))`);
  assert.deepEqual(r, [PLAIN, true, false]);
});

test('formatting becomes Word paragraph and run properties', () => {
  const r = run(`
from docx import Document
from docx.oxml.ns import qn
d=Document();a=d.add_paragraph('ancora')._p
w.insert_rich_after(a,${JSON.stringify(HTML)})
ps=[p for p in d.element.body.iter(qn('w:p'))][1:]
def val(e,path,attr='w:val'):
 x=e.find(path);return None if x is None else x.get(qn(attr))
body=ps[1];ppr=body.find(qn('w:pPr'))
runs=body.findall(qn('w:r'))
props=lambda i:runs[i].find(qn('w:rPr'))
print(json.dumps({'title_bold':ps[0].find('.//'+qn('w:b')) is not None,'jc':val(ppr,qn('w:jc')),'line':val(ppr,qn('w:spacing'),'w:line'),
 'before':val(ppr,qn('w:spacing'),'w:before'),'after':val(ppr,qn('w:spacing'),'w:after'),'left':val(ppr,qn('w:ind'),'w:left'),
 'bold':props(1).find(qn('w:b')) is not None,'size':val(props(3),qn('w:sz')),'color':val(props(3),qn('w:color')),
 'fill':val(props(5),qn('w:shd'),'w:fill'),'italic':props(7).find(qn('w:i')) is not None,'u':val(props(9),qn('w:u')),
 'strike':props(11).find(qn('w:strike')) is not None,'items':[''.join(t.text for t in p.iter(qn('w:t'))) for p in ps[2:]]}))`);
  assert.deepEqual(r, {title_bold: true, jc: 'center', line: '480', before: '240', after: '120', left: '720', bold: true, size: '28', color: 'C00000',
    fill: 'FFFF00', italic: true, u: 'single', strike: true, items: ['•um', '1.dois']});
});

// One formatting model all the way to the Word file: what the psychologist chose (alignment, font, size, color, bold,
// italic, underline) reaches the exported report; sizes and colors the browser writes by itself (px, the app's own text
// color) do not, so text without a chosen size stays the report default (Arial 11 pt, justified).
const CHOSEN = '<p style="text-align: justify;"><b>Motivo fictício:</b> <span style="font-size: 13pt; font-family: Georgia; color: rgb(31, 78, 121);">'
  + '<i>texto</i> <u>sintético</u></span></p>'
  + '<p><span style="font-size: 17px; color: rgb(28, 43, 41);">Continuação sem tamanho escolhido.</span></p>'
  + '<p style="text-align: center;"><span style="font-size: 12pt;">Externo <span style="font-size: 1.5em;">relativo</span></span></p>'
  + '<p style="text-align: left;">À esquerda.</p>';
const CHOSEN_PLAIN = 'Motivo fictício: texto sintético\n\nContinuação sem tamanho escolhido.\n\nExterno relativo\n\nÀ esquerda.';

test('chosen formatting reaches the exported Word file; browser leftovers do not', () => {
  const r = run(`
import tempfile,os
from docx import Document
from docx.oxml.ns import qn
tmp=tempfile.mkdtemp();base=os.path.join(tmp,'base.docx');out=os.path.join(tmp,'out.docx')
d=Document();d.add_paragraph('Paciente: Fulano Fictício');d.add_paragraph('ANAMNESE');d.add_paragraph('CONCLUSÃO/RESULTADOS');d.save(base)
before=w.sha256(base)
w.export(base,out,{'anamnesis':${JSON.stringify(CHOSEN_PLAIN)}},rich={'anamnesis':${JSON.stringify(CHOSEN)}})
ps=Document(out).paragraphs;i=[p.text for p in ps].index('ANAMNESE')
def run_info(r):
 rpr=r._r.find(qn('w:rPr'));g=lambda t,a='w:val':(lambda e:None if e is None else e.get(qn(a)))(rpr.find(qn(t)))
 return [r.text,g('w:sz'),g('w:rFonts','w:ascii'),g('w:color'),rpr.find(qn('w:b')) is not None,rpr.find(qn('w:i')) is not None,g('w:u')]
def jc(p):
 e=p._p.find(qn('w:pPr')).find(qn('w:jc'));return e.get(qn('w:val'))
print(json.dumps({'same_base':w.sha256(base)==before,'paras':[[jc(p),[run_info(r) for r in p.runs]] for p in ps[i+1:i+5]]}))`);
  assert.equal(r.same_base, true);
  assert.deepEqual(r.paras, [
    ['both', [['Motivo fictício:', '22', 'Arial', null, true, false, null], [' ', '22', 'Arial', null, false, false, null],
      ['texto', '26', 'Georgia', '1F4E79', false, true, null], [' ', '26', 'Georgia', '1F4E79', false, false, null], ['sintético', '26', 'Georgia', '1F4E79', false, false, 'single']]],
    ['both', [['Continuação sem tamanho escolhido.', '22', 'Arial', null, false, false, null]]],
    ['center', [['Externo ', '24', 'Arial', null, false, false, null], ['relativo', '36', 'Arial', null, false, false, null]]],
    ['left', [['À esquerda.', '22', 'Arial', null, false, false, null]]],
  ]);
});
