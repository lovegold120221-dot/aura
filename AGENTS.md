# Translation Flow Configuration

The application follows a strict bidirectional translation flow between Dutch Flemish and other detected languages.

## Core Logic
1. **Default Target**: Any language detected (other than Dutch Flemish) must be translated into **Dutch Flemish**.
2. **Reverse Target**: If the input language is detected as **Dutch Flemish**, it must be translated into the **last detected non-Flemish language**.
3. **Fallback**: If no previous non-Flemish language exists, the fallback is **English**.

## Implementation Details
- `analyzeVoice` in `/src/services/geminiService.ts` handles the prompt construction.
- `App.tsx` maintains the state of `lastNonFlemishLanguage`.
- VAD (Voice Activity Detection) triggers processing upon speech completion.

Do NOT change this translation logic unless explicitly requested.
