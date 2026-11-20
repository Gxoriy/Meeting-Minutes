'use client';

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { InterviewProfileForm } from '@/components/InterviewProfileForm';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * In-call quick editor for the interview profile. The same form also lives in
 * the Settings → 面试助手 tab, so users can configure it without recording.
 */
export function InterviewProfileDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>面试档案</DialogTitle>
          <DialogDescription>
            填入目标岗位 JD 与你的简历，实时问答会以面试者第一人称口吻作答。
          </DialogDescription>
        </DialogHeader>
        <InterviewProfileForm onSaved={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
