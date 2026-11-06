#!/usr/bin/env python3
"""Natural voice through Microsoft Edge's online read-aloud service (edge-tts package).

EXTERNAL SERVICE: the section text is sent to Microsoft. Used only when TTS_PROVIDER=edge in api/.env
(authorized by the psychologist); otherwise the local Piper voice is used. No text is logged.
Reads the text on stdin and writes MP3 audio to stdout. Voice and speed: EDGE_TTS_VOICE, EDGE_TTS_RATE.
"""
import sys,os,asyncio
import edge_tts

VOICE=os.environ.get('EDGE_TTS_VOICE') or 'pt-BR-FranciscaNeural'
RATE=os.environ.get('EDGE_TTS_RATE') or '-5%'

async def main():
 text=sys.stdin.buffer.read().decode('utf-8').strip()
 if not text:sys.exit(2)
 out=sys.stdout.buffer
 async for chunk in edge_tts.Communicate(text,VOICE,rate=RATE).stream():
  if chunk['type']=='audio':out.write(chunk['data'])
 out.flush()

if __name__=='__main__':
 try:asyncio.run(main())
 except Exception as e:sys.stderr.write('edge tts error: '+type(e).__name__+'\n');sys.exit(1)
