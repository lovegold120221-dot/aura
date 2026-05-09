import { DeepgramClient } from '@deepgram/sdk';

const DEEPGRAM_API_KEY = 'fc235fdc97525b9c7e539bab58f14478255ab063';

let mediaRecorder: MediaRecorder | null = null;
let connection: any = null;
let stream: MediaStream | null = null;
let recordingInterval: any = null;

export const startDeepgramTranscription = async (
  onTranscript: (text: string, isFinal: boolean) => void,
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
      utterance_end_ms: 1000,
      endpointing: 10,
      vad_events: true,
      numerals: true,
    } as any);

    connection.on('open', async () => {
      console.log('Deepgram Connection opened.');

      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm',
      });

      mediaRecorder.addEventListener('dataavailable', async (event) => {
        if (event.data.size > 0 && connection.socket?.readyState === 1) {
          connection.socket.send(event.data);
        }
      });

      mediaRecorder.start(250); // Send data chunks every 250ms
    });
    
    connection.on('message', (data: any) => {
      if (data.type === 'SpeechStarted') {
        onSpeechStarted();
      }
      if (data.type === 'UtteranceEnd') {
        onSpeechEnded();
      }
      if (data.type === 'Results' && data.channel?.alternatives?.[0]) {
        const transcript = data.channel.alternatives[0].transcript;
        if (transcript) {
          onTranscript(transcript, data.is_final);
        }
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
