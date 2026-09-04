import { Check, ChevronDown, Monitor, Moon, Sun } from 'lucide-react'
import type { AccentColor } from '../../../../context/ThemeContext'
import { cx } from '../../lib/cx'

type AppearanceSectionProps = {
    theme: 'light' | 'dark' | 'system'
    accentColor: AccentColor
    accentColors: AccentColor[]
    accentSwatch: Record<AccentColor, string>
    isAccentOpen: boolean
    onSetTheme: (value: 'light' | 'dark' | 'system') => void
    onToggleAccentOpen: () => void
    onSetAccentColor: (value: AccentColor) => void
    onCloseAccentOpen: () => void
}

export function AppearanceSection({
    theme,
    accentColor,
    accentColors,
    accentSwatch,
    isAccentOpen,
    onSetTheme,
    onToggleAccentOpen,
    onSetAccentColor,
    onCloseAccentOpen,
}: AppearanceSectionProps) {
    return (
        <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            <div className="border-b border-slate-100 p-6 dark:border-slate-700/60">
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">Appearance</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">Customize how the application looks</p>
            </div>
            <div className="space-y-6 p-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100">Theme</h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Select your preferred color scheme</p>
                    </div>
                    <div className="flex items-center rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-700/60 dark:bg-slate-800/60">
                        <button onClick={() => onSetTheme('light')} className={cx('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors', theme === 'light' ? 'bg-white text-accent-600 dark:bg-slate-700 dark:text-accent-300' : 'text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700/70 dark:hover:text-slate-200')}><Sun size={14} />Light</button>
                        <button onClick={() => onSetTheme('dark')} className={cx('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors', theme === 'dark' ? 'bg-white text-accent-600 dark:bg-slate-700 dark:text-accent-300' : 'text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700/70 dark:hover:text-slate-200')}><Moon size={14} />Dark</button>
                        <button onClick={() => onSetTheme('system')} className={cx('flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors', theme === 'system' ? 'bg-white text-accent-600 dark:bg-slate-700 dark:text-accent-300' : 'text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700/70 dark:hover:text-slate-200')}><Monitor size={14} />System</button>
                    </div>
                </div>

                <div className="border-t border-slate-100 pt-6 dark:border-slate-700/60">
                    <h4 className="mb-3 text-sm font-medium text-slate-900 dark:text-slate-100">Accent Color</h4>
                    <div className="relative inline-block">
                        <button
                            type="button"
                            onClick={onToggleAccentOpen}
                            onBlur={() => setTimeout(onCloseAccentOpen, 200)}
                            aria-controls="accent-color-options"
                            aria-expanded={isAccentOpen}
                            aria-haspopup="listbox"
                            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                        >
                            <span className="h-6 w-6 rounded-full border border-slate-200 dark:border-slate-600" style={{ backgroundColor: accentSwatch[accentColor] }} />
                            <span className="capitalize">{accentColor}</span>
                            <ChevronDown size={16} className="text-slate-400" />
                        </button>
                        {isAccentOpen ? (
                            <div id="accent-color-options" role="listbox" aria-label="Accent colors" className="absolute left-0 top-full z-30 mt-2 grid w-64 grid-cols-5 gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-800">
                                {accentColors.map((color) => (
                                    <button
                                        key={color}
                                        type="button"
                                        role="option"
                                        aria-label={`${color} accent color`}
                                        aria-selected={accentColor === color}
                                        onClick={() => onSetAccentColor(color)}
                                        className={cx('flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 dark:border-slate-700', accentColor === color ? 'ring-2 ring-accent-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-800' : '')}
                                        style={{ backgroundColor: accentSwatch[color] }}
                                    >
                                        {accentColor === color ? <Check size={14} className="text-white" /> : null}
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </section>
    )
}
