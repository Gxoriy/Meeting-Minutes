'use client';

import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface TencentCredentials {
  appId: string;
  secretId: string;
  secretKey: string;
  engineModelType: string;
}

/**
 * Settings panel for Tencent Cloud realtime ASR credentials (AppID /
 * SecretId / SecretKey). Credentials are stored locally via the backend
 * store, never committed to the repository.
 */
export function TencentAsrSettings() {
  const [creds, setCreds] = useState<TencentCredentials>({
    appId: '',
    secretId: '',
    secretKey: '',
    engineModelType: '16k_zh',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    invoke<TencentCredentials>('api_get_tencent_asr_config')
      .then((data) => {
        if (cancelled || !data) return;
        setCreds({
          appId: data.appId ?? '',
          secretId: data.secretId ?? '',
          secretKey: data.secretKey ?? '',
          engineModelType: data.engineModelType ?? '16k_zh',
        });
      })
      .catch((e) => console.error('[TencentAsr] load failed:', e))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await invoke('api_save_tencent_asr_config', { credentials: creds });
      toast.success('腾讯云凭据已保存');
    } catch (e) {
      toast.error('保存失败', { description: String(e) });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      // Test uses the last saved credentials; save first if edited.
      await invoke('api_save_tencent_asr_config', { credentials: creds });
      const result = await invoke<{ status: string; message: string }>(
        'api_test_tencent_asr_connection',
      );
      toast.success('连接成功', { description: result.message });
    } catch (e) {
      toast.error('连接失败', { description: String(e) });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">正在读取腾讯云凭据…</p>;
  }

  return (
    <div className="space-y-3 mt-2">
      <div className="text-sm text-muted-foreground">
        使用腾讯云「实时语音识别」（16k_zh 中文引擎），流式返回、逐字修正，延迟约 1 秒。
        凭据仅保存在本机。
      </div>

      <div>
        <Label className="block text-sm font-medium text-gray-700 mb-1">AppID *</Label>
        <Input
          value={creds.appId}
          onChange={(e) => setCreds({ ...creds, appId: e.target.value })}
          placeholder="腾讯云账号中心的 APPID（纯数字）"
        />
      </div>

      <div>
        <Label className="block text-sm font-medium text-gray-700 mb-1">SecretId *</Label>
        <Input
          value={creds.secretId}
          onChange={(e) => setCreds({ ...creds, secretId: e.target.value })}
          placeholder="API 密钥管理中的 SecretId"
        />
      </div>

      <div>
        <Label className="block text-sm font-medium text-gray-700 mb-1">SecretKey *</Label>
        <Input
          type="password"
          value={creds.secretKey}
          onChange={(e) => setCreds({ ...creds, secretKey: e.target.value })}
          placeholder="API 密钥管理中的 SecretKey"
        />
      </div>

      <div>
        <Label className="block text-sm font-medium text-gray-700 mb-1">识别引擎</Label>
        <select
          value={creds.engineModelType}
          onChange={(e) => setCreds({ ...creds, engineModelType: e.target.value })}
          className="w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="16k_zh">16k_zh — 中文普通话通用（推荐）</option>
          <option value="16k_zh_en">16k_zh_en — 中英混合大模型</option>
          <option value="16k_yue">16k_yue — 粤语</option>
          <option value="16k_en">16k_en — 英文</option>
        </select>
      </div>

      <div className="flex gap-2 pt-1">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? '保存中…' : '保存凭据'}
        </Button>
        <Button variant="outline" onClick={handleTest} disabled={testing || saving}>
          {testing ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              测试连接…
            </span>
          ) : (
            '测试连接'
          )}
        </Button>
      </div>
    </div>
  );
}
