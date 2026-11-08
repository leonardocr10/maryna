#!/usr/bin/env python3
"""Natural voice through Microsoft Edge's online read-aloud service (edge-tts package).

EXTERNAL SERVICE: the section text is sent to Microsoft. Used only when TTS_PROVIDER=edge in api/.env
(authorized by the psychologist); otherwise the local Piper voice is used. No text is logged.
Voice and speed: EDGE_TTS_VOICE, EDGE_TTS_RATE; a request may choose another pt-BR neural voice.

Two modes:
- default: reads the text on stdin and writes MP3 audio to stdout (one request per process);
- --serve: long-lived process (the package loads once). Reads one JSON line {"text": "..."} per request and
  streams the MP3 as frames: 4-byte big-endian length + bytes, as soon as each piece arrives; a 0-length frame
  ends the request. Playback can start with the first frame.
"""
import sys,os,json,struct,asyncio,re
import edge_tts

VOICE=os.environ.get('EDGE_TTS_VOICE') or 'pt-BR-FranciscaNeural'
RATE=os.environ.get('EDGE_TTS_RATE') or '-5%'

VOICE_RE=re.compile(r'^pt-BR-[A-Za-z]+Neural$')
async def stream(text,write,voice=None):
 v=voice if voice and VOICE_RE.match(voice) else VOICE
 async for chunk in edge_tts.Communicate(text,v,rate=RATE).stream():
  if chunk['type']=='audio' and chunk['data']:write(chunk['data'])

def serve():
 out=sys.stdout.buffer
 def frame(data):out.write(struct.pack('>I',len(data)));out.write(data);out.flush()
 for line in sys.stdin:
  try:
   req=json.loads(line);text=str(req.get('text') or '').strip()
   if text:asyncio.run(stream(text,frame,req.get('voice')))
  except Exception as e:
   sys.stderr.write('edge tts error: '+type(e).__name__+'\n')
  frame(b'')

async def once():
 text=sys.stdin.buffer.read().decode('utf-8').strip()
 if not text:sys.exit(2)
 out=sys.stdout.buffer
 await stream(text,out.write)
 out.flush()

if __name__=='__main__':
 if '--serve' in sys.argv:
  sys.stdin.reconfigure(encoding='utf-8');serve()
 else:
  try:asyncio.run(once())
  except Exception as e:sys.stderr.write('edge tts error: '+type(e).__name__+'\n');sys.exit(1)
