import React, { useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { FolderOpen } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { DeviceSelection, SelectedDevices } from '@/components/DeviceSelection';
import Analytics from '@/lib/analytics';
import { cachedDeviceLabel } from '@/lib/audioDevices';
import { toast } from 'sonner';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useConfig } from '@/contexts/ConfigContext';

export interface RecordingPreferences {
  device_selection_version: [number, number];
  save_folder: string;
  auto_save: boolean;
  file_format: string;
  preferred_mic_device: string | null;
  preferred_system_device: string | null;
  /** "both" | "mic_only" | "speaker_only" */
  capture_mode: string;
}

interface RecordingSettingsProps {
  onSave?: (preferences: RecordingPreferences) => void;
}

export function RecordingSettings({ onSave }: RecordingSettingsProps) {
  const [preferences, setPreferences] = useState<RecordingPreferences>({
    save_folder: '',
    auto_save: true,
    file_format: 'mp4',
    device_selection_version: [1, 1],
    preferred_mic_device: null,
    preferred_system_device: null,
    capture_mode: 'both'
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showRecordingNotification, setShowRecordingNotification] = useState(true);
  const { isRecording } = useRecordingState();
  const { setSelectedDevices } = useConfig();

  // Load recording preferences on component mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const prefs = await invoke<RecordingPreferences>('get_recording_preferences');
        setPreferences(prefs);
      } catch (error) {
        console.error('Failed to load recording preferences:', error);
        toast.error('Could not load recording preferences', { description: String(error) });
        // If loading fails, get default folder path
        try {
          const defaultPath = await invoke<string>('get_default_recordings_folder_path');
          setPreferences(prev => ({ ...prev, save_folder: defaultPath }));
        } catch (defaultError) {
          console.error('Failed to get default folder path:', defaultError);
        }
      } finally {
        setLoading(false);
      }
    };

    loadPreferences();
  }, []);

  // Load recording notification preference
  useEffect(() => {
    const loadNotificationPref = async () => {
      try {
        const { Store } = await import('@tauri-apps/plugin-store');
        const store = await Store.load('preferences.json');
        const show = await store.get<boolean>('show_recording_notification') ?? true;
        setShowRecordingNotification(show);
      } catch (error) {
        console.error('Failed to load notification preference:', error);
      }
    };
    loadNotificationPref();
  }, []);

  const handleAutoSaveToggle = async (enabled: boolean) => {
    const newPreferences = { ...preferences, auto_save: enabled };
    setPreferences(newPreferences);
    await savePreferences(newPreferences);

    // Track auto-save setting change
    await Analytics.track('auto_save_recording_toggled', {
      enabled: enabled.toString()
    });
  };

  const handleDeviceChange = async (devices: SelectedDevices) => {
    const newPreferences: RecordingPreferences = {
      ...preferences,
      device_selection_version: [
        devices.micDevice !== preferences.preferred_mic_device ? 1 : preferences.device_selection_version[0],
        devices.systemDevice !== preferences.preferred_system_device ? 1 : preferences.device_selection_version[1],
      ],
      preferred_mic_device: devices.micDevice,
      preferred_system_device: devices.systemDevice
    };
    setPreferences(newPreferences);
    // Sync the in-memory selection ConfigContext exposes to the start path.
    // Without this, the picker only writes to disk (loaded into context once at
    // app mount), so a newly-chosen mic isn't honored until the next launch —
    // start keeps sending the stale launch-time device.
    setSelectedDevices(devices);
    await savePreferences(newPreferences);

    // Track default device preference changes
    // Note: Individual device selection analytics are tracked in DeviceSelection component
    await Analytics.track('default_devices_changed', {
      has_preferred_microphone: (!!devices.micDevice).toString(),
      has_preferred_system_audio: (!!devices.systemDevice).toString()
    });
  };

  const handleOpenFolder = async () => {
    try {
      await invoke('open_recordings_folder');
    } catch (error) {
      console.error('Failed to open recordings folder:', error);
    }
  };

  // Let the user choose a custom recordings folder via the native dialog.
  const handleChangeFolder = async () => {
    try {
      const picked = await invoke<string | null>('select_recording_folder');
      if (picked) {
        setPreferences((prev) => ({ ...prev, save_folder: picked }));
        toast.success('存储位置已更新', { description: picked });
      }
    } catch (error) {
      console.error('Failed to change recordings folder:', error);
      toast.error('更改存储位置失败', { description: String(error) });
    }
  };

  // Persist the capture source mode (both / mic only / speaker only).
  const handleCaptureModeChange = async (mode: 'both' | 'mic_only' | 'speaker_only') => {
    const newPreferences: RecordingPreferences = { ...preferences, capture_mode: mode };
    setPreferences(newPreferences);
    await savePreferences(newPreferences);
    const label =
      mode === 'mic_only' ? '仅麦克风' : mode === 'speaker_only' ? '仅扬声器' : '麦克风 + 扬声器';
    toast.success('采集来源已更新', { description: label });
  };

  const handleNotificationToggle = async (enabled: boolean) => {
    try {
      setShowRecordingNotification(enabled);
      const { Store } = await import('@tauri-apps/plugin-store');
      const store = await Store.load('preferences.json');
      await store.set('show_recording_notification', enabled);
      await store.save();
      toast.success('Preference saved');
      await Analytics.track('recording_notification_preference_changed', {
        enabled: enabled.toString()
      });
    } catch (error) {
      console.error('Failed to save notification preference:', error);
      toast.error('Failed to save preference');
    }
  };

  const savePreferences = async (prefs: RecordingPreferences) => {
    setSaving(true);
    try {
      await invoke('set_recording_preferences', { preferences: prefs });
      const saved = await invoke<RecordingPreferences>('get_recording_preferences');
      setPreferences(saved);
      setSelectedDevices({ micDevice: saved.preferred_mic_device, systemDevice: saved.preferred_system_device });
      onSave?.(saved);

      // Show success toast with device details
      const micDevice = prefs.preferred_mic_device ? cachedDeviceLabel(prefs.preferred_mic_device) : 'Default';
      const systemDevice = prefs.preferred_system_device ? cachedDeviceLabel(prefs.preferred_system_device) : 'Default';
      toast.success("Device preferences saved", {
        description: `Microphone: ${micDevice}, System Audio: ${systemDevice}`
      });
    } catch (error) {
      console.error('Failed to save recording preferences:', error);
      toast.error("Failed to save device preferences", {
        description: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
        <div className="h-8 bg-gray-200 rounded mb-4"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-4">录音设置</h3>
        <p className="text-sm text-gray-600 mb-6">
          配置会议录音的保存方式与采集来源。
        </p>
      </div>

      {/* Capture source (interview Q&A / meeting) */}
      <div className="p-4 border rounded-lg space-y-3">
        <div>
          <div className="font-medium">采集来源</div>
          <div className="text-sm text-gray-600">
            选择录制时采集哪些声音。面试实时问答场景可按需只采集麦克风或只采集扬声器。
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { value: 'both', label: '麦克风 + 扬声器' },
            { value: 'mic_only', label: '仅麦克风（我的声音）' },
            { value: 'speaker_only', label: '仅扬声器（对方声音）' },
          ].map((opt) => {
            const active = (preferences.capture_mode || 'both') === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() =>
                  handleCaptureModeChange(
                    opt.value as 'both' | 'mic_only' | 'speaker_only',
                  )
                }
                disabled={saving || isRecording}
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
        {isRecording && (
          <p className="text-xs text-amber-700">
            录制进行中，采集来源不可更改，请停止当前会议后再调整。
          </p>
        )}
      </div>

      {/* Auto Save Toggle */}
      <div className="flex items-center justify-between p-4 border rounded-lg">
        <div className="flex-1">
          <div className="font-medium">保存录音</div>
          <div className="text-sm text-gray-600">
            录音结束时自动保存音频文件
          </div>
        </div>
        <Switch
          checked={preferences.auto_save}
          onCheckedChange={handleAutoSaveToggle}
          disabled={saving}
        />
      </div>

      {/* Folder Location - Only shown when auto_save is enabled */}
      {preferences.auto_save && (
        <div className="space-y-4">
          <div className="p-4 border rounded-lg bg-gray-50">
            <div className="font-medium mb-2">保存位置</div>
            <div className="text-sm text-gray-600 mb-3 break-all">
              {preferences.save_folder || '默认文件夹'}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleChangeFolder}
                disabled={saving}
                className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <FolderOpen className="w-4 h-4" />
                更改文件夹
              </button>
              <button
                onClick={handleOpenFolder}
                className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                <FolderOpen className="w-4 h-4" />
                打开文件夹
              </button>
            </div>
          </div>

          <div className="p-4 border rounded-lg bg-blue-50">
            <div className="text-sm text-blue-800">
              <strong>文件格式：</strong> {preferences.file_format.toUpperCase()} 文件
            </div>
            <div className="text-xs text-blue-600 mt-1">
              录音按时间戳命名保存：recording_YYYYMMDD_HHMMSS.{preferences.file_format}
            </div>
          </div>
        </div>
      )}

      {/* Info when auto_save is disabled */}
      {!preferences.auto_save && (
        <div className="p-4 border rounded-lg bg-yellow-50">
          <div className="text-sm text-yellow-800">
            音频录制已关闭。启用「保存录音」后将自动保存会议音频。
          </div>
        </div>
      )}

      {/* Recording Notification Toggle */}
      <div className="flex items-center justify-between p-4 border rounded-lg">
        <div className="flex-1">
          <div className="font-medium">Recording Start Notification</div>
          <div className="text-sm text-gray-600">
            Show reminder to inform participants when recording starts
          </div>
        </div>
        <Switch
          checked={showRecordingNotification}
          onCheckedChange={handleNotificationToggle}
        />
      </div>

      {/* Device Preferences */}
      <div className="space-y-4">
        <div className="border-t pt-6">
          <h4 className="text-base font-medium text-gray-900 mb-4">Default Audio Devices</h4>
          <p className="text-sm text-gray-600 mb-4">
            Set your preferred microphone and system audio devices for recording. These will be automatically selected when starting new recordings.
          </p>

          {isRecording && (
            <p
              role="status"
              aria-live="polite"
              className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2 mb-4"
            >
              Device selection is locked while a recording is in progress. Connecting a new device mid-recording will not switch to it. Stop the current meeting to change devices.
            </p>
          )}

          <div className="border rounded-lg p-4 bg-gray-50">
            <DeviceSelection
              selectedDevices={{
                micDevice: preferences.preferred_mic_device,
                systemDevice: preferences.preferred_system_device
              }}
              onDeviceChange={handleDeviceChange}
              disabled={saving || isRecording}
            />
          </div>
        </div>
      </div>
    </div>
  );
}