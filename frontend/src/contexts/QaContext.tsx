'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import {
  answerQuestion,
  looksLikeQuestion,
  QuestionAnswer,
} from '@/services/qaService';

interface TranscriptUpdatePayload {
  text: string;
  timestamp?: string;
  sequence_id?: number;
  is_partial?: boolean;
}

interface QaContextValue {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  items: QuestionAnswer[];
  clear: () => void;
  pendingCount: number;
}

const QaContext = createContext<QaContextValue | null>(null);

const MAX_ITEMS = 30;
const CONTEXT_WINDOW = 8;
const DEDUPE_WINDOW_MS = 15_000;
const MIN_QUESTION_LENGTH = 4;

export function QaProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabled] = useState(true);
  const [items, setItems] = useState<QuestionAnswer[]>([]);

  const recentRef = useRef<string[]>([]);
  const lastQuestionRef = useRef<{ text: string; at: number } | null>(null);
  const inFlightRef = useRef(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const handleTranscript = useCallback(async (payload: TranscriptUpdatePayload) => {
    if (!enabledRef.current) return;
    const text = (payload.text ?? '').trim();
    if (text.length < MIN_QUESTION_LENGTH) return;

    // Maintain a rolling transcript window for answer context.
    recentRef.current = [...recentRef.current, text].slice(-CONTEXT_WINDOW);

    if (!looksLikeQuestion(text)) return;

    // De-duplicate near-identical consecutive questions.
    const now = Date.now();
    const last = lastQuestionRef.current;
    if (
      last &&
      now - last.at < DEDUPE_WINDOW_MS &&
      (last.text === text || text.includes(last.text) || last.text.includes(text))
    ) {
      return;
    }
    lastQuestionRef.current = { text, at: now };

    // Serialize LLM calls to avoid spamming and out-of-order answers.
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    const id = `${now}-${Math.random().toString(36).slice(2, 8)}`;
    const context = recentRef.current.slice(0, -1).join('\n');
    setItems((prev) =>
      [
        {
          id,
          question: text,
          answer: '',
          createdAt: now,
          status: 'loading' as const,
        },
        ...prev,
      ].slice(0, MAX_ITEMS),
    );

    try {
      const answer = await answerQuestion(text, context);
      setItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, answer, status: 'done' as const } : item,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, status: 'error' as const, error: message }
            : item,
        ),
      );
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;

    listen<TranscriptUpdatePayload>('transcript-update', (event) => {
      void handleTranscript(event.payload);
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((error) => {
        console.error('[QaContext] Failed to listen to transcript-update:', error);
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [handleTranscript]);

  const clear = useCallback(() => {
    setItems([]);
    recentRef.current = [];
    lastQuestionRef.current = null;
  }, []);

  const pendingCount = useMemo(
    () => items.filter((item) => item.status === 'loading').length,
    [items],
  );

  const value = useMemo<QaContextValue>(
    () => ({ enabled, setEnabled, items, clear, pendingCount }),
    [enabled, items, clear, pendingCount],
  );

  return <QaContext.Provider value={value}>{children}</QaContext.Provider>;
}

export function useQa(): QaContextValue {
  const ctx = useContext(QaContext);
  if (!ctx) {
    throw new Error('useQa must be used within a QaProvider');
  }
  return ctx;
}
