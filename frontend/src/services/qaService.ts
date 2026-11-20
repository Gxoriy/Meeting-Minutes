/**
 * Live Q&A service.
 *
 * Detects questions in real-time transcript segments and asks the configured
 * summarization provider (e.g. DeepSeek via the OpenAI-compatible channel) to
 * answer them. Kept independent from the recording/transcript pipeline: it only
 * listens to `transcript-update` events and calls the `api_answer_question`
 * Tauri command.
 */

import { invoke } from '@tauri-apps/api/core';

export interface QuestionAnswer {
  id: string;
  question: string;
  answer: string;
  createdAt: number;
  status: 'loading' | 'done' | 'error';
  error?: string;
}

/**
 * Heuristic question detection for mixed meeting speech (Chinese + English).
 * Deliberately conservative to avoid spamming the LLM on every sentence.
 */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (t.length < 4) return false;
  // Explicit question mark (ASCII or full-width)
  if (/[?？]/.test(t)) return true;
  // Chinese question particles at the end
  if (/[吗么嘛呢吧]\s*[。.!！]?$/.test(t)) return true;
  // Chinese interrogative openers
  if (/^(请问|想问一下|想请教|谁|什么|怎么|如何|为什么|哪位|哪个|哪|几时|什么时候|多少|是否|能不能|可不可以|有没有|是不是|会不会|要不要)/.test(t)) return true;
  // Common Chinese interrogative phrases anywhere
  if (/(怎么做|怎么办|是什么|为什么|如何做|能不能|可不可以|有没有|是不是|取决于|是什么意思)/.test(t)) return true;
  // English openers
  if (/^(what|why|how|when|where|who|whom|which|can|could|would|should|will|is|are|was|were|do|does|did|have|has)\b/i.test(t)) return true;
  return false;
}

/**
 * Ask the configured model to answer a single question.
 * The backend reads the active provider + credentials from the database.
 */
export async function answerQuestion(
  question: string,
  recentContext?: string,
): Promise<string> {
  return invoke<string>('api_answer_question', {
    question,
    recentContext: recentContext ?? null,
  });
}

export interface InterviewProfile {
  id: string;
  jobTitle?: string | null;
  jdText?: string | null;
  resumeText?: string | null;
  answerStyle?: string | null;
  updatedAt?: string | null;
}

export async function getInterviewProfile(): Promise<InterviewProfile | null> {
  return invoke<InterviewProfile | null>('api_get_interview_profile');
}

export async function saveInterviewProfile(input: {
  jobTitle?: string;
  jdText?: string;
  resumeText?: string;
  answerStyle?: string;
}): Promise<void> {
  return invoke('api_save_interview_profile', {
    jobTitle: input.jobTitle ?? null,
    jdText: input.jdText ?? null,
    resumeText: input.resumeText ?? null,
    answerStyle: input.answerStyle ?? null,
  });
}

export async function clearInterviewProfile(): Promise<void> {
  return invoke('api_clear_interview_profile');
}
