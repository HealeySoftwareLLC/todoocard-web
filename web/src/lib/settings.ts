/** Browser-local settings. Provider keys never leave this browser except inside the API request that uses them. */
export interface Settings {
  appToken: string;
  providerKeys: Record<string, Record<string, string>>;
  searchProvider: string;
  generateProvider: string;
  debugLog: boolean;
}

const KEY = 'todoocard-web.settings.v1';

export const defaultSettings: Settings = {
  appToken: '',
  providerKeys: {},
  searchProvider: 'openverse',
  generateProvider: 'openai',
  debugLog: false,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaultSettings };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...defaultSettings, ...parsed, providerKeys: parsed.providerKeys ?? {} };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode etc. */
  }
}

export function clearSettings() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
