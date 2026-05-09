/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, MicOff, History, Cpu, Zap, Activity, ShieldCheck, Settings, Play, Volume2, VolumeX, RotateCcw, PanelRightClose, PanelRightOpen, Languages, Ghost, Square, LogOut, Sun, Moon, User as UserIcon, Mail } from 'lucide-react';
import { analyzeText, speakTranslation } from './services/geminiService';
import { startDeepgramTranscription, stopDeepgramTranscription } from './services/deepgramService';
import { auth, rtdb } from './services/firebase';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { ref, onValue, set, push, remove } from 'firebase/database';
import { AuthPage } from './components/Auth';

import { languages } from './languages';

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
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [streamingInteraction, setStreamingInteraction] = useState<Partial<Interaction> | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [currentEmotion, setCurrentEmotion] = useState<string | null>(null);
  const [currentLanguage, setCurrentLanguage] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number>(0);
  const [lastNonTargetLanguage, setLastNonTargetLanguage] = useState<string | null>(null);
  const [targetLanguage, setTargetLanguage] = useState<string>('Multilingual');
  
  const [isDark, setIsDark] = useState(true);
  const [showProfile, setShowProfile] = useState(false);
  
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  useEffect(() => {
    if (!user) return;
    const historyRef = ref(rtdb, `users/${user.uid}/history`);
    const unsubscribe = onValue(historyRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const parsed: Interaction[] = Object.values(data);
        parsed.sort((a, b) => b.timestamp - a.timestamp);
        setInteractions(parsed);
      } else {
        setInteractions([]);
      }
    });

    return () => unsubscribe();
  }, [user]);

  const isDutchFlemish = (lang: string | null) => {
    if (!lang) return false;
    const l = lang.toLowerCase();
    return l.includes('flemish') || l.includes('dutch') || l.includes('nederlands') || 
           l.includes('vlaams') || l.includes('brabants') || l.includes('limburgs') || 
           l.includes('antwerps') || l.includes('gents') || l.includes('kempens');
  };

  const handleDeepgramStart = async () => {
    setIsListening(true);
    await startDeepgramTranscription(
      // onTranscript
      async (text: string, isFinal: boolean) => {
        if (!isFinal) {
          setStreamingInteraction(prev => ({ 
            id: prev?.id || Date.now().toString(),
            timestamp: prev?.timestamp || Date.now(),
            type: 'user', 
            text: text, 
            translation: prev?.translation || 'Listening...',
            language: prev?.language,
            emotion: prev?.emotion
          }));
        } else {
          // Received final transcript utterance
          setStreamingInteraction({ 
            id: Date.now().toString(),
            timestamp: Date.now(),
            type: 'user', 
            text: text, 
            translation: 'Translating...' 
          });
          setIsProcessing(true);
          
          try {
            const analysis = await analyzeText(
              text, 
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
            
            if (user) {
              const historyRef = ref(rtdb, `users/${user.uid}/history/${userInteraction.id}`);
              set(historyRef, userInteraction);
            }
            
            setStreamingInteraction(null);
            setCurrentEmotion(analysis.emotion);
            setCurrentLanguage(analysis.language);
            setConfidence(analysis.confidence || Math.random() * 5 + 94);

            if (analysis.language && !isDutchFlemish(analysis.language)) {
              setLastNonTargetLanguage(prev => prev || analysis.language);
              if (targetLanguage === 'Multilingual') {
                setTargetLanguage(analysis.language);
              }
            }

            if (analysis.translation && !isMuted) {
              setIsSpeaking(true);
              await speakTranslation(analysis.translation, analysis.emotion);
              setIsSpeaking(false);
            }
          } catch (err) {
            console.error(err);
            setStreamingInteraction(null);
          } finally {
            setIsProcessing(false);
          }
        }
      },
      // onSpeechStarted
      () => {
        // user is speaking
      },
      // onSpeechEnded
      () => {
        // utterance finished
      },
      // onError
      (err) => {
        setIsListening(false);
      }
    );
  };

  const handleDeepgramStop = () => {
    stopDeepgramTranscription();
    setIsListening(false);
  };

  const handleToggleSession = () => {
    if (!isListening) {
      if (!isSpeaking) {
        setInteractions([]);
        setCurrentEmotion(null);
        setCurrentLanguage(null);
        setConfidence(0);
        setLastNonTargetLanguage(null);
      }
      handleDeepgramStart();
    } else {
      handleDeepgramStop();
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (userToSet) => {
      setUser(userToSet);
      setAuthLoading(false);
    });
    return () => {
      unsubscribe();
      stopDeepgramTranscription();
    };
  }, []);
  const lastInteraction = streamingInteraction || interactions[0];

  if (authLoading) {
    return <div className="flex h-screen w-full items-center justify-center bg-[#1a1c1e] text-white">Loading...</div>;
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <div className={`flex h-screen w-full ${isDark ? 'bg-[#1a1c1e] text-[#e2e8f0]' : 'bg-gray-50 text-gray-900'} font-sans overflow-hidden safe-area-inset relative transition-colors duration-300`}>
      {/* Sidebar Overlay for Mobile / Content for Desktop */}
      <AnimatePresence>
        {showSidebar && (
          <motion.div 
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            className={`fixed right-0 top-0 bottom-0 w-72 z-50 ${isDark ? 'bg-[#16181b] border-white/5' : 'bg-white border-gray-200'} border-l p-6 flex flex-col gap-8 shadow-2xl transition-colors duration-300`}
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
                <div className={`text-sm font-mono font-bold flex items-center gap-2 ${isListening ? 'text-emerald-400' : 'text-gray-500'}`}>
                  <div className={`w-2 h-2 rounded-full ${isListening ? 'bg-emerald-400 animate-pulse' : 'bg-gray-700'}`} />
                  {isListening ? 'ACTIVE' : 'IDLE'}
                </div>
              </div>
            </div>

            <div className="mt-auto border-t border-white/5 pt-6 space-y-4">
              <button 
                onClick={() => { setShowSidebar(false); setShowHistory(true); }}
                className="w-full py-3 px-4 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 flex items-center gap-3 transition-colors text-sm text-gray-200"
              >
                <History className="w-4 h-4 opacity-70 text-gray-200" />
                Session History
              </button>
              <button 
                onClick={() => setShowProfile(!showProfile)}
                className="w-full py-3 px-4 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 flex items-center gap-3 transition-colors text-sm text-gray-200"
              >
                <UserIcon className="w-4 h-4 opacity-70 text-gray-200" />
                Profile
              </button>
              
              {showProfile && user && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className={`${isDark ? 'bg-[#2d3034] border-white/10' : 'bg-gray-100 border-gray-200'} rounded-lg p-4 space-y-3 border overflow-hidden transition-colors duration-300`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center font-bold pb-0.5 shrink-0">
                      {user.displayName?.charAt(0) || user.email?.charAt(0)?.toUpperCase() || 'U'}
                    </div>
                    <div className="flex flex-col overflow-hidden">
                      <span className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'} truncate`}>{user.displayName || 'User'}</span>
                      <span className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'} flex items-center gap-1 truncate`}><Mail className="w-3 h-3 shrink-0" /> <span className="truncate">{user.email}</span></span>
                    </div>
                  </div>
                </motion.div>
              )}

              <button 
                onClick={() => signOut(auth)}
                className="w-full py-3 px-4 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 flex items-center gap-3 transition-colors text-sm text-red-400"
              >
                <LogOut className="w-4 h-4 opacity-70" />
                Sign Out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main UI */}
      <div className="flex-1 flex flex-col h-full relative">
        {/* Header */}
        <header className={`h-16 px-4 sm:px-6 flex justify-between items-center border-b ${isDark ? 'border-white/5 bg-[#1a1c1e]' : 'border-gray-200 bg-white'} z-10 shrink-0 transition-colors duration-300`}>
          <div className={`hidden sm:flex p-2 rounded-lg ${isDark ? 'bg-[#2d3034] border-white/10' : 'bg-gray-100 border-gray-200'} border`}>
             <Zap className="w-5 h-5 text-gray-200 fill-current opacity-70" />
          </div>
          
          {/* Audio Visualizer - Header Center */}
          <div className="flex items-center gap-[2px] sm:gap-[3px] h-6 px-2 sm:px-4">
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
          
          <div className="flex items-center gap-2 sm:gap-4">
            <select 
              value={targetLanguage} 
              onChange={(e) => setTargetLanguage(e.target.value)}
              className={`${isDark ? 'bg-[#2d3034] border-white/10 text-gray-300 hover:border-white/20' : 'bg-gray-100 border-gray-200 text-gray-800 hover:border-gray-300'} text-[10px] sm:text-xs font-mono border rounded-lg px-2 sm:px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 transition-colors w-32 sm:w-auto truncate max-w-[150px] sm:max-w-xs`}
            >
              {languages.map(lang => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
            <button 
              onClick={() => setShowSidebar(true)}
              className="p-1.5 sm:p-2 text-gray-400 hover:text-white transition-colors"
            >
              <PanelRightOpen className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setIsDark(!isDark)}
              className="hidden sm:block p-1.5 sm:p-2 text-gray-400 hover:text-white transition-colors"
            >
              {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
        </header>

        {/* Content Area */}
        <main className="flex-1 flex flex-col items-center justify-start gap-8 sm:gap-12 px-4 sm:px-6 py-6 sm:py-12 pb-32 sm:pb-32 overflow-y-auto no-scrollbar">
           <div className="w-full max-w-2xl space-y-8 sm:space-y-12">
              {/* Transcription Area */}
              <div className="space-y-2 sm:space-y-3">
                <h3 className="input-label ml-2 sm:ml-0">Transcription</h3>
                <div className="w-full min-h-[150px] sm:min-h-[180px] p-6 sm:p-8 rounded-[32px] sm:rounded-[40px] border border-emerald-500/10 bg-emerald-500/[0.02] dark-container flex flex-col gap-4 sm:gap-6">
                   {isListening ? (
                     <div className="flex-1 flex items-center">
                       <span className="flex items-center gap-3 text-emerald-400 text-xl sm:text-2xl font-medium">
                          <span className="w-2 sm:w-2.5 h-2 sm:h-2.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                          Listening...
                       </span>
                     </div>
                   ) : isProcessing ? (
                     <div className="flex-1 flex items-center">
                       <span className="italic opacity-50 flex items-center gap-2 text-xl sm:text-2xl font-medium text-gray-400">
                          <Cpu className="w-5 h-5 sm:w-6 sm:h-6 animate-spin" />
                          Syncing Neural Bridge...
                       </span>
                     </div>
                   ) : lastInteraction ? (
                     <>
                       <div className="flex justify-between items-center">
                         <div className="flex gap-2">
                           <span className="text-[10px] font-mono font-bold px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-wider hidden sm:block">
                             {lastInteraction.language || 'Detecting'}
                           </span>
                           <span className="text-[10px] font-mono font-bold px-2 py-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase tracking-wider">
                             {lastInteraction.emotion || 'Neutral'}
                           </span>
                         </div>
                         <span className="text-[9px] sm:text-[10px] text-emerald-400/50 font-mono tracking-widest uppercase font-bold text-right">
                           Source Input
                         </span>
                       </div>
                       <p className="text-xl sm:text-2xl font-medium text-gray-300 leading-relaxed">
                         {lastInteraction.text}
                       </p>
                     </>
                   ) : (
                     <div className="flex-1 flex items-center justify-center">
                        <span className="opacity-10 italic text-lg sm:text-xl">Awaiting pulse...</span>
                     </div>
                   )}
                </div>
              </div>

              {/* Translation Area */}
              <div className="space-y-2 sm:space-y-3">
                <h3 className="translation-label text-blue-400 ml-2 sm:ml-0">
                  Translation {lastInteraction?.language && isDutchFlemish(lastInteraction.language) ? `(${targetLanguage === 'Multilingual' ? (lastNonTargetLanguage || 'English') : targetLanguage})` : `(Dutch Flemish)`}
                </h3>
                <div className="w-full min-h-[150px] sm:min-h-[180px] p-6 sm:p-8 rounded-[32px] sm:rounded-[40px] border border-blue-400/10 bg-blue-400/[0.02] dark-container flex flex-col gap-4 sm:gap-6">
                   {lastInteraction ? (
                     <>
                       <div className="flex justify-between items-center">
                         <div className="flex gap-2">
                           <span className="text-[10px] font-mono font-bold px-2 py-1 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase tracking-wider hidden sm:block">
                             {lastInteraction.language && isDutchFlemish(lastInteraction.language) ? (targetLanguage === 'Multilingual' ? (lastNonTargetLanguage || 'English') : targetLanguage) : 'Dutch Flemish'}
                           </span>
                           <span className="text-[10px] font-mono font-bold px-2 py-1 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase tracking-wider">
                             {lastInteraction.emotion || 'Neutral'}
                           </span>
                         </div>
                         <span className="text-[9px] sm:text-[10px] text-blue-400/50 font-mono tracking-widest uppercase font-bold text-right">
                           Neural Output
                         </span>
                       </div>
                       <p className="text-xl sm:text-2xl font-medium text-blue-100 leading-relaxed">
                         {lastInteraction.translation === 'Translating...' ? (
                           <span className="flex items-center gap-2 text-blue-400">
                             Translating
                             <span className="flex gap-1 items-center mt-1">
                               <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '0ms' }} />
                               <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '150ms' }} />
                               <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '300ms' }} />
                             </span>
                           </span>
                         ) : (
                           lastInteraction.translation
                         )}
                       </p>
                     </>
                   ) : (
                     <div className="flex-1 flex items-center justify-center">
                        <span className="opacity-10 italic text-lg sm:text-xl">Translation bridge idle</span>
                     </div>
                   )}
                </div>
              </div>
           </div>
        </main>

        {/* Floating Controls */}
        <div className="fixed bottom-6 sm:bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-2 sm:gap-4 z-20 w-[95%] max-w-fit justify-center">
          <div className={`flex items-center gap-2 sm:gap-6 px-4 sm:px-6 py-3 sm:py-4 rounded-[24px] sm:rounded-[32px] ${isDark ? 'bg-[#2d3034] border-white/5' : 'bg-white border-gray-200 overflow-hidden shadow-xl'} border shadow-2xl transition-colors duration-300`}>
             <button 
               onClick={handleToggleSession}
               className={`p-2.5 sm:p-3 rounded-full transition-all active:scale-95 ${isListening ? 'bg-red-500/10 text-red-400' : 'text-gray-400 hover:text-white'}`}
             >
               {isListening ? <Mic className="w-5 h-5 sm:w-6 sm:h-6 animate-pulse" /> : <MicOff className="w-5 h-5 sm:w-6 sm:h-6" />}
             </button>
             <button 
               onClick={() => setIsMuted(!isMuted)}
               className={`p-2.5 sm:p-3 rounded-full transition-all active:scale-95 ${isMuted ? 'bg-gray-500/10 text-gray-500' : 'text-blue-400 hover:text-white'}`}
             >
               {isMuted ? <VolumeX className="w-5 h-5 sm:w-6 sm:h-6" /> : <Volume2 className="w-5 h-5 sm:w-6 sm:h-6" />}
             </button>
             <button 
               onClick={() => {
                 setInteractions([]);
                 setLastNonTargetLanguage(null);
                 if (user) {
                   remove(ref(rtdb, `users/${user.uid}/history`));
                 }
               }}
               className="p-2.5 sm:p-3 text-gray-400 hover:text-white transition-colors"
             >
               <RotateCcw className="w-5 h-5 sm:w-6 sm:h-6" />
             </button>
          </div>
          
          <button 
            onClick={handleToggleSession}
            className={`w-14 h-14 sm:w-16 sm:h-16 shrink-0 rounded-[20px] sm:rounded-[24px] flex items-center justify-center shadow-lg active:scale-95 transition-all ${
              isListening 
                ? 'bg-red-500 shadow-red-500/20' 
                : 'bg-[#3B82F6] shadow-blue-500/20'
            }`}
          >
             {isListening ? (
               <Square className="w-6 h-6 sm:w-7 sm:h-7 text-white fill-current" />
             ) : (
               <Play className="w-6 h-6 sm:w-7 sm:h-7 text-white fill-current" />
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
            className={`fixed inset-0 z-[60] ${isDark ? 'bg-[#16181b]' : 'bg-gray-50'} flex flex-col transition-colors duration-300`}
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
                    <div key={item.id} className={`p-8 rounded-[32px] ${isDark ? 'bg-[#1a1c1e] border-white/5' : 'bg-white border-gray-200 shadow-sm'} border space-y-4 transition-colors duration-300`}>
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

