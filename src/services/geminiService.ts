import { langMap } from '../langMap';

export async function speakTranslation(text: string, languageName: string = "English") {
  return new Promise<void>((resolve, reject) => {
    if (!('speechSynthesis' in window)) {
      return reject(new Error('Text-to-speech is not supported in this browser.'));
    }

    const langCode = langMap[languageName] || 'en';

    window.speechSynthesis.cancel(); // Cancel any ongoing speech

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = langCode;
    utterance.rate = 1.0;
    
    // Attempt to set a matching voice if available
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find(v => v.lang.startsWith(langCode));
    if (voice) {
      utterance.voice = voice;
    }

    utterance.onend = () => {
      resolve();
    };

    utterance.onerror = (e) => {
      console.error('Speech synthesis error:', e);
      resolve(); // resolve so it doesn't block the UI
    };

    window.speechSynthesis.speak(utterance);
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

