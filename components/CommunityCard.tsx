import React, { useState } from 'react';
import { Copy, ExternalLink, Check, MessageCircle } from 'lucide-react';
import { GeneratedPost, Community } from '../types';

interface Props {
  post: GeneratedPost;
  community: Community;
}

export const CommunityCard: React.FC<Props> = ({ post, community }) => {
  const [copiedField, setCopiedField] = useState<'title' | 'body' | 'comment' | null>(null);

  const handleCopy = (text: string, field: 'title' | 'body' | 'comment') => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div className="bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden flex flex-col h-full transition-all hover:shadow-lg">
      {/* Header */}
      <div className={`${community.color} text-white px-4 py-3 flex justify-between items-center`}>
        <div className="flex items-center gap-2">
          <span className="text-xl">{community.emoji}</span>
          <h3 className="font-bold text-sm md:text-base">{community.name}</h3>
        </div>
        <a 
          href={community.url} 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-white/80 hover:text-white transition-colors"
          title="사이트 바로가기"
        >
          <ExternalLink size={18} />
        </a>
      </div>

      {/* Content */}
      <div className="p-4 flex-1 flex flex-col gap-4">
        
        {/* Title Section */}
        <div className="space-y-1">
          <div className="flex justify-between items-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span>제목</span>
            <button 
              onClick={() => handleCopy(post.title, 'title')}
              className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${copiedField === 'title' ? 'text-green-600 bg-green-50' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
            >
              {copiedField === 'title' ? <Check size={14} /> : <Copy size={14} />}
              <span>{copiedField === 'title' ? '완료' : '복사'}</span>
            </button>
          </div>
          <div className="bg-slate-50 p-3 rounded-md border border-slate-100 text-slate-800 font-medium text-sm min-h-[3rem]">
            {post.title}
          </div>
        </div>

        {/* Body Section */}
        <div className="space-y-1 flex-1">
          <div className="flex justify-between items-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span>본문</span>
            <button 
              onClick={() => handleCopy(post.content + (post.hashtags.length > 0 ? '\n\n' + post.hashtags.join(' ') : ''), 'body')}
              className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${copiedField === 'body' ? 'text-green-600 bg-green-50' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
            >
              {copiedField === 'body' ? <Check size={14} /> : <Copy size={14} />}
              <span>{copiedField === 'body' ? '완료' : '복사'}</span>
            </button>
          </div>
          <div className="bg-slate-50 p-3 rounded-md border border-slate-100 text-slate-700 text-sm whitespace-pre-wrap leading-relaxed h-full min-h-[8rem]">
            {post.content}
            {post.hashtags.length > 0 && (
              <div className="mt-4 text-blue-600 text-xs">
                {post.hashtags.map(t => `#${t}`).join(' ')}
              </div>
            )}
          </div>
        </div>

        {/* Comment Section (New) */}
        <div className="space-y-1 mt-1 pt-4 border-t border-slate-100 border-dashed">
          <div className="flex justify-between items-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span className="flex items-center gap-1 text-slate-600">
              <MessageCircle size={12} />
              홍보용 댓글 (자댓/타 게시글 댓글)
            </span>
            <button 
              onClick={() => handleCopy(post.comment, 'comment')}
              className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${copiedField === 'comment' ? 'text-green-600 bg-green-50' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
            >
              {copiedField === 'comment' ? <Check size={14} /> : <Copy size={14} />}
              <span>{copiedField === 'comment' ? '완료' : '복사'}</span>
            </button>
          </div>
          <div className="bg-yellow-50/50 p-3 rounded-md border border-yellow-100 text-slate-700 text-sm min-h-[3rem]">
            {post.comment}
          </div>
        </div>

      </div>
    </div>
  );
};