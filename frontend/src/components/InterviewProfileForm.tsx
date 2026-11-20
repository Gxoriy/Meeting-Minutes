'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  clearInterviewProfile,
  getInterviewProfile,
  saveInterviewProfile,
} from '@/services/qaService';

interface Props {
  /** Called after a successful save/clear so parents can refresh their view. */
  onSaved?: () => void;
}

/**
 * Reusable form for the interview profile (target JD + candidate resume +
 * answer style). Shared by the settings tab and the in-call dialog.
 */
export function InterviewProfileForm({ onSaved }: Props) {
  const [jobTitle, setJobTitle] = useState('');
  const [jdText, setJdText] = useState('');
  const [resumeText, setResumeText] = useState('');
  const [answerStyle, setAnswerStyle] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getInterviewProfile()
      .then((profile) => {
        if (cancelled || !profile) return;
        setJobTitle(profile.jobTitle ?? '');
        setJdText(profile.jdText ?? '');
        setResumeText(profile.resumeText ?? '');
        setAnswerStyle(profile.answerStyle ?? '');
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await saveInterviewProfile({ jobTitle, jdText, resumeText, answerStyle });
      setMessage('已保存，实时问答将以面试者口吻作答');
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await clearInterviewProfile();
      setJobTitle('');
      setJdText('');
      setResumeText('');
      setAnswerStyle('');
      setMessage('已清除面试档案');
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">正在加载面试档案…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="ip-job">岗位名称</Label>
        <Input
          id="ip-job"
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
          placeholder="例如：Node.js 后端开发工程师"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="ip-jd">岗位 JD（职位描述）</Label>
        <Textarea
          id="ip-jd"
          value={jdText}
          onChange={(e) => setJdText(e.target.value)}
          placeholder="粘贴职位描述与任职要求…"
          className="min-h-[160px]"
        />
        <p className="text-xs text-muted-foreground">
          面试官提问时，AI 会优先贴合这份 JD 的要求作答。
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ip-resume">我的简历</Label>
        <Textarea
          id="ip-resume"
          value={resumeText}
          onChange={(e) => setResumeText(e.target.value)}
          placeholder="粘贴简历内容（经历、项目、技能）…"
          className="min-h-[200px]"
        />
        <p className="text-xs text-muted-foreground">
          回答会优先引用简历里的真实经历与项目，不会编造没有的内容。
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ip-style">回答风格提示词（可选）</Label>
        <Input
          id="ip-style"
          value={answerStyle}
          onChange={(e) => setAnswerStyle(e.target.value)}
          placeholder="例如：口语化、自然、第一人称、3-6 句"
        />
      </div>

      {error && <p className="text-sm text-red-600">出错：{error}</p>}
      {message && <p className="text-sm text-green-600">{message}</p>}

      <div className="flex gap-2 pt-2">
        <Button variant="outline" onClick={handleClear} disabled={saving}>
          清除档案
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? '保存中…' : '保存档案'}
        </Button>
      </div>
    </div>
  );
}
