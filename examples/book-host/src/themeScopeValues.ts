/** Static theme tokens for @dynamico/ui scope (matches apps/app/dynamicoScope.ts). */
export const lightTheme = {
  id: 'light' as const,
  name: 'Newscast',
  colors: {
    primary: '#F53071',
    secondary: '#FFF5F5',
    background: '#FFFFFF',
    surface: '#F8F8F8',
    text: '#000000',
    textSecondary: 'rgba(0,0,0,0.6)',
    white: '#FFFFFF',
    black: '#000000',
    border: 'rgba(0,0,0,0.1)',
    placeholder: 'rgba(0,0,0,0.4)',
  },
};

export const THEME_SCOPE_VALUES = {
  lightTheme,
  getThemeById: (_id: string) => lightTheme,
  ALL_THEMES: [lightTheme],
  PERSONA_IDS: [] as string[],
  PERSONA_NAMES: {} as Record<string, string>,
};
