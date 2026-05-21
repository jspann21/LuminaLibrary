import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

type Theme = 'light' | 'dark' | 'system'
export type AccentColor =
  | 'rose'
  | 'orange'
  | 'amber'
  | 'yellow'
  | 'lime'
  | 'green'
  | 'emerald'
  | 'teal'
  | 'cyan'
  | 'sky'
  | 'indigo'
  | 'violet'
  | 'purple'
  | 'fuchsia'
  | 'pink'

type ThemeContextValue = {
  theme: Theme
  setTheme: (value: Theme) => void
  accentColor: AccentColor
  setAccentColor: (value: AccentColor) => void
  isDark: boolean
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

const THEME_STORAGE_KEY = 'theme'
const ACCENT_STORAGE_KEY = 'accentColor'

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'system'
  const saved = localStorage.getItem(THEME_STORAGE_KEY)
  if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
  return 'system'
}

function getInitialAccent(): AccentColor {
  if (typeof window === 'undefined') return 'sky'
  const saved = localStorage.getItem(ACCENT_STORAGE_KEY)
  const valid: AccentColor[] = [
    'rose',
    'orange',
    'amber',
    'yellow',
    'lime',
    'green',
    'emerald',
    'teal',
    'cyan',
    'sky',
    'indigo',
    'violet',
    'purple',
    'fuchsia',
    'pink',
  ]
  if (saved && valid.includes(saved as AccentColor)) return saved as AccentColor
  return 'sky'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [accentColor, setAccentColor] = useState<AccentColor>(getInitialAccent)
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    const applyTheme = () => {
      const resolvedTheme = theme === 'system' ? (mediaQuery.matches ? 'dark' : 'light') : theme
      root.classList.remove('light', 'dark')
      root.classList.add(resolvedTheme)
      setIsDark(resolvedTheme === 'dark')
    }

    applyTheme()
    localStorage.setItem(THEME_STORAGE_KEY, theme)

    if (theme === 'system') {
      mediaQuery.addEventListener('change', applyTheme)
    }

    return () => {
      mediaQuery.removeEventListener('change', applyTheme)
    }
  }, [theme])

  useEffect(() => {
    document.documentElement.setAttribute('data-accent', accentColor)
    localStorage.setItem(ACCENT_STORAGE_KEY, accentColor)
  }, [accentColor])

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      accentColor,
      setAccentColor,
      isDark,
    }),
    [accentColor, isDark, theme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used inside ThemeProvider')
  return value
}
