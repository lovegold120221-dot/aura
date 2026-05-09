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

export async function analyzeText(
  transcriptText: string, 
  targetLanguage: string = "Multilingual", 
  fallbackLanguage: string = "English",
  onChunk?: (partial: Partial<VoiceAnalysis>) => void
): Promise<VoiceAnalysis> {
  try {
    const model = "gemini-3.1-flash-lite";

    const prompt = `You are a strict translation engine. Obey these rules exactly.
1. Detect the language of the source text.
2. Detect the primary emotion of the text in one word (e.g., Happy, Sad, Angry, Neutral, Excited).
3. If the detected language is Dutch/Flemish (Vlaams, Nederlands):
   - Translate the text to: ${targetLanguage !== 'Multilingual' ? targetLanguage : fallbackLanguage}.
4. If the detected language is NOT Dutch/Flemish:
   - Translate the text to: Dutch Flemish.
   
Respond ONLY with a valid JSON object matching this schema, no markdown blocks:
{
  "translation": "Translated text string",
  "detectedLanguage": "The name of the language detected (e.g., English, Spanish, Dutch Flemish)",
  "emotion": "Single word emotion"
}

Source text: "${transcriptText}"`;

    const res = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        temperature: 0.1,
      }
    });

    const resultText = res.text?.trim() || "{}";
    const data = JSON.parse(resultText);
    
    const analysis = {
      transcript: transcriptText,
      translation: data.translation || "Translation Error",
      language: data.detectedLanguage || "Unknown",
      emotion: data.emotion || "Neutral",
      confidence: 99
    };
    
    if (onChunk) {
      onChunk({
        transcript: analysis.transcript,
        translation: analysis.translation,
        language: analysis.language,
        emotion: analysis.emotion
      });
    }

    return analysis;
  } catch (e) {
    console.error("Failed to parse analysis:", e);
    return {
      transcript: transcriptText,
      translation: "Error processing translation",
      language: "Unknown",
      emotion: "Neutral",
      confidence: 0
    };
  }
}

