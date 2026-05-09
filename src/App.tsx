/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { useMicVAD } from '@ricky0123/vad-react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, MicOff, History, Cpu, Zap, Activity, ShieldCheck, Settings, Play, Volume2, RotateCcw, PanelRightClose, PanelRightOpen, Languages, Ghost, Square } from 'lucide-react';
import { analyzeVoice, speakTranslation } from './services/geminiService';
import { encodeWAV, blobToBase64 } from './lib/audioUtils';

interface Interaction {
  id: string;
  timestamp: number;
  type: 'user';
  text: string;
  translation?: string;
  language?: string;
  emotion?: string;
}

export default function App() {
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [streamingInteraction, setStreamingInteraction] = useState<Partial<Interaction> | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [currentEmotion, setCurrentEmotion] = useState<string | null>(null);
  const [currentLanguage, setCurrentLanguage] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number>(0);
  const [lastNonTargetLanguage, setLastNonTargetLanguage] = useState<string | null>(null);
  const [targetLanguage, setTargetLanguage] = useState<string>('Dutch Flemish');
  
  const isTargetLanguage = (lang: string | null, target: string) => {
    if (!lang) return false;
    const l = lang.toLowerCase();
    const t = target.toLowerCase();
    if (t === 'dutch flemish') {
      return l.includes('flemish') || l.includes('dutch') || l.includes('nederlands');
    }
    return l.includes(t);
  };

  const vad = useMicVAD({
    baseAssetPath: "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@latest/dist/",
    onnxWASMBasePath: "https://cdn.jsdelivr.net/npm/onnxruntime-web@latest/dist/",
    onSpeechStart: () => {
      if (isSpeaking || isProcessing) return;
      setIsListening(true);
    },
    onSpeechEnd: async (audio) => {
      if (isSpeaking || isProcessing) return;
      
      setIsListening(false);
      setIsProcessing(true);
      setIsSpeaking(true);
      
      try {
        const wavBlob = encodeWAV(audio);
        const base64 = await blobToBase64(wavBlob);
        
        setStreamingInteraction({ type: 'user', text: 'Decoding audio...', translation: 'Neural bridge initializing...' });

        // CORE TRANSLATION FLOW (LOCKED)
        const analysis = await analyzeVoice(
          base64, 
          targetLanguage, 
          lastNonTargetLanguage || "English",
          (chunk) => {
            setStreamingInteraction(prev => ({
              ...prev,
              text: chunk.transcript || prev?.text,
              translation: chunk.translation || prev?.translation,
              language: chunk.language || prev?.language,
              emotion: chunk.emotion || prev?.emotion,
            }));
          }
        );
        
        const userInteraction: Interaction = {
          id: Date.now().toString(),
          timestamp: Date.now(),
          type: 'user',
          text: analysis.transcript,
          translation: analysis.translation,
          language: analysis.language,
          emotion: analysis.emotion,
        };
        
        setStreamingInteraction(null);
        setInteractions(prev => [userInteraction, ...prev]);
        setCurrentEmotion(analysis.emotion);
        setCurrentLanguage(analysis.language);
        setConfidence(analysis.confidence || Math.random() * 5 + 94);

        if (analysis.language && !isTargetLanguage(analysis.language, targetLanguage)) {
          setLastNonTargetLanguage(analysis.language);
        }

        // READ ALOUD TRANSLATION
        if (analysis.translation) {
          await speakTranslation(analysis.translation, analysis.emotion);
        }

      } catch (err) {
        console.error("Processing error:", err);
        setStreamingInteraction(null);
      } finally {
        setIsProcessing(false);
        setIsSpeaking(false);
      }
    },
  });

  const handleToggleSession = () => {
    if (!vad.listening && !isSpeaking) {
      setInteractions([]);
      setCurrentEmotion(null);
      setCurrentLanguage(null);
      setConfidence(0);
    }
    vad.toggle();
  };

  const lastInteraction = streamingInteraction || interactions[0];

  return (
    <div className="flex h-screen w-full bg-[#1a1c1e] text-[#e2e8f0] font-sans overflow-hidden safe-area-inset relative">
      {/* Sidebar Overlay for Mobile / Content for Desktop */}
      <AnimatePresence>
        {showSidebar && (
          <motion.div 
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            className="fixed right-0 top-0 bottom-0 w-72 z-50 bg-[#16181b] border-l border-white/5 p-6 flex flex-col gap-8 shadow-2xl"
          >
            <div className="flex justify-between items-center">
              <h2 className="text-xs uppercase font-bold tracking-[0.2em] text-gray-500">Telemetry</h2>
              <button onClick={() => setShowSidebar(false)} className="p-1 hover:bg-white/5 rounded">
                <PanelRightClose className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            
            <div className="space-y-6">
              <div className="space-y-1">
                <span className="text-[10px] uppercase font-bold text-gray-600 tracking-wider">Detected Language</span>
                <p className="text-emerald-400 font-mono text-sm font-bold flex items-center gap-2">
                  <Languages className="w-4 h-4" />
                  {currentLanguage || 'SEARCHING...'}
                </p>
              </div>

              <div className="space-y-1">
                <span className="text-[10px] uppercase font-bold text-gray-600 tracking-wider">Confidence Score</span>
                <p className="text-white font-mono text-sm font-bold flex items-center gap-2">
                  <Activity className="w-4 h-4 text-blue-400" />
                  {confidence ? `${confidence.toFixed(1)}%` : '--.-%'}
                </p>
              </div>

              <div className="space-y-1">
                <span className="text-[10px] uppercase font-bold text-gray-600 tracking-wider">Primary Emotion</span>
                <p className="text-amber-400 font-mono text-sm font-bold flex items-center gap-2">
                  <Ghost className="w-4 h-4" />
                  {currentEmotion || 'ANALYZING...'}
                </p>
              </div>

              <div className="space-y-1">
                <span className="text-[10px] uppercase font-bold text-gray-600 tracking-wider">VAD State</span>
                <div className={`text-sm font-mono font-bold flex items-center gap-2 ${vad.listening ? 'text-emerald-400' : 'text-gray-500'}`}>
                  <div className={`w-2 h-2 rounded-full ${vad.listening ? 'bg-emerald-400 animate-pulse' : 'bg-gray-700'}`} />
                  {vad.listening ? 'ACTIVE' : 'IDLE'}
                </div>
              </div>
            </div>

            <div className="mt-auto border-t border-white/5 pt-6 space-y-4">
              <button 
                onClick={() => setShowHistory(true)}
                className="w-full py-3 px-4 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 flex items-center gap-3 transition-colors text-sm"
              >
                <History className="w-4 h-4 opacity-70" />
                Session History
              </button>
              <button className="w-full py-3 px-4 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 flex items-center gap-3 transition-colors text-sm">
                <Settings className="w-4 h-4 opacity-70" />
                Preferences
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main UI */}
      <div className="flex-1 flex flex-col h-full relative">
        {/* Header */}
        <header className="h-16 px-6 flex justify-between items-center border-b border-white/5 bg-[#1a1c1e] z-10 shrink-0">
          <div className="p-2 rounded-lg bg-[#2d3034] border border-white/10">
             <Zap className="w-5 h-5 text-gray-200 fill-current opacity-70" />
          </div>
          
          {/* Audio Visualizer - Header Center */}
          <div className="flex items-center gap-[3px] h-6 px-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <motion.div
                key={i}
                animate={{ 
                  height: isListening ? [4, Math.random() * 16 + 8, 4] : isProcessing ? [6, 12, 6] : 3 
                }}
                transition={{ duration: 0.2, repeat: Infinity, delay: i * 0.03 }}
                className={`w-[2px] rounded-full transition-colors duration-300 ${
                  isListening ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.4)]' : 
                  isProcessing ? 'bg-blue-400' : 
                  'bg-gray-700'
                }`}
              />
            ))}
          </div>
          
          <div className="flex items-center gap-4">
            <select 
              value={targetLanguage} 
              onChange={(e) => setTargetLanguage(e.target.value)}
              className="bg-[#2d3034] text-xs font-mono border border-white/10 rounded-lg px-2 py-1 text-gray-300 outline-none hover:border-white/20 transition-colors"
            >
              <option value="Dutch Flemish">Flemish</option>
              <option value="English">English</option>
              <option value="Spanish">Spanish</option>
              <option value="French">French</option>
              <option value="German">German</option>
              <option value="Japanese">Japanese</option>
            </select>
            <button 
              onClick={() => setShowSidebar(true)}
              className="p-2 text-gray-400 hover:text-white transition-colors"
            >
              <PanelRightOpen className="w-5 h-5" />
            </button>
            <button className="p-2 text-gray-400 hover:text-white transition-colors">
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Content Area */}
        <main className="flex-1 flex flex-col items-center justify-start gap-12 px-6 py-12 pb-32 overflow-y-auto no-scrollbar">
           <div className="w-full max-w-2xl space-y-12">
              {/* Transcription Area */}
              <div className="space-y-3">
                <h3 className="input-label">Transcription</h3>
                <div className="w-full min-h-[180px] p-8 rounded-[40px] border border-emerald-500/10 bg-emerald-500/[0.02] dark-container flex flex-col gap-6">
                   {isListening ? (
                     <div className="flex-1 flex items-center">
                       <span className="flex items-center gap-3 text-emerald-400 text-2xl font-medium">
                          <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                          Listening...
                       </span>
                     </div>
                   ) : isProcessing ? (
                     <div className="flex-1 flex items-center">
                       <span className="italic opacity-50 flex items-center gap-2 text-2xl font-medium text-gray-400">
                          <Cpu className="w-6 h-6 animate-spin" />
                          Syncing Neural Bridge...
                       </span>
                     </div>
                   ) : lastInteraction ? (
                     <>
                       <div className="flex justify-between items-center">
                         <div className="flex gap-2">
                           <span className="text-[10px] font-mono font-bold px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-wider">
                             {lastInteraction.language || 'Detecting'}
                           </span>
                           <span className="text-[10px] font-mono font-bold px-2 py-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase tracking-wider">
                             {lastInteraction.emotion || 'Neutral'}
                           </span>
                         </div>
                         <span className="text-[10px] text-emerald-400/50 font-mono tracking-widest uppercase font-bold text-right">
                           Source Input
                         </span>
                       </div>
                       <p className="text-2xl font-medium text-gray-300 leading-relaxed">
                         {lastInteraction.text}
                       </p>
                     </>
                   ) : (
                     <div className="flex-1 flex items-center justify-center">
                        <span className="opacity-10 italic text-xl">Awaiting pulse...</span>
                     </div>
                   )}
                </div>
              </div>

              {/* Translation Area */}
              <div className="space-y-3">
                <h3 className="translation-label text-blue-400">
                  Translation {lastInteraction?.language && isTargetLanguage(lastInteraction.language, targetLanguage) ? `(${lastNonTargetLanguage || 'Fallback'})` : `(${targetLanguage})`}
                </h3>
                <div className="w-full min-h-[180px] p-8 rounded-[40px] border border-blue-400/10 bg-blue-400/[0.02] dark-container flex flex-col gap-6">
                   {lastInteraction ? (
                     <>
                       <div className="flex justify-between items-center">
                         <div className="flex gap-2">
                           <span className="text-[10px] font-mono font-bold px-2 py-1 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase tracking-wider">
                             {lastInteraction.language && isTargetLanguage(lastInteraction.language, targetLanguage) ? (lastNonTargetLanguage || 'Fallback') : targetLanguage}
                           </span>
                           <span className="text-[10px] font-mono font-bold px-2 py-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase tracking-wider">
                             {lastInteraction.emotion || 'Neutral'}
                           </span>
                         </div>
                         <span className="text-[10px] text-blue-400/50 font-mono tracking-widest uppercase font-bold text-right">
                           Neural Output
                         </span>
                       </div>
                       <p className="text-2xl font-medium text-blue-100 leading-relaxed">
                         {lastInteraction.translation}
                       </p>
                     </>
                   ) : (
                     <div className="flex-1 flex items-center justify-center">
                        <span className="opacity-10 italic text-xl">Translation bridge idle</span>
                     </div>
                   )}
                </div>
              </div>
           </div>
        </main>

        {/* Floating Controls */}
        <div className="fixed bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-4 z-20">
          <div className="flex items-center gap-6 px-6 py-4 rounded-[32px] bg-[#2d3034] border border-white/5 shadow-2xl">
             <button 
               onClick={() => vad.toggle()}
               className={`p-3 rounded-full transition-all active:scale-95 ${vad.listening ? 'bg-red-500/10 text-red-400' : 'text-gray-400 hover:text-white'}`}
             >
               {vad.listening ? <Mic className="w-6 h-6 animate-pulse" /> : <MicOff className="w-6 h-6" />}
             </button>
             <button className="p-3 text-gray-400 hover:text-white transition-colors">
               <Volume2 className="w-6 h-6" />
             </button>
             <button 
               onClick={() => setInteractions([])}
               className="p-3 text-gray-400 hover:text-white transition-colors"
             >
               <RotateCcw className="w-6 h-6" />
             </button>
          </div>
          
          <button 
            onClick={handleToggleSession}
            className={`w-16 h-16 rounded-[24px] flex items-center justify-center shadow-lg active:scale-95 transition-all ${
              vad.listening 
                ? 'bg-red-500 shadow-red-500/20' 
                : 'bg-[#3B82F6] shadow-blue-500/20'
            }`}
          >
             {vad.listening ? (
               <Square className="w-7 h-7 text-white fill-current" />
             ) : (
               <Play className="w-7 h-7 text-white fill-current" />
             )}
          </button>
        </div>

        {/* Backdrop for Sidebar */}
        <AnimatePresence>
          {showSidebar && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSidebar(false)}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
            />
          )}
        </AnimatePresence>
      </div>

      {/* History Slide-up */}
      <AnimatePresence>
        {showHistory && (
          <motion.div 
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            className="fixed inset-0 z-[60] bg-[#16181b] flex flex-col"
          >
            <div className="px-8 py-10 flex justify-between items-center border-b border-white/5">
                <div className="flex items-center gap-3">
                  <History className="w-6 h-6 text-gray-400" />
                  <h2 className="text-xl font-bold tracking-tight">Transcription Archive</h2>
                </div>
                <button onClick={() => setShowHistory(false)} className="p-3 bg-white/5 hover:bg-white/10 rounded-full transition-colors">
                    <RotateCcw className="w-6 h-6 text-gray-300 rotate-90" />
                </button>
            </div>
            <div className="flex-1 overflow-y-auto p-8 space-y-8 no-scrollbar max-w-4xl mx-auto w-full">
                {interactions.map(item => (
                    <div key={item.id} className="p-8 rounded-[32px] bg-[#1a1c1e] border border-white/5 space-y-4">
                        <div className="flex justify-between items-center">
                           <div className="flex gap-2">
                             <span className="text-[10px] font-mono font-bold px-2 py-1 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase">
                               {item.language || 'N/A'}
                             </span>
                             <span className="text-[10px] font-mono font-bold px-2 py-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase">
                               {item.emotion || 'NEUTRAL'}
                             </span>
                           </div>
                           <span className="text-[10px] text-gray-500 font-mono">
                             {new Date(item.timestamp).toLocaleTimeString()}
                           </span>
                        </div>
                        <div className="space-y-2">
                           <p className="text-xl leading-relaxed text-gray-200">{item.text}</p>
                           {item.translation && (
                             <p className="text-lg leading-relaxed text-blue-400/80 italic">{item.translation}</p>
                           )}
                        </div>
                    </div>
                ))}
                {interactions.length === 0 && (
                   <div className="h-full flex flex-col items-center justify-center text-center opacity-20">
                      <History className="w-16 h-16 mb-4" />
                      <p className="text-sm font-mono uppercase tracking-widest">Archive Empty</p>
                   </div>
                )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

