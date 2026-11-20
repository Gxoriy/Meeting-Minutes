'use client';

import React from 'react';
import { InterviewProfileForm } from '@/components/InterviewProfileForm';
import { CaptureSourceSelector } from '@/components/CaptureSourceSelector';
import { MessageCircleQuestion } from 'lucide-react';

/**
 * Settings tab for the live interview assistant. Keeps the JD / resume / answer
 * style visible and editable at any time (not only during a recording).
 */
export function InterviewSettings() {
  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-blue-50 p-2">
          <MessageCircleQuestion className="h-5 w-5 text-blue-600" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">面试助手</h2>
          <p className="text-sm text-muted-foreground">
            填写目标岗位 JD 与你的简历。录音时（如腾讯会议面试），系统会实时识别面试官的问题，
            并以你的口吻给出口语化答复，显示在录制页面的「实时问答」面板中。
          </p>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-5">
        <InterviewProfileForm />
      </div>

      <CaptureSourceSelector />

      <div className="rounded-xl border bg-gray-50 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-gray-700 mb-1">使用提示</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>答复使用的模型沿用「摘要」页签里配置的提供商与该供应商（如 DeepSeek）。</li>
          <li>问答默认监听会议全场声音，需在录制时保持「实时问答」面板处于开启状态。</li>
          <li>回答会优先引用简历中的真实经历，避免编造。</li>
        </ul>
      </div>
    </div>
  );
}
