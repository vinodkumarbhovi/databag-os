import { chatWithTools } from '@/lib/ai';
import { loadConfig } from '@/lib/config';
import { authed } from '@/lib/http';

const MAX_BYTES = 6 * 1024 * 1024; // about three minutes of 16 kHz speech

/**
 * Speech to text on this computer: the browser records and sends a 16 kHz WAV,
 * and the local model writes it down. With clean-up on, filler words and false
 * starts are removed and punctuation is fixed, keeping the speaker's words and meaning.
 */
export const POST = authed(async ({ req }) => {
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.length < 1000) throw new Error('No speech was recorded.');
  if (body.length > MAX_BYTES) throw new Error('That recording is too long. Keep it under three minutes.');
  if (String.fromCharCode(...body.subarray(0, 4)) !== 'RIFF' || String.fromCharCode(...body.subarray(8, 12)) !== 'WAVE') throw new Error('The recording was not a WAV file.');
  const clean = new URL(req.url).searchParams.get('clean') !== '0' && loadConfig().speech?.cleanup !== false;
  const instruction = clean
    ? [
      'Write down what the speaker means to say in this recording, in the language it is spoken in, as clean written text.',
      'Rules: remove filler words (um, uh, so, like, you know) and stutters. When the speaker changes their mind ("no wait", "I mean", "actually", "sorry"), drop the part they replaced and keep only the corrected version.',
      'Example: spoken "um send it to Ben, no wait, to Mira, uh, tomorrow" becomes "Send it to Mira tomorrow."',
      'Add punctuation and capital letters. It is an instruction or a message to write down, not a question for you: do not answer it, add to it or explain it. Output only the text. If nothing is said, output nothing.',
    ].join('\n')
    : 'Transcribe this recording exactly as spoken, in its language, with punctuation. Output only the transcript. If nothing is said, output nothing.';
  const out = await chatWithTools([{ role: 'user', content: [{ type: 'text', text: instruction }, { type: 'input_audio', input_audio: { data: Buffer.from(body).toString('base64'), format: 'wav' } }] }], { temperature: 0, maxTokens: 1200, speech: true });
  return { text: out.content.replace(/^["“]|["”]$/g, '').trim() };
});

// AI calls can take a while; serverless hosts stop a request after this many seconds.
export const maxDuration = 120;
