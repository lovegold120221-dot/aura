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
          onerror: (err: any) => {
            console.error("Live API Error:", err);
            if (err?.message?.includes("quota") || err?.status === 429 || err?.message?.includes("exceeded")) {
              reject(new Error("You exceeded your current quota for translation audio. Please check your billing details."));
            } else {
              reject(err);
            }
          }
        }
      });

      session.sendClientContent({
        turns: [text]
      });
    } catch (err: any) {
      if (err?.message?.includes("quota") || err?.status === 429 || err?.message?.includes("exceeded")) {
        reject(new Error("You exceeded your current quota for translation audio. Please check your billing details."));
      } else {
        reject(err);
      }
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

import { langMap } from '../langMap';

export async function analyzeText(
  transcriptText: string, 
  targetLanguage: string = "Multilingual", 
  fallbackLanguage: string = "English",
  onChunk?: (partial: Partial<VoiceAnalysis>) => void
): Promise<VoiceAnalysis> {
  try {
    const fallbackCode = langMap[fallbackLanguage] || 'en';
    const targetCode = targetLanguage !== 'Multilingual' ? (langMap[targetLanguage] || fallbackCode) : fallbackCode;
    
    // First translate to Dutch (nl)
    let url = `https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=auto&tl=nl&q=${encodeURIComponent(transcriptText)}`;
    let res = await fetch(url);
    if (!res.ok) throw new Error(`Translate API error: ${res.statusText}`);
    let data = await res.json();
    
    let sourceLangCode = data[2];
    let translation = data[0].map((x: any) => x[0]).join('');
    
    const isDutch = sourceLangCode === 'nl' || sourceLangCode?.startsWith('nl');
    
    // If the original text was Dutch, translate to the target language instead
    if (isDutch) {
      url = `https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=nl&tl=${targetCode}&q=${encodeURIComponent(transcriptText)}`;
      res = await fetch(url);
      if (!res.ok) throw new Error(`Translate API error: ${res.statusText}`);
      data = await res.json();
      translation = data[0].map((x: any) => x[0]).join('');
    }
    
    let languageName = sourceLangCode;
    try {
      const displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
      languageName = displayNames.of(sourceLangCode) || sourceLangCode;
    } catch(e) {}

    const analysis = {
      transcript: transcriptText,
      translation: translation,
      language: languageName,
      emotion: "Neutral",
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
  } catch (e: any) {
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

