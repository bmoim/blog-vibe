import { GoogleGenAI, Type, Schema } from "@google/genai";
import { COMMUNITIES } from '../constants';
import { GeneratedPost, GenerationRequest } from '../types';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const generateViralContent = async (request: GenerationRequest): Promise<GeneratedPost[]> => {
  const { keyword, url, extraContext, selectedCommunities } = request;

  // Filter only selected community definitions
  const targetCommunities = COMMUNITIES.filter(c => selectedCommunities.includes(c.id));

  if (targetCommunities.length === 0) {
    return [];
  }

  const prompt = `
    You are a high-level viral marketing expert specializing in 'External Inflow' (driving traffic to a specific blog/site) for Korean communities.
    
    GOAL: Create posts that maximize the Click-Through Rate (CTR) to the Target URL.
    
    INPUTS:
    - Topic/Keyword: "${keyword}"
    - Target URL: "${url || '(Link will be inserted by user)'}"
    - Context: "${extraContext || 'Promote this naturally'}"

    STRATEGY - " The Hook & The Gap":
    1. Title: Must be provocative or highly relevant to grab attention immediately.
    2. Content: Provide 70% of the value (summary, shocking fact, intro) but keep the crucial 30% (detailed stats, conclusion, full photos) behind the link.
    3. Call-To-Action (CTA): The link must feel like a necessary step for the reader, not spam.
       - Bad: "Please visit my blog." (Too needy)
       - Good (DC/FMKorea): "Source: [Link]", "Found the full stats here: [Link]", "Is this true? [Link]"
       - Good (Clien/82Cook): "I summarized the details in my blog: [Link]", "For those who need the full guide: [Link]"
       - Good (SNS): "Link in bio", "Read more: [Link]"
    
    4. Comment Strategy (CRITICAL): Generate a "Viral Comment" optimized for the specific community type.
       - Use Case: This text will be used to reply to OTHER people's questions about "${keyword}" or as a self-reply to bump the post.
       - Naver Cafe / 82Cook / Mom Cafes: Must be EMPATHETIC and helpful. "I was looking for this too, and this helped me a lot: [Link]", "Have you checked this review? [Link]"
       - DC / Femco / Inven: Short and dry. "Link found: [Link]", "Full version here: [Link]"
       - KnowledgeIn / Q&A: Expert tone. "I organized the answer to your question here: [Link]"

    TARGET COMMUNITIES & PERSONAS:
    ${targetCommunities.map(c => `
    [ID: ${c.id} | Name: ${c.name}]
    - Tone/Persona: ${c.tonePrompt}
    - Link Strategy: Adapt the link placement to fit this persona naturally.
    `).join('\n')}

    OUTPUT FORMAT:
    Return a raw JSON array.
    Each item must contain: 'communityId', 'title', 'content', 'hashtags', 'comment'.
    
    IMPORTANT:
    - If a URL is provided, it MUST be included in the 'content' OR the 'comment' (or both, depending on what's natural).
    - If no URL is provided in the input, use "[링크]" as a placeholder.
    - Korean language only (Native level, strictly following community slang).
  `;

  // Define the schema using the new Type enum from @google/genai
  const responseSchema: Schema = {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        communityId: { type: Type.STRING },
        title: { type: Type.STRING },
        content: { type: Type.STRING },
        hashtags: { 
          type: Type.ARRAY, 
          items: { type: Type.STRING } 
        },
        comment: { type: Type.STRING }
      },
      required: ['communityId', 'title', 'content', 'hashtags', 'comment'],
    },
  };

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: responseSchema,
        temperature: 0.85, // Slightly higher for more natural/varied comments
      },
    });

    const text = response.text;
    if (!text) return [];

    const parsed = JSON.parse(text) as GeneratedPost[];
    
    // Safety check: ensure only requested IDs are returned
    const validPosts = parsed.filter(p => selectedCommunities.includes(p.communityId));
    
    return validPosts;
  } catch (error) {
    console.error("Gemini Generation Error:", error);
    throw new Error("Failed to generate content. Please check your inputs and try again.");
  }
};