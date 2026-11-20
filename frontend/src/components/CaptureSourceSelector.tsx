'use client';

import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { toast } from 'sonner';

type CaptureMode = 'both' | 'mic_only' | 'speaker_only';

interface RecordingPreferencesLike {
  capture_mode?: string;
  [key: string]: unknown;
}

const OPTIONS: { value: CaptureMode; label: string; hint: string }[] = [
  { value: 'both', label: '麦克风 + 扬声器', hint: '同时采集我的声音和对方/会议声音' },
  { value: 'mic_only', label: '仅麦克风', hint: '只采集我的声音（例如我自己的提问）' },
  { value: 'speaker_only', label: '仅扬声器', hint: '只采集对方/会议系统的声音' },
];

/**
 * Self-contained capture-source selector. Reads and writes the shared
 * recording preferences, so changes here and in the 录音 settings tab stay in
 * sync. Used by the interview settings tab.
 */
export function CaptureSourceSelector() {
  const { isRecording } = useRecordingState();
  const [mode, setMode] = useState<CaptureMode>('both');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    invoke<RecordingPreferencesLike>('get_recording_preferences')
      .then((prefs) => {
        if (cancelled) return;
        const current = (prefs?.capture_mode as CaptureMode) || 'both';
        setMode(current);
      })
      .catch((e) => console.error('[CaptureSourceSelector] load failed:', e))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = async (next: CaptureMode) => {
    setSaving(true);
    try {
      const prefs = await invoke<RecordingPreferencesLike>('get_recording_preferences');
      const updated = { ...prefs, capture_mode: next };
      await invoke('set_recording_preferences', { preferences: updated });
      setMode(next);
      toast.success('采集来源已更新', {
        description: OPTIONS.find((o) => o.value === next)?.label,
      });
    } catch (e) {
      console.error('[CaptureSourceSelector] save failed:', e);
      toast.error('更新采集来源失败', { description: String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border bg-white p-5 space-y-3">
      <div>
        <div className="font-medium">采集来源</div>
        <div className="text-sm text-muted-foreground">
          选择面试问答时采集哪些声音。改动同样会应用到「录音」设置。
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">正在读取当前设置…</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {OPTIONS.map((opt) => {
            const active = mode === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => handleChange(opt.value)}
                disabled={saving || isRecording}
                title={opt.hint}
                className={`px-3 py-2 text-sm rounded-md border transition-colors ${
                  active
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                } ${saving || isRecording ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      {isRecording && (
        <p className="text-xs text-amber-700">
          录制进行中，采集来源不可更改，请停止当前会议后再调整。
        </p>
      )}
    </div>
  );
}
