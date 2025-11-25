import React from 'react';
import { Community, CommunityCategory } from '../types';
import { COMMUNITIES } from '../constants';

interface Props {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export const CommunitySelector: React.FC<Props> = ({ selectedIds, onChange }) => {
  
  const allCommunityIds = COMMUNITIES.map(c => c.id);
  const isAllSelected = allCommunityIds.length > 0 && allCommunityIds.every(id => selectedIds.includes(id));

  const toggleAll = () => {
    if (isAllSelected) {
      onChange([]);
    } else {
      onChange(allCommunityIds);
    }
  };

  const toggleId = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter(prev => prev !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const toggleCategory = (category: CommunityCategory) => {
    const categoryIds = COMMUNITIES.filter(c => c.category === category).map(c => c.id);
    const allSelected = categoryIds.every(id => selectedIds.includes(id));
    
    if (allSelected) {
      // Deselect all in category
      onChange(selectedIds.filter(id => !categoryIds.includes(id)));
    } else {
      // Select all in category
      const newIds = new Set([...selectedIds, ...categoryIds]);
      onChange(Array.from(newIds));
    }
  };

  const grouped = COMMUNITIES.reduce((acc, curr) => {
    if (!acc[curr.category]) acc[curr.category] = [];
    acc[curr.category].push(curr);
    return acc;
  }, {} as Record<CommunityCategory, Community[]>);

  return (
    <div className="space-y-6">
      {/* Global Select All Control - Sticky Header */}
      <div className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm pb-3 pt-1 border-b border-slate-200 flex items-center justify-between mb-2">
         <span className="text-sm font-semibold text-slate-600">
          선택됨: <span className="text-blue-600">{selectedIds.length}</span> / {allCommunityIds.length}
        </span>
        <button
          type="button"
          onClick={toggleAll}
          className="text-sm font-bold text-blue-600 hover:text-blue-800 bg-blue-100/50 hover:bg-blue-100 px-3 py-1.5 rounded-md transition-colors"
        >
          {isAllSelected ? '모두 해제' : '모두 선택'}
        </button>
      </div>

      {Object.entries(grouped).map(([category, items]) => (
        <div key={category} className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-500 uppercase tracking-wide">{category}</h4>
            <button 
              type="button"
              onClick={() => toggleCategory(category as CommunityCategory)}
              className="text-xs text-slate-500 hover:text-blue-600 font-medium"
            >
              이 카테고리 전체 선택
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {items.map(community => {
              const isSelected = selectedIds.includes(community.id);
              return (
                <button
                  key={community.id}
                  type="button"
                  onClick={() => toggleId(community.id)}
                  className={`relative flex items-center gap-3 p-3 rounded-lg border text-left transition-all duration-200 group
                    ${isSelected 
                      ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' 
                      : 'border-slate-200 bg-white hover:border-blue-300 hover:shadow-sm'
                    }`}
                >
                  <span className="text-2xl filter group-hover:scale-110 transition-transform duration-200">
                    {community.emoji}
                  </span>
                  <div className="min-w-0">
                    <p className={`text-sm font-semibold truncate ${isSelected ? 'text-blue-700' : 'text-slate-700'}`}>
                      {community.name}
                    </p>
                  </div>
                  {isSelected && (
                    <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-blue-500"></div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};