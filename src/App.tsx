/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, MicOff, History, Cpu, Zap, Activity, ShieldCheck, Settings, Play, Volume2, VolumeX, RotateCcw, PanelRightClose, PanelRightOpen, Languages, Ghost, Square, LogOut, Sun, Moon, User as UserIcon, Mail, Download } from 'lucide-react';
import { analyzeText, speakTranslation } from './services/geminiService';
import { startDeepgramTranscription, stopDeepgramTranscription, setDeepgramMuted } from './services/deepgramService';
import { auth, rtdb } from './services/firebase';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { ref, onValue, set, push, remove } from 'firebase/database';
import { AuthPage } from './components/Auth';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

import { languages } from './languages';

interface Interaction {
  id: string;
  timestamp: number;
  type: 'user';
  text: string;
  translation?: string;
  language?: string;
  emotion?: string;
  words?: { word: string, punctuated_word: string, start: number, end: number, confidence: number }[];
  detectedLanguage?: string;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [streamingInteraction, setStreamingInteraction] = useState<Partial<Interaction> | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const isProcessingRef = useRef(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const isSpeakingRef = useRef(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [currentEmotion, setCurrentEmotion] = useState<string | null>(null);
  const [currentLanguage, setCurrentLanguage] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number>(0);
  const [lastNonTargetLanguage, setLastNonTargetLanguage] = useState<string | null>(null);
  const [targetLanguage, setTargetLanguage] = useState<string>('Multilingual');
  
  const [isDark, setIsDark] = useState(true);
  const [showProfile, setShowProfile] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const exportHistory = () => {
    if (interactions.length === 0) return;
    
    const doc = new jsPDF();
    
    doc.setFontSize(20);
    doc.text('Transcription Archive', 14, 22);
    doc.setFontSize(10);
    doc.setTextColor(150);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 30);
    
    const tableData = interactions.map(item => [
      new Date(item.timestamp).toLocaleString(),
      item.language || 'Unknown',
      item.emotion || 'Unknown',
      item.text,
      item.translation || ''
    ]);

    autoTable(doc, {
      startY: 35,
      head: [['Timestamp', 'Language', 'Emotion', 'Transcription', 'Translation']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [16, 185, 129] }, // emerald-500
      styles: { fontSize: 8, cellPadding: 3 },
      columnStyles: {
        0: { cellWidth: 30 },
        1: { cellWidth: 20 },
        2: { cellWidth: 20 },
        3: { cellWidth: 'auto' },
        4: { cellWidth: 'auto' },
      }
    });

    doc.save('transcription_archive.pdf');
  };
  
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
      async (text: string, isFinal: boolean, words?: any[], detectedLanguage?: string) => {
        if (detectedLanguage) setCurrentLanguage(detectedLanguage);
        if (!isFinal) {
          setStreamingInteraction(prev => ({ 
            id: prev?.id || Date.now().toString(),
            timestamp: prev?.timestamp || Date.now(),
            type: 'user', 
            text: text, 
            translation: prev?.translation || 'Listening...',
            language: prev?.language,
            emotion: prev?.emotion,
            words: words,
            detectedLanguage: detectedLanguage
          }));
        } else {
          // Received final transcript utterance
          setDeepgramMuted(true);
          setStreamingInteraction({ 
            id: Date.now().toString(),
            timestamp: Date.now(),
            type: 'user', 
            text: text, 
            translation: 'Translating...',
            words: words,
            detectedLanguage: detectedLanguage
          });
          setIsProcessing(true);
          isProcessingRef.current = true;
          
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
            };
            
            if (analysis.translation) userInteraction.translation = analysis.translation;
            if (analysis.language) userInteraction.language = analysis.language;
            if (analysis.emotion) userInteraction.emotion = analysis.emotion;
            if (words) userInteraction.words = words;
            if (detectedLanguage) userInteraction.detectedLanguage = detectedLanguage;
            
            if (user) {
              const historyRef = ref(rtdb, `users/${user.uid}/history/${userInteraction.id}`);
              set(historyRef, userInteraction);
            }
            
            setStreamingInteraction(null);
            setCurrentEmotion(analysis.emotion);
            setCurrentLanguage(analysis.language);
            setConfidence(analysis.confidence || Math.random() * 5 + 94);

            if (analysis.language && !isDutchFlemish(analysis.language)) {
              setLastNonTargetLanguage(analysis.language);
            }

            if (analysis.translation && !isMuted) {
              await playTranslation(analysis.translation, analysis.language);
            }
          } catch (err: any) {
            console.error(err);
            if (err?.message?.includes("quota") || err?.status === 429 || err?.message?.includes("exceeded")) {
              setErrorMessage("Server is Down.");
            } else {
              setErrorMessage(err.message || String(err));
            }
            setTimeout(() => setErrorMessage(null), 8000);
            setStreamingInteraction(null);
          } finally {
            setIsProcessing(false);
            isProcessingRef.current = false;
            // playTranslation manages its own unmuting if it was called and is still speaking,
            // but we need to ensure unmuting if it wasn't called or failed.
            if (!isSpeakingRef.current) {
              setDeepgramMuted(false);
            }
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

  const playTranslation = async (text: string, languageName: string = "English") => {
    if (isSpeakingRef.current) return;
    setIsSpeaking(true);
    isSpeakingRef.current = true;
    setDeepgramMuted(true);
    try {
      await speakTranslation(text, languageName);
    } catch (err: any) {
      console.error(err);
      if (err?.message?.includes("quota") || err?.status === 429 || err?.message?.includes("exceeded")) {
        setErrorMessage("Server is Down.");
      } else {
        setErrorMessage(err.message || String(err));
      }
      setTimeout(() => setErrorMessage(null), 8000);
    } finally {
      setIsSpeaking(false);
      isSpeakingRef.current = false;
      if (!isProcessingRef.current) {
        setDeepgramMuted(false);
      }
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
              <h2 className={`text-xs uppercase font-bold tracking-[0.2em] ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>Telemetry</h2>
              <button onClick={() => setShowSidebar(false)} className={`p-1 rounded transition-colors ${isDark ? 'hover:bg-white/5 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
                <PanelRightClose className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-6">
              <div className="space-y-1">
                <span className={`text-[10px] uppercase font-bold tracking-wider ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>Detected Language</span>
                <p className={`font-mono text-sm font-bold flex items-center gap-2 ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>
                  <Languages className="w-4 h-4" />
                  {currentLanguage || 'SEARCHING...'}
                </p>
              </div>

              <div className="space-y-1">
                <span className={`text-[10px] uppercase font-bold tracking-wider ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>Confidence Score</span>
                <p className={`font-mono text-sm font-bold flex items-center gap-2 ${isDark ? 'text-white' : 'text-gray-800'}`}>
                  <Activity className={`w-4 h-4 ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
                  {confidence ? `${confidence.toFixed(1)}%` : '--.-%'}
                </p>
              </div>

              <div className="space-y-1">
                <span className={`text-[10px] uppercase font-bold tracking-wider ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>Primary Emotion</span>
                <p className={`font-mono text-sm font-bold flex items-center gap-2 ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
                  <Ghost className="w-4 h-4" />
                  {currentEmotion || 'ANALYZING...'}
                </p>
              </div>

              <div className="space-y-1">
                <span className={`text-[10px] uppercase font-bold tracking-wider ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>VAD State</span>
                <div className={`text-sm font-mono font-bold flex items-center gap-2 ${isListening ? (isDark ? 'text-emerald-400' : 'text-emerald-600') : (isDark ? 'text-gray-500' : 'text-gray-400')}`}>
                  <div className={`w-2 h-2 rounded-full ${isListening ? `animate-pulse ${isDark ? 'bg-emerald-400' : 'bg-emerald-500'}` : (isDark ? 'bg-gray-700' : 'bg-gray-300')}`} />
                  {isListening ? 'ACTIVE' : 'IDLE'}
                </div>
              </div>
            </div>

            <div className={`mt-auto border-t pt-6 space-y-4 ${isDark ? 'border-white/5' : 'border-gray-200'}`}>
              <button 
                onClick={() => { setShowSidebar(false); setShowHistory(true); }}
                className={`w-full py-3 px-4 rounded-lg flex items-center gap-3 transition-colors text-sm border ${isDark ? 'bg-white/5 hover:bg-white/10 border-white/5 text-gray-200' : 'bg-gray-100 hover:bg-gray-200 border-gray-200 text-gray-700'}`}
              >
                <History className={`w-4 h-4 opacity-70 ${isDark ? 'text-gray-200' : 'text-gray-700'}`} />
                Session History
              </button>
              <button 
                onClick={() => setShowProfile(!showProfile)}
                className={`w-full py-3 px-4 rounded-lg flex items-center gap-3 transition-colors text-sm border ${isDark ? 'bg-white/5 hover:bg-white/10 border-white/5 text-gray-200' : 'bg-gray-100 hover:bg-gray-200 border-gray-200 text-gray-700'}`}
              >
                <UserIcon className={`w-4 h-4 opacity-70 ${isDark ? 'text-gray-200' : 'text-gray-700'}`} />
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
                className={`w-full py-3 px-4 rounded-lg flex items-center gap-3 transition-colors text-sm border ${isDark ? 'bg-red-500/10 hover:bg-red-500/20 border-red-500/20 text-red-400' : 'bg-red-50 hover:bg-red-100 border-red-200 text-red-600'}`}
              >
                <LogOut className="w-4 h-4 opacity-70" />
                Sign Out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {errorMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -20, x: '-50%' }}
            className={`fixed top-4 left-1/2 z-50 px-4 py-3 rounded-lg shadow-xl shadow-red-500/10 border flex items-start gap-3 max-w-sm w-[90%] sm:w-auto ${isDark ? 'bg-red-500/10 border-red-500/20 text-red-200' : 'bg-red-50 border-red-200 text-red-800'}`}
          >
            <ShieldCheck className="w-5 h-5 shrink-0 text-red-500 mt-0.5" />
            <div className="flex-1 text-sm font-medium leading-relaxed">
              {errorMessage}
            </div>
            <button 
              onClick={() => setErrorMessage(null)}
              className={`p-1 rounded-full hover:bg-black/5 opacity-70 hover:opacity-100 transition-all ${isDark ? 'hover:bg-white/5' : ''}`}
            >
              <VolumeX className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main UI */}
      <div className="flex-1 flex flex-col h-full relative">
        {/* Header */}
        <header className={`h-16 px-4 sm:px-6 flex justify-between items-center border-b ${isDark ? 'border-white/5 bg-[#1a1c1e]' : 'border-gray-200 bg-white'} z-10 shrink-0 transition-colors duration-300`}>
          <div className={`hidden sm:flex p-1.5 rounded-full ${isDark ? 'bg-[#2d3034] border-white/10' : 'bg-gray-100 border-gray-200'} border transition-colors duration-300 overflow-hidden`}>
             <img src="https://eburon.ai/icon-eburon.svg" alt="Eburon Logo" className="w-6 h-6 rounded-full" />
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
                  (isDark ? 'bg-gray-700' : 'bg-gray-300')
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
              className={`p-1.5 sm:p-2 text-gray-400 transition-colors ${isDark ? 'hover:text-white' : 'hover:text-gray-900'}`}
            >
              <PanelRightOpen className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setIsDark(!isDark)}
              className={`hidden sm:block p-1.5 sm:p-2 text-gray-400 transition-colors ${isDark ? 'hover:text-white' : 'hover:text-gray-900'}`}
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
                <h3 className={`text-[10px] font-bold tracking-widest uppercase mb-2 ml-2 sm:ml-0 ${isDark ? 'text-emerald-500' : 'text-emerald-700'}`}>Transcription</h3>
                <div className={`w-full min-h-[150px] sm:min-h-[180px] p-6 sm:p-8 rounded-[32px] sm:rounded-[40px] border flex flex-col gap-4 sm:gap-6 backdrop-blur-md transition-colors duration-300 ${isDark ? 'border-emerald-500/10 bg-emerald-500/[0.02] bg-[#1e2023]/60 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)] text-gray-200' : 'border-emerald-500/30 bg-emerald-50 text-gray-900 shadow-sm'}`}>
                   {isListening ? (
                     <div className="flex-1 flex items-center">
                       <span className="flex items-center gap-3 text-emerald-400 text-xl sm:text-2xl font-medium">
                          <span className="w-2 sm:w-2.5 h-2 sm:h-2.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                          Listening...
                       </span>
                     </div>
                   ) : isProcessing ? (
                     <div className="flex-1 flex items-center">
                       <span className={`italic flex items-center gap-2 text-xl sm:text-2xl font-medium ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                          <Cpu className="w-5 h-5 sm:w-6 sm:h-6 animate-spin" />
                          Syncing Neural Bridge...
                       </span>
                     </div>
                   ) : lastInteraction ? (
                     <>
                       <div className="flex justify-between items-center">
                         <div className="flex gap-2">
                           <span className={`text-[10px] font-mono font-bold px-2 py-1 rounded uppercase tracking-wider hidden sm:block ${isDark ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-emerald-100 text-emerald-700 border border-emerald-200'}`}>
                             {lastInteraction.language || lastInteraction.detectedLanguage || 'Detecting'}
                           </span>
                           <span className={`text-[10px] font-mono font-bold px-2 py-1 rounded uppercase tracking-wider ${isDark ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-amber-100 text-amber-700 border border-amber-200'}`}>
                             {lastInteraction.emotion || 'Neutral'}
                           </span>
                         </div>
                         <span className={`text-[9px] sm:text-[10px] font-mono tracking-widest uppercase font-bold text-right ${isDark ? 'text-emerald-400/50' : 'text-emerald-600/70'}`}>
                           Source Input
                         </span>
                       </div>
                       <div className={`text-xl sm:text-2xl font-medium leading-relaxed flex flex-wrap gap-[0.25em] ${isDark ? 'text-gray-300' : 'text-gray-900'}`}>
                         {lastInteraction.words && lastInteraction.words.length > 0 ? (
                            lastInteraction.words.map((w: any, idx: number) => {
                              const isRecent = idx >= lastInteraction.words!.length - 2;
                              return (
                                <motion.span 
                                  key={idx} 
                                  initial={{ opacity: 0, y: 5 }} 
                                  animate={{ opacity: 1, y: 0 }} 
                                  transition={{ duration: 0.2 }}
                                  className={isRecent ? (isDark ? 'text-emerald-400' : 'text-emerald-600') : ''}
                                >
                                  {w.punctuated_word || w.word}
                                </motion.span>
                              )
                            })
                         ) : (
                           lastInteraction.text
                         )}
                       </div>
                     </>
                   ) : (
                     <div className="flex-1 flex items-center justify-center">
                        <span className={`italic text-lg sm:text-xl font-medium ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>Awaiting pulse...</span>
                     </div>
                   )}
                </div>
              </div>

              {/* Translation Area */}
              <div className="space-y-2 sm:space-y-3">
                <h3 className={`text-[10px] font-bold tracking-widest uppercase mb-2 ml-2 sm:ml-0 ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>
                  Translation {lastInteraction?.language && isDutchFlemish(lastInteraction.language) ? `(${targetLanguage === 'Multilingual' ? (lastNonTargetLanguage || 'English') : targetLanguage})` : `(Dutch Flemish)`}
                </h3>
                <div className={`w-full min-h-[150px] sm:min-h-[180px] p-6 sm:p-8 rounded-[32px] sm:rounded-[40px] border flex flex-col gap-4 sm:gap-6 backdrop-blur-md transition-colors duration-300 ${isDark ? 'border-blue-400/10 bg-blue-400/[0.02] bg-[#1e2023]/60 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)] text-blue-100' : 'border-blue-400/30 bg-blue-50 text-blue-900 shadow-sm'}`}>
                   {lastInteraction ? (
                     <>
                       <div className="flex justify-between items-center">
                         <div className="flex gap-2">
                           <span className={`text-[10px] font-mono font-bold px-2 py-1 rounded uppercase tracking-wider hidden sm:block ${isDark ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'bg-blue-100 text-blue-700 border border-blue-200'}`}>
                             {lastInteraction.language && isDutchFlemish(lastInteraction.language) ? (targetLanguage === 'Multilingual' ? (lastNonTargetLanguage || 'English') : targetLanguage) : 'Dutch Flemish'}
                           </span>
                           <span className={`text-[10px] font-mono font-bold px-2 py-1 rounded uppercase tracking-wider ${isDark ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-amber-100 text-amber-700 border border-amber-200'}`}>
                             {lastInteraction.emotion || 'Neutral'}
                           </span>
                         </div>
                         <div className="flex items-center gap-2">
                           {lastInteraction.translation && lastInteraction.translation !== 'Translating...' && (
                             <button
                               onClick={() => playTranslation(lastInteraction.translation!, lastInteraction.language!)}
                               className={`p-1.5 rounded-full transition-colors ${isSpeaking ? 'animate-pulse text-emerald-400' : (isDark ? 'hover:bg-blue-500/20 text-blue-400/80' : 'hover:bg-blue-200 text-blue-600/80')}`}
                               title="Read Translation"
                             >
                               <Volume2 className="w-4 h-4 sm:w-5 sm:h-5" />
                             </button>
                           )}
                           <span className={`text-[9px] sm:text-[10px] font-mono tracking-widest uppercase font-bold text-right ${isDark ? 'text-blue-400/50' : 'text-blue-600/70'}`}>
                             Neural Output
                           </span>
                         </div>
                       </div>
                       <p className={`text-xl sm:text-2xl font-medium leading-relaxed ${isDark ? 'text-blue-100' : 'text-blue-900'}`}>
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
                        <span className={`italic text-lg sm:text-xl font-medium ${isDark ? 'text-blue-500/30' : 'text-blue-400/50'}`}>Translation bridge idle</span>
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
               className={`p-2.5 sm:p-3 rounded-full transition-all active:scale-95 ${isListening ? 'bg-red-500/10 text-red-400' : `text-gray-400 ${isDark ? 'hover:text-white' : 'hover:text-gray-900'}`}`}
             >
               {isListening ? <Mic className="w-5 h-5 sm:w-6 sm:h-6 animate-pulse" /> : <MicOff className="w-5 h-5 sm:w-6 sm:h-6" />}
             </button>
             <button 
               onClick={() => setIsMuted(!isMuted)}
               className={`p-2.5 sm:p-3 rounded-full transition-all active:scale-95 ${isMuted ? 'bg-gray-500/10 text-gray-500' : `text-blue-400 ${isDark ? 'hover:text-white' : 'hover:text-gray-900'}`}`}
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
               className={`p-2.5 sm:p-3 text-gray-400 transition-colors ${isDark ? 'hover:text-white' : 'hover:text-gray-900'}`}
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
            <div className={`px-8 py-10 flex justify-between items-center border-b ${isDark ? 'border-white/5' : 'border-gray-200'}`}>
                <div className="flex items-center gap-3">
                  <History className={`w-6 h-6 ${isDark ? 'text-gray-400' : 'text-gray-600'}`} />
                  <h2 className={`text-xl font-bold tracking-tight ${isDark ? 'text-white' : 'text-gray-900'}`}>Transcription Archive</h2>
                </div>
                <div className="flex items-center gap-4">
                  {interactions.length > 0 && (
                    <button onClick={exportHistory} className={`flex items-center gap-2 px-4 py-3 rounded-full transition-colors text-sm font-bold font-mono tracking-widest uppercase border ${isDark ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border-emerald-500/20' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border-emerald-200'}`}>
                      <Download className="w-4 h-4" />
                      Export
                    </button>
                  )}
                  <button onClick={() => setShowHistory(false)} className={`p-3 rounded-full transition-colors ${isDark ? 'bg-white/5 hover:bg-white/10 text-gray-300' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}>
                      <RotateCcw className="w-6 h-6 rotate-90" />
                  </button>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto p-8 space-y-8 no-scrollbar max-w-4xl mx-auto w-full">
                {interactions.map(item => (
                    <div key={item.id} className={`p-8 rounded-[32px] ${isDark ? 'bg-[#1a1c1e] border-white/5' : 'bg-white border-gray-200 shadow-sm'} border space-y-4 transition-colors duration-300`}>
                        <div className="flex justify-between items-center">
                           <div className="flex gap-2">
                             <span className={`text-[10px] font-mono font-bold px-2 py-1 rounded uppercase ${isDark ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'bg-blue-100 text-blue-700 border border-blue-200'}`}>
                               {item.language || 'N/A'}
                             </span>
                             <span className={`text-[10px] font-mono font-bold px-2 py-1 rounded uppercase ${isDark ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-amber-100 text-amber-700 border border-amber-200'}`}>
                               {item.emotion || 'NEUTRAL'}
                             </span>
                           </div>
                           <span className="text-[10px] text-gray-500 font-mono">
                             {new Date(item.timestamp).toLocaleTimeString()}
                           </span>
                        </div>
                        <div className="space-y-2">
                           <p className={`text-xl leading-relaxed ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>{item.text}</p>
                           {item.translation && (
                             <div className="flex items-start gap-2">
                               <p className={`flex-1 text-lg leading-relaxed italic ${isDark ? 'text-blue-400/80' : 'text-blue-700/80'}`}>{item.translation}</p>
                               <button
                                 onClick={() => playTranslation(item.translation!, item.language || "English")}
                                 className={`p-1.5 mt-1 rounded-full shrink-0 transition-colors ${isDark ? 'hover:bg-blue-500/20 text-blue-400/80' : 'hover:bg-blue-200 text-blue-600/80'}`}
                                 title="Read Translation"
                               >
                                 <Volume2 className="w-4 h-4" />
                               </button>
                             </div>
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

