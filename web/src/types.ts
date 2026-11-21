export type Dir = "it2en" | "en2it";

export interface CardData {
  noteId: string;
  dir: Dir;
  topic: string;
  it: string;
  en: string;
  ex: string;
  exEn: string;
  notes?: string;
  flag?: string;
  kind: "word" | "phrase";
  level: number;
  order: number;
  source: "seed" | "mistake" | "tutor" | "manual";
  suspended?: boolean;
  createdAt?: number;
}

export interface SrsData {
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: number | null;
  introducedOn: string;
}

export interface ReviewData {
  cardId: string;
  rating: number;
  date: string;
  ts: number;
  mode: "flip" | "speak";
  heard?: string;
}

export type BlockKind = "lesson" | "flashcards" | "speaking" | "shadowing" | "listening" | "review" | "tutor" | "other";

export interface TimelogData {
  date: string;
  block: BlockKind;
  blockId?: string;
  minutes: number;
  note?: string;
  ts: number;
}

export interface DayplanData {
  date: string;
  mode: "full" | "short";
  done: Record<string, string>; // blockId -> timelog id
}

export type MistakeType =
  | "gender_articles"
  | "verb_conjugation"
  | "word_order"
  | "prepositions"
  | "vocabulary"
  | "spelling"
  | "other";

export interface MistakeData {
  source: "conversation" | "flashcard" | "tutor" | "shadowing" | "manual";
  type: MistakeType;
  original: string;
  corrected: string;
  meaningEn?: string;
  explanation?: string;
  date: string;
  ts: number;
  cardId?: string;
  reviewedAt?: number;
  conversationId?: string;
}

export interface TutorData {
  date: string;
  minutes: number;
  platform: string;
  notes: string;
  newWords: { it: string; en: string }[];
  timelogId?: string;
}

export interface Settings {
  startDate: string;
  targetDate: string;
  newPerDay: number;
  reviewCap: number;
  weeklyTargetHours: number;
  sttMode: "auto" | "browser" | "server";
  voiceURI: string;
  ttsRate: number; // 0 = follow curriculum level
  lessonCourse: string;
  lessonNext: number;
  speakAnswers: boolean;
  autoplay: boolean;
}

export interface PlanBlock {
  id: string;
  kind: BlockKind;
  label: string;
  minutes: number;
  hint?: string;
}

export interface Correction {
  original: string;
  corrected: string;
  meaning_en: string;
  explanation_en: string;
  type: MistakeType;
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  en?: string;
  help?: string;
  corrections?: Correction[];
  ts: number;
}

export interface ConversationData {
  scenario: string;
  scenarioLabel: string;
  week: number;
  level: number;
  startedAt: number;
  endedAt?: number;
  messages: ChatMessage[];
  summary?: {
    top_mistakes: { original: string; corrected: string; explanation_en: string; type: MistakeType }[];
    went_well: string;
    focus_next: string;
  };
  speakingSeconds?: number;
  date: string;
}

export const MISTAKE_LABELS: Record<MistakeType, string> = {
  gender_articles: "Gender & articles",
  verb_conjugation: "Verb conjugation",
  word_order: "Word order",
  prepositions: "Prepositions",
  vocabulary: "Vocabulary",
  spelling: "Spelling & pronunciation",
  other: "Other",
};
