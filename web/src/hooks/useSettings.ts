import { useCallback, useState } from 'react';
import { loadSettings, saveSettings, type Settings } from '../lib/settings';

export function useSettings() {
  const [settings, setSettingsState] = useState<Settings>(() => loadSettings());
  const setSettings = useCallback((update: Partial<Settings> | ((s: Settings) => Settings)) => {
    setSettingsState((prev) => {
      const next = typeof update === 'function' ? update(prev) : { ...prev, ...update };
      saveSettings(next);
      return next;
    });
  }, []);
  return { settings, setSettings };
}
