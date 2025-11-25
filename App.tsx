import React, { useState, useEffect } from 'react';
import { COMMUNITIES } from './constants';
import { CommunitySelector } from './components/CommunitySelector';
import { CommunityCard } from './components/CommunityCard';
import { HistorySidebar } from './components/HistorySidebar';
import { generateViralContent } from './services/geminiService';
import { GeneratedPost, HistoryItem } from './types';
import { Sparkles, MessageSquarePlus, Globe, RotateCcw, AlertCircle, TrendingUp, History as HistoryIcon } from 'lucide-react';

const App: React.FC = () => {
  const [keyword, setKeyword] = useState('');
  const [url, setUrl] = useState('');
  const [context, setContext] = useState('');
  const [selectedCommunities, setSelectedCommunities] = useState<string[]>([]);
  const [results, setResults] = useState<GeneratedPost[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // History State
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // Load initial data
  useEffect(() => {
    setSelectedCommunities(['dcinside', 'fmkorea', 'clien', 'instagram']);
    
    // Load history from localStorage
    const savedHistory = localStorage.getItem('viralvibe_history');
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("Failed to load history", e);
      }
    }
  }, []);

  const saveToHistory = () => {
    const newItem: HistoryItem = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      keyword,
      url,
      context,
      selectedCommunities
    };

    const newHistory = [newItem, ...history].slice(0, 50); // Keep max 50 items
    setHistory(newHistory);
    localStorage.setItem('viralvibe_history', JSON.stringify(newHistory));
  };

  const handleRestoreHistory = (item: HistoryItem) => {
    setKeyword(item.keyword);
    setUrl(item.url);
    setContext(item.context);
    setSelectedCommunities(item.selectedCommunities);
    setResults([]); // Clear previous results to avoid confusion
    setError(null);
    setIsHistoryOpen(false);
  };

  const handleDeleteHistory = (id: string) => {
    const newHistory = history.filter(item => item.id !== id);
    setHistory(newHistory);
    localStorage.setItem('viralvibe_history', JSON.stringify(newHistory));
  };

  const handleClearHistory = () => {
    if (window.confirm('모든 기록을 삭제하시겠습니까?')) {
      setHistory([]);
      localStorage.removeItem('viralvibe_history');
    }
  };

  const handleGenerate = async () => {
    if (!keyword.trim()) {
      setError("주제나 키워드를 입력해주세요.");
      return;
    }
    if (selectedCommunities.length === 0) {
      setError("최소 한 개의 커뮤니티를 선택해주세요.");
      return;
    }

    setIsGenerating(true);
    setError(null);
    setResults([]); 

    try {
      const generatedPosts = await generateViralContent({
        keyword,
        url,
        extraContext: context,
        selectedCommunities
      });
      setResults(generatedPosts);
      saveToHistory(); // Save successful generation inputs
    } catch (err: any) {
      setError(err.message || "오류가 발생했습니다.");
    } finally {
      setIsGenerating(false);
    }
  };

  const clearAll = () => {
    setKeyword('');
    setUrl('');
    setContext('');
    setResults([]);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20">
      {/* Navbar */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-gradient-to-tr from-blue-600 to-indigo-600 text-white p-2 rounded-lg">
              <Sparkles size={20} />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-700 to-indigo-700">
              ViralVibe
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm text-slate-500 hidden sm:block font-medium">
              블로그 외부유입 최적화 생성기
            </div>
            <button 
              onClick={() => setIsHistoryOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full text-sm font-semibold transition-colors"
            >
              <HistoryIcon size={16} />
              <span>기록</span>
            </button>
          </div>
        </div>
      </header>

      {/* History Sidebar */}
      <HistorySidebar 
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        history={history}
        onRestore={handleRestoreHistory}
        onDelete={handleDeleteHistory}
        onClearAll={handleClearHistory}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        
        {/* Intro / Instructions */}
        <section className="max-w-3xl mx-auto text-center space-y-4">
          <h2 className="text-3xl font-bold text-slate-900">
            내 블로그 방문자 수를 늘려보세요.
          </h2>
          <p className="text-slate-600 text-lg">
            커뮤니티 성향에 맞춰 자연스럽게 <span className="text-blue-600 font-bold">클릭을 유도하는 홍보글</span>을 작성합니다.
            <br className="hidden md:block"/>
            '낚시성'이 아닌, 호기심을 자극하는 '티저' 전략을 사용합니다.
          </p>
        </section>

        {/* Input Form */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-2">
                  홍보할 주제 / 키워드 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="예: 갤럭시 S24 울트라 사용기, 가성비 오마카세 추천..."
                  className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all shadow-sm"
                />
              </div>
              
              <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                <label className="block text-sm font-bold text-blue-900 mb-2 flex items-center gap-2">
                  <Globe size={16} />
                  유입시킬 블로그/사이트 URL (중요)
                </label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://blog.naver.com/myblog/1234"
                  className="w-full px-4 py-3 rounded-lg border border-blue-200 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-white"
                />
                <p className="text-xs text-blue-600 mt-2">
                  * 각 커뮤니티 말투에 맞춰 자연스럽게 링크 클릭을 유도하도록 작성됩니다.
                </p>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-800 mb-2">
                  추가 강조 사항
                </label>
                <textarea
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  placeholder="예: 결론은 블로그에 있다고 언급해줘, 댓글 반응이 좋았다고 해줘..."
                  className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all h-24 resize-none shadow-sm"
                />
              </div>
            </div>

            <div className="bg-slate-50 rounded-xl p-4 md:p-6 border border-slate-200 flex flex-col max-h-[500px]">
              <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
                <MessageSquarePlus size={18} />
                타겟 커뮤니티 선택
              </h3>
              <div className="overflow-y-auto flex-1 pr-2">
                 <CommunitySelector 
                   selectedIds={selectedCommunities}
                   onChange={setSelectedCommunities}
                 />
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-slate-100 flex flex-col-reverse sm:flex-row justify-end items-center gap-4">
             {error && (
              <div className="flex items-center gap-2 text-red-600 text-sm mr-auto bg-red-50 px-3 py-2 rounded-md font-medium">
                <AlertCircle size={16} />
                {error}
              </div>
            )}
            
            <button
              onClick={clearAll}
              className="px-6 py-3 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 font-medium transition-all flex items-center gap-2"
            >
              <RotateCcw size={18} />
              초기화
            </button>

            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className={`
                px-8 py-3 rounded-lg font-bold text-white shadow-lg shadow-blue-500/30 flex items-center gap-2 text-lg
                transition-all transform active:scale-95
                ${isGenerating 
                  ? 'bg-blue-400 cursor-not-allowed' 
                  : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700'
                }
              `}
            >
              {isGenerating ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  최적화 홍보글 생성 중...
                </>
              ) : (
                <>
                  <TrendingUp size={20} />
                  유입 최적화 글 생성
                </>
              )}
            </button>
          </div>
        </section>

        {/* Results Area */}
        {results.length > 0 && (
          <section className="space-y-6 animate-fade-in-up">
             <div className="flex items-center justify-between">
                <h3 className="text-2xl font-bold text-slate-800">생성된 홍보글</h3>
                <span className="text-sm text-slate-500 bg-white px-3 py-1 rounded-full border border-slate-200 shadow-sm">
                  {results.length}개의 플랫폼용 글
                </span>
             </div>
             
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
               {results.map((post, index) => {
                 const community = COMMUNITIES.find(c => c.id === post.communityId);
                 if (!community) return null;
                 return (
                   <CommunityCard 
                     key={`${post.communityId}-${index}`} 
                     post={post} 
                     community={community} 
                   />
                 );
               })}
             </div>
          </section>
        )}
      </main>
    </div>
  );
};

export default App;