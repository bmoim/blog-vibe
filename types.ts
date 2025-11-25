export enum CommunityCategory {
  COMMUNITY = '커뮤니티 (종합/유머)',
  SOCIAL = '소셜 미디어 (SNS)',
  BLOG = '블로그/지식공유',
  GAME = '게임 커뮤니티',
  SHOPPING = '쇼핑/핫딜/재테크',
  SPECIAL = '취미/전문 분야',
}

export interface Community {
  id: string;
  name: string;
  emoji: string;
  url: string; // URL to the writing page or main page
  category: CommunityCategory;
  tonePrompt: string; // Instructions for Gemini on how to write for this specific community
  color: string;
}

export interface GeneratedPost {
  communityId: string;
  title: string;
  content: string;
  hashtags: string[];
  comment: string; // Short promotional comment or self-reply
}

export interface GenerationRequest {
  keyword: string;
  url?: string;
  extraContext?: string;
  selectedCommunities: string[];
}

export interface HistoryItem {
  id: string;
  timestamp: number;
  keyword: string;
  url: string;
  context: string;
  selectedCommunities: string[];
}
