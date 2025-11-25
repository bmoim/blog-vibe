import React from 'react';
import { X, Trash2, Clock, RotateCcw, FileSpreadsheet } from 'lucide-react';
import { HistoryItem } from '../types';
import * as XLSX from 'xlsx';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  history: HistoryItem[];
  onRestore: (item: HistoryItem) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
}

export const HistorySidebar: React.FC<Props> = ({ 
  isOpen, 
  onClose, 
  history, 
  onRestore, 
  onDelete,
  onClearAll 
}) => {
  const formatDate = (timestamp: number) => {
    return new Intl.DateTimeFormat('ko-KR', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  };

  const handleExportExcel = () => {
    if (history.length === 0) return;

    const excelData = history.map(item => ({
      '일시': new Date(item.timestamp).toLocaleString('ko-KR'),
      '키워드': item.keyword,
      'URL': item.url,
      '추가사항': item.context,
      '선택된 커뮤니티': item.selectedCommunities.join(', ')
    }));

    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "History");
    
    // Column widths
    const wscols = [
      { wch: 22 }, // Date
      { wch: 20 }, // Keyword
      { wch: 40 }, // URL
      { wch: 30 }, // Context
      { wch: 40 }, // Communities
    ];
    ws['!cols'] = wscols;

    XLSX.writeFile(wb, `ViralVibe_History_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Sidebar Panel */}
      <div 
        className={`fixed top-0 right-0 h-full w-full sm:w-96 bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-in-out flex flex-col ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2 text-slate-800 font-bold text-lg">
            <Clock size={20} className="text-blue-600" />
            <h3>히스토리</h3>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {history.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400 text-sm">
              <Clock size={48} className="mb-3 opacity-20" />
              <p>저장된 기록이 없습니다.</p>
              <p className="text-xs mt-1">글을 생성하면 여기에 자동으로 저장됩니다.</p>
            </div>
          ) : (
            history.map((item) => (
              <div 
                key={item.id} 
                className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md hover:border-blue-300 transition-all group relative"
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-xs font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                    {formatDate(item.timestamp)}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(item.id);
                    }}
                    className="text-slate-300 hover:text-red-500 transition-colors p-1"
                    title="삭제"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                
                <div className="space-y-1 mb-4">
                  <h4 className="font-bold text-slate-800 truncate pr-4">
                    {item.keyword}
                  </h4>
                  {item.url && (
                    <p className="text-xs text-blue-600 truncate bg-blue-50/50 p-1 rounded">
                      {item.url}
                    </p>
                  )}
                  {item.context && (
                    <p className="text-xs text-slate-500 line-clamp-2 italic">
                      "{item.context}"
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <span className="text-xs text-slate-400">
                    {item.selectedCommunities.length}개 커뮤니티
                  </span>
                  <button
                    onClick={() => onRestore(item)}
                    className="flex items-center gap-1 text-sm font-bold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-md transition-colors"
                  >
                    <RotateCcw size={14} />
                    불러오기
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        {history.length > 0 && (
          <div className="p-4 border-t border-slate-200 bg-slate-50 grid grid-cols-2 gap-3">
             <button
              onClick={handleExportExcel}
              className="flex items-center justify-center gap-2 text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 p-3 rounded-lg text-sm font-bold transition-all"
            >
              <FileSpreadsheet size={16} />
              엑셀 다운로드
            </button>
            <button
              onClick={onClearAll}
              className="flex items-center justify-center gap-2 text-slate-500 hover:text-red-600 hover:bg-red-50 p-3 rounded-lg text-sm font-medium transition-all"
            >
              <Trash2 size={16} />
              전체 삭제
            </button>
          </div>
        )}
      </div>
    </>
  );
};