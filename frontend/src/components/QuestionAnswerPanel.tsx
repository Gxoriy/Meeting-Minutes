'use client';

import React, { useState } from 'react';
import { useQa } from '@/contexts/QaContext';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { InterviewProfileDialog } from '@/components/InterviewProfileDialog';
import { ChevronDown, ChevronUp, Trash2, Loader2, MessageCircleQuestion, Settings2 } from 'lucide-react';

/**
 * Floating live Q&A panel shown during recording. Detected questions from the
 * meeting audio and AI answers are displayed here as a teleprompter-style feed.
 */
export function QuestionAnswerPanel() {
  const { isRecording } = useRecordingState();
  const { enabled, setEnabled, items, clear, pendingCount } = useQa();
  const [collapsed, setCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  if (!isRecording) return null;

  return (
    <div className="fixed bottom-28 right-4 z-20 w-80 max-w-[calc(100vw-2rem)] rounded-xl border bg-white/95 shadow-xl backdrop-blur">
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <MessageCircleQuestion className="h-4 w-4 text-blue-600" />
        <span className="text-sm font-semibold flex-1">实时问答</span>
        {pendingCount > 0 && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setProfileOpen(true)}
          title="面试档案（JD / 简历）"
        >
          <Settings2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={clear}
          title="清空问答"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? '展开' : '收起'}
        >
          {collapsed ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </Button>
      </div>

      {!collapsed && (
        <>
          <div className="flex items-center gap-2 px-3 py-2 border-b text-xs text-muted-foreground">
            <Switch
              id="qa-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
              className="h-4 w-7"
            />
            <label htmlFor="qa-enabled" className="cursor-pointer select-none">
              {enabled
                ? '正在识别问题并实时作答'
                : '已暂停，点击恢复'}
            </label>
          </div>

          <ScrollArea className="h-72 px-3">
            {items.length === 0 ? (
              <div className="py-10 text-center text-xs text-muted-foreground">
                {enabled
                  ? '正在聆听会议中的提问…'
                  : '实时问答已暂停。'}
              </div>
            ) : (
              <div className="flex flex-col gap-3 py-3">
                {items.map((item) => (
                  <div key={item.id} className="rounded-lg border bg-slate-50 p-2.5">
                    <div className="text-xs font-medium text-blue-700 break-words">
                      问：{item.question}
                    </div>
                    <div className="mt-1.5 text-sm text-slate-800 whitespace-pre-wrap break-words">
                      {item.status === 'loading' ? (
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          思考中…
                        </span>
                      ) : item.status === 'error' ? (
                        <span className="text-red-600">出错：{item.error}</span>
                      ) : (
                        item.answer
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </>
      )}

      <InterviewProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
    </div>
  );
}
