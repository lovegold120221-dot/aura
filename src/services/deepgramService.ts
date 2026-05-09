import { DeepgramClient } from '@deepgram/sdk';

const DEEPGRAM_API_KEY = 'fc235fdc97525b9c7e539bab58f14478255ab063';

let mediaRecorder: MediaRecorder | null = null;
let connection: any = null;
let stream: MediaStream | null = null;
let recordingInterval: any = null;

export const startDeepgramTranscription = async (
  onTranscript: (text: string, isFinal: boolean, words: any[], detectedLanguage?: string) => void,
  onSpeechStarted: () => void,
  onSpeechEnded: () => void,
  onError: (err: any) => void
) => {
  try {
    const deepgram = new DeepgramClient({ apiKey: DEEPGRAM_API_KEY });

    connection = await deepgram.listen.v1.connect({
      model: 'nova-3',
      language: 'multi',
      smart_format: true,
      interim_results: true,
      utterance_end_ms: 2000,
      endpointing: 2000,
      vad_events: true,
      numerals: true,
    } as any);

    let sentenceBuffer = '';
    let wordsBuffer: any[] = [];

    connection.on('open', async () => {
      console.log('Deepgram Connection opened.');

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm',
      });

      mediaRecorder.addEventListener('dataavailable', async (event) => {
        if (event.data.size > 0 && connection && connection.socket?.readyState === 1) {
          connection.socket.send(event.data);
        }
      });

      mediaRecorder.start(250); // Send data chunks every 250ms
    });
    
    connection.on('message', (data: any) => {
      if (data.type === 'SpeechStarted') {
        onSpeechStarted();
      }
      
      if (data.type === 'Results' && data.channel?.alternatives?.[0]) {
        const transcript = data.channel.alternatives[0].transcript;
        const words = data.channel.alternatives[0].words || [];
        // Deepgram returns language detection in nova-2 if requested
        const detectedLanguage = data.channel.alternatives[0].languages ? data.channel.alternatives[0].languages[0] : undefined;
        
        if (data.is_final) {
          if (transcript) {
            sentenceBuffer += (sentenceBuffer ? ' ' : '') + transcript;
            wordsBuffer = [...wordsBuffer, ...words];
          }
          if (data.speech_final) {
            const finalSentence = sentenceBuffer;
            const finalWords = [...wordsBuffer];
            sentenceBuffer = '';
            wordsBuffer = [];
            if (finalSentence.trim().length > 0) {
              onTranscript(finalSentence.trim(), true, finalWords, detectedLanguage);
            }
          } else {
            onTranscript(sentenceBuffer.trim(), false, wordsBuffer, detectedLanguage);
          }
        } else {
          // It's an interim result
          const interimSentence = sentenceBuffer + (sentenceBuffer ? ' ' : '') + (transcript || '');
          const interimWords = [...wordsBuffer, ...words];
          if (interimSentence.trim().length > 0) {
            onTranscript(interimSentence.trim(), false, interimWords, detectedLanguage);
          }
        }
      }

      if (data.type === 'UtteranceEnd') {
        if (sentenceBuffer.trim().length > 0) {
          const finalSentence = sentenceBuffer;
          const finalWords = [...wordsBuffer];
          sentenceBuffer = '';
          wordsBuffer = [];
          onTranscript(finalSentence.trim(), true, finalWords);
        }
        onSpeechEnded();
      }
    });

    connection.on('close', () => {
      console.log('Deepgram Connection closed.');
    });

    connection.on('error', (err: any) => {
      console.error('Deepgram Error:', err);
      onError(err);
    });

    connection.connect();
    await connection.waitForOpen();

  } catch (err) {
    console.error('Failed to start Deepgram:', err);
    onError(err);
  }
};

export const setDeepgramMuted = (muted: boolean) => {
  if (stream) {
    stream.getAudioTracks().forEach(track => {
      track.enabled = !muted;
    });
  }
};

export const stopDeepgramTranscription = () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
  if (connection) {
    connection.close();
  }
  mediaRecorder = null;
  stream = null;
  connection = null;
};
