import { cx } from '../../lib/cx'
import type { AppSettings } from '../../../../lib/types'
import type { KeyTestNotice } from '../../model/types'

type IntegrationsSectionProps = {
    googleBooksApiKeyInput: string
    onSetGoogleBooksApiKeyInput: (value: string) => void
    onSaveGoogleBooksApiKey: () => void
    onTestGoogleBooksApiKey: () => void
    onClearGoogleBooksApiKey: () => void
    appSettings?: AppSettings
    keyTestNotice: KeyTestNotice | null
    isSetGoogleBooksApiKeyPending: boolean
    isClearGoogleBooksApiKeyPending: boolean
    isTestGoogleBooksApiKeyPending: boolean
}

export function IntegrationsSection({
    googleBooksApiKeyInput,
    onSetGoogleBooksApiKeyInput,
    onSaveGoogleBooksApiKey,
    onTestGoogleBooksApiKey,
    onClearGoogleBooksApiKey,
    appSettings,
    keyTestNotice,
    isSetGoogleBooksApiKeyPending,
    isClearGoogleBooksApiKeyPending,
    isTestGoogleBooksApiKeyPending,
}: IntegrationsSectionProps) {
    return (
        <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            <div className="border-b border-slate-100 p-6 dark:border-slate-700/60">
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">Integrations</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">Configure external APIs used for metadata and cover lookups</p>
            </div>
            <div className="space-y-4 p-6">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                    <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100">Google Books API Key</h4>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Stored in your OS credential manager (Windows Credential Manager, macOS Keychain, or Linux Secret Service). The key is never shown after save.
                    </p>
                    <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_auto_auto]">
                        <input
                            type="password"
                            autoComplete="off"
                            spellCheck={false}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                            placeholder="AIza..."
                            value={googleBooksApiKeyInput}
                            onChange={(event) => onSetGoogleBooksApiKeyInput(event.target.value)}
                        />
                        <button
                            className="rounded-lg bg-accent-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 disabled:pointer-events-none disabled:opacity-50"
                            disabled={isSetGoogleBooksApiKeyPending || isClearGoogleBooksApiKeyPending || isTestGoogleBooksApiKeyPending}
                            onClick={onSaveGoogleBooksApiKey}
                        >
                            {isSetGoogleBooksApiKeyPending ? 'Saving...' : 'Save Key'}
                        </button>
                        <button
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-45 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
                            disabled={isSetGoogleBooksApiKeyPending || isClearGoogleBooksApiKeyPending || isTestGoogleBooksApiKeyPending}
                            onClick={onTestGoogleBooksApiKey}
                        >
                            {isTestGoogleBooksApiKeyPending ? 'Testing...' : 'Test Key'}
                        </button>
                        <button
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-45 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
                            disabled={!appSettings?.googleBooksApiKeyConfigured || isSetGoogleBooksApiKeyPending || isClearGoogleBooksApiKeyPending || isTestGoogleBooksApiKeyPending}
                            onClick={onClearGoogleBooksApiKey}
                        >
                            {isClearGoogleBooksApiKeyPending ? 'Clearing...' : 'Clear Key'}
                        </button>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <span
                            className={cx(
                                'rounded-full px-2 py-1',
                                appSettings?.googleBooksApiKeyConfigured
                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                    : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
                            )}
                        >
                            {appSettings?.googleBooksApiKeyConfigured ? 'Key configured' : 'No key configured'}
                        </span>
                        {appSettings?.googleBooksApiKeyManagedByApp ? (
                            <span className="rounded-full bg-sky-100 px-2 py-1 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
                                Managed by app secure storage
                            </span>
                        ) : null}
                        {appSettings?.googleBooksApiKeyFromEnvironment ? (
                            <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                Environment variable fallback active
                            </span>
                        ) : null}
                    </div>

                    {keyTestNotice ? (
                        <div
                            className={cx(
                                'mt-3 rounded-lg border px-3 py-2 text-sm',
                                keyTestNotice.tone === 'loading' &&
                                'border-accent-300 bg-accent-50 text-accent-700 dark:border-accent-800 dark:bg-accent-900/20 dark:text-accent-300',
                                keyTestNotice.tone === 'success' &&
                                'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300',
                                keyTestNotice.tone === 'error' &&
                                'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300',
                            )}
                        >
                            {keyTestNotice.message}
                        </div>
                    ) : null}
                </div>
            </div>
        </section>
    )
}
