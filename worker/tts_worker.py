#!/usr/bin/env python3
"""Local neural text-to-speech (Piper). Nothing leaves the computer and no text is logged.

Long-lived process so the voice loads once: reads one JSON line {"text": "..."} per request on stdin and
answers with a 4-byte big-endian length followed by that many bytes of WAV audio (length 0 = failure).
Voice: worker/voices/pt_BR-faber-medium.onnx (override with PIPER_VOICE); a request may name another model of
worker/voices ({"text": "...", "voice": "pt_BR-cadu-medium"}). Each model loads once.
"""
import sys,os,io,json,wave,struct,re
from piper import PiperVoice,SynthesisConfig

# Slower than the model default (1.0): clearer for long clinical text. PIPER_LENGTH_SCALE overrides.
SPEED=SynthesisConfig(length_scale=float(os.environ.get('PIPER_LENGTH_SCALE') or 1.2))
VOICE=os.environ.get('PIPER_VOICE') or os.path.join(os.path.dirname(os.path.abspath(__file__)),'voices','pt_BR-faber-medium.onnx')

VOICES_DIR=os.path.join(os.path.dirname(os.path.abspath(__file__)),'voices')
loaded={}
def model(name):
 path=VOICE
 if name and re.fullmatch(r'[A-Za-z0-9_-]+',name) and os.path.exists(os.path.join(VOICES_DIR,name+'.onnx')):path=os.path.join(VOICES_DIR,name+'.onnx')
 if path not in loaded:loaded[path]=PiperVoice.load(path)
 return loaded[path]

def main():
 model(None)
 out=sys.stdout.buffer
 for line in sys.stdin:
  try:
   req=json.loads(line);text=str(req.get('text') or '').strip()
   buf=io.BytesIO()
   with wave.open(buf,'wb') as w:model(req.get('voice')).synthesize_wav(text,w,syn_config=SPEED)
   data=buf.getvalue() if text else b''
  except Exception as e:
   sys.stderr.write('tts error: '+type(e).__name__+'\n');data=b''
  out.write(struct.pack('>I',len(data)));out.write(data);out.flush()

if __name__=='__main__':main()
