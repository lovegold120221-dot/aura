import { GoogleGenAI, Modality, Type, MediaResolution, LiveServerMessage } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// WAV Header creation adapted for browser (Uint8Array)
function createWavHeader(dataLength: number, sampleRate: number = 24000) {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // ByteRate
  view.setUint16(32, 2, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  return new Uint8Array(buffer);
}

export async function speakTranslation(text: string, emotion: string = "Neutral") {
  const model = 'gemini-3.1-flash-live-preview';
  
  const config = {
    responseModalities: [Modality.AUDIO],
    mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName: 'Zephyr' }
      }
    },
    systemInstruction: {
      parts: [{
        text: `You are a Reader, Read Aloud ONLY the users text input in a high human nuance. You dont add Intro or extro. You are not conversational. You are just A READER ENGINE. Read Aloud the input of the user tailored to the language. Base your tone on the emotion: ${emotion}.`,
      }]
    },
  };

  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  let nextStartTime = audioContext.currentTime;

  return new Promise<void>(async (resolve, reject) => {
    try {
      const session = await ai.live.connect({
        model,
        config,
        callbacks: {
          onmessage: async (message: LiveServerMessage) => {
            const parts = message.serverContent?.modelTurn?.parts;
            if (parts) {
              const part = parts[0];
              if (part?.inlineData) {
                // PCM 16-bit Mono 24kHz
                const binary = atob(part.inlineData.data);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                
                const int16Buffer = new Int16Array(bytes.buffer);
                const float32Buffer = new Float32Array(int16Buffer.length);
                for (let i = 0; i < int16Buffer.length; i++) {
                  float32Buffer[i] = int16Buffer[i] / 32768.0;
                }

                const audioBuffer = audioContext.createBuffer(1, float32Buffer.length, 24000);
                audioBuffer.getChannelData(0).set(float32Buffer);

                const source = audioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(audioContext.destination);
                
                const start = Math.max(nextStartTime, audioContext.currentTime);
                source.start(start);
                nextStartTime = start + audioBuffer.duration;
              }
            }

            if (message.serverContent?.turnComplete) {
              // Wait for the scheduled audio to finish
              const waitTime = (nextStartTime - audioContext.currentTime) * 1000;
              setTimeout(() => {
                session.close();
                audioContext.close();
                resolve();
              }, Math.max(0, waitTime + 100));
            }
          },
          onerror: (err) => {
            console.error("Live API Error:", err);
            reject(err);
          }
        }
      });

      session.sendClientContent({
        turns: [text]
      });
    } catch (err) {
      reject(err);
    }
  });
}

export interface VoiceAnalysis {
  transcript: string;
  translation: string;
  language: string;
  emotion: string;
  confidence: number;
}

// CORE TRANSLATION FLOW (LOCKED)
// Logic: 
// 1. Every non-Flemish language -> Translated to Dutch Flemish.
// 2. Every Dutch Flemish language -> Translated back to the last detected non-Flemish language (fallback: English).
export async function analyzeVoice(
  audioBase64: string, 
  targetLanguage: string = "Dutch Flemish", 
  fallbackLanguage: string = "English",
  onChunk?: (partial: Partial<VoiceAnalysis>) => void
): Promise<VoiceAnalysis> {
  const model = "gemini-flash-latest";
  
  const responseStream = await ai.models.generateContentStream({
    model,
    contents: [
      {
        parts: [
          {
            text: `ACT AS NEURAL INTERPRETER. 
1. Detect input language.
2. Provide verbatim transcript.
3. Translate to ${targetLanguage}.
   - EXCEPTION: If the detected input language IS ${targetLanguage}, translate the text into ${fallbackLanguage} instead.
4. Detect emotion.
Output JSON only. Be extremely fast.`,
          },
          {
            inlineData: {
              data: audioBase64,
              mimeType: "audio/wav",
            },
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          transcript: { type: Type.STRING },
          translation: { type: Type.STRING },
          language: { type: Type.STRING },
          emotion: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
        },
        required: ["transcript", "translation", "language", "emotion"],
      },
    },
  });

  let fullText = "";
  for await (const chunk of responseStream) {
    fullText += chunk.text;
    if (onChunk) {
      try {
        // Crude partial JSON parser for UI feedback
        const transcriptMatch = fullText.match(/"transcript"\s*:\s*"([^"]*)"?/);
        const translationMatch = fullText.match(/"translation"\s*:\s*"([^"]*)"?/);
        const languageMatch = fullText.match(/"language"\s*:\s*"([^"]*)"?/);
        const emotionMatch = fullText.match(/"emotion"\s*:\s*"([^"]*)"?/);
        
        onChunk({
          transcript: transcriptMatch ? transcriptMatch[1] : undefined,
          translation: translationMatch ? translationMatch[1] : undefined,
          language: languageMatch ? languageMatch[1] : undefined,
          emotion: emotionMatch ? emotionMatch[1] : undefined,
        });
      } catch (e) { /* ignore */ }
    }
  }

  try {
    return JSON.parse(fullText) as VoiceAnalysis;
  } catch (e) {
    console.error("Failed to parse analysis:", e);
    return {
      transcript: "Error parsing transcript",
      translation: "Fout bij het parseren van het script",
      language: "Unknown",
      emotion: "Unknown",
      confidence: 0
    };
  }
}
