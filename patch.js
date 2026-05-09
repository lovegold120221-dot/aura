const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

content = content.replace(
  '                         <span className={`text-[9px] sm:text-[10px] font-mono tracking-widest uppercase font-bold text-right ${isDark ? \'text-blue-400/50\' : \'text-blue-600/70\'}`}>',
  `                         <div className="flex items-center gap-2">
                           {lastInteraction.translation && lastInteraction.translation !== 'Translating...' && (
                             <button
                               onClick={() => speakTranslation(lastInteraction.translation!, lastInteraction.emotion)}
                               className={\`p-1.5 rounded-full transition-colors \${isSpeaking ? 'animate-pulse text-emerald-400' : (isDark ? 'hover:bg-blue-500/20 text-blue-400/80' : 'hover:bg-blue-200 text-blue-600/80')}\`}
                               title="Read Translation"
                             >
                               <Volume2 className="w-4 h-4 sm:w-5 sm:h-5" />
                             </button>
                           )}
                           <span className={\`text-[9px] sm:text-[10px] font-mono tracking-widest uppercase font-bold text-right \${isDark ? 'text-blue-400/50' : 'text-blue-600/70'}\`}>`
).replace(
  '                         </span>\n                       </div>',
  '                         </span>\n                         </div>\n                       </div>'
);

content = content.replace(
  '                           {item.translation && (\n                             <p className={`text-lg leading-relaxed italic ${isDark ? \'text-blue-400/80\' : \'text-blue-700/80\'}`}>{item.translation}</p>\n                           )}',
  `                           {item.translation && (
                             <div className="flex items-start gap-2">
                               <p className={\`flex-1 text-lg leading-relaxed italic \${isDark ? 'text-blue-400/80' : 'text-blue-700/80'}\`}>{item.translation}</p>
                               <button
                                 onClick={() => speakTranslation(item.translation!, item.emotion)}
                                 className={\`p-1.5 mt-1 rounded-full shrink-0 transition-colors \${isDark ? 'hover:bg-blue-500/20 text-blue-400/80' : 'hover:bg-blue-200 text-blue-600/80'}\`}
                                 title="Read Translation"
                               >
                                 <Volume2 className="w-4 h-4" />
                               </button>
                             </div>
                           )}`
);

fs.writeFileSync('src/App.tsx', content);
