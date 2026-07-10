import { BookOpen, Trash2, Upload } from 'lucide-react'
import { cx } from '../../lib/cx'
import type { AppSettings } from '../../../../lib/types'
import type { KeyTestNotice, LibraryThingNotice } from '../../model/types'

type IntegrationsSectionProps = {
    googleBooksApiKeyInput: string
    onSetGoogleBooksApiKeyInput: (value: string) => void
    onSaveGoogleBooksApiKey: () => void
    onTestGoogleBooksApiKey: () => void
    onClearGoogleBooksApiKey: () => void
    braveSearchApiKeyInput: string
    onSetBraveSearchApiKeyInput: (value: string) => void
    onSaveBraveSearchApiKey: () => void
    onTestBraveSearchApiKey: () => void
    onClearBraveSearchApiKey: () => void
    libraryThingCatalogLabelInput: string
    onSetLibraryThingCatalogLabelInput: (value: string) => void
    onSaveLibraryThingCatalogLabel: () => void
    onSetLibraryThingEnabled: (enabled: boolean) => void
    onImportLibraryThingExport: () => void
    onClearLibraryThingIntegration: () => void
    appSettings?: AppSettings
    keyTestNotice: KeyTestNotice | null
    braveKeyTestNotice: KeyTestNotice | null
    libraryThingNotice: LibraryThingNotice | null
    isSetGoogleBooksApiKeyPending: boolean
    isClearGoogleBooksApiKeyPending: boolean
    isTestGoogleBooksApiKeyPending: boolean
    isSetBraveSearchApiKeyPending: boolean
    isClearBraveSearchApiKeyPending: boolean
    isTestBraveSearchApiKeyPending: boolean
    isSetLibraryThingEnabledPending: boolean
    isSetLibraryThingCatalogLabelPending: boolean
    isImportLibraryThingPending: boolean
    isClearLibraryThingPending: boolean
}

export function IntegrationsSection({
    googleBooksApiKeyInput,
    onSetGoogleBooksApiKeyInput,
    onSaveGoogleBooksApiKey,
    onTestGoogleBooksApiKey,
    onClearGoogleBooksApiKey,
    braveSearchApiKeyInput,
    onSetBraveSearchApiKeyInput,
    onSaveBraveSearchApiKey,
    onTestBraveSearchApiKey,
    onClearBraveSearchApiKey,
    libraryThingCatalogLabelInput,
    onSetLibraryThingCatalogLabelInput,
    onSaveLibraryThingCatalogLabel,
    onSetLibraryThingEnabled,
    onImportLibraryThingExport,
    onClearLibraryThingIntegration,
    appSettings,
    keyTestNotice,
    braveKeyTestNotice,
    libraryThingNotice,
    isSetGoogleBooksApiKeyPending,
    isClearGoogleBooksApiKeyPending,
    isTestGoogleBooksApiKeyPending,
    isSetBraveSearchApiKeyPending,
    isClearBraveSearchApiKeyPending,
    isTestBraveSearchApiKeyPending,
    isSetLibraryThingEnabledPending,
    isSetLibraryThingCatalogLabelPending,
    isImportLibraryThingPending,
    isClearLibraryThingPending,
}: IntegrationsSectionProps) {
    const libraryThingBusy = isSetLibraryThingEnabledPending || isSetLibraryThingCatalogLabelPending || isImportLibraryThingPending || isClearLibraryThingPending
    const libraryThingEnabled = appSettings?.libraryThingEnabled ?? false
    const libraryThingHasData = (appSettings?.libraryThingBookCount ?? 0) > 0

    return (
        <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            <div className="border-b border-slate-100 p-6 dark:border-slate-700/60">
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">Integrations</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">Configure external APIs used for metadata and cover lookups</p>
            </div>
            <div className="space-y-4 p-6">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                    <label htmlFor="google-books-api-key" className="block text-sm font-medium text-slate-900 dark:text-slate-100">Google Books API Key</label>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Stored in your OS credential manager (Windows Credential Manager, macOS Keychain, or Linux Secret Service). The key is never shown after save.
                    </p>
                    <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_auto_auto]">
                        <input
                            id="google-books-api-key"
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

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                    <label htmlFor="brave-search-api-key" className="block text-sm font-medium text-slate-900 dark:text-slate-100">Brave Image Search API Key</label>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Enables image results inside the cover picker. Create a key from the Brave Search API dashboard; Lumina stores it in your OS credential manager and never shows it after save.
                    </p>
                    <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto_auto_auto]">
                        <input
                            id="brave-search-api-key"
                            type="password"
                            autoComplete="off"
                            spellCheck={false}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                            placeholder="Brave Search API key"
                            value={braveSearchApiKeyInput}
                            onChange={(event) => onSetBraveSearchApiKeyInput(event.target.value)}
                        />
                        <button
                            className="rounded-lg bg-accent-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 disabled:pointer-events-none disabled:opacity-50"
                            disabled={isSetBraveSearchApiKeyPending || isClearBraveSearchApiKeyPending || isTestBraveSearchApiKeyPending}
                            onClick={onSaveBraveSearchApiKey}
                        >
                            {isSetBraveSearchApiKeyPending ? 'Saving...' : 'Save Key'}
                        </button>
                        <button
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-45 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
                            disabled={isSetBraveSearchApiKeyPending || isClearBraveSearchApiKeyPending || isTestBraveSearchApiKeyPending}
                            onClick={onTestBraveSearchApiKey}
                        >
                            {isTestBraveSearchApiKeyPending ? 'Testing...' : 'Test Key'}
                        </button>
                        <button
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-45 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
                            disabled={!appSettings?.braveSearchApiKeyConfigured || isSetBraveSearchApiKeyPending || isClearBraveSearchApiKeyPending || isTestBraveSearchApiKeyPending}
                            onClick={onClearBraveSearchApiKey}
                        >
                            {isClearBraveSearchApiKeyPending ? 'Clearing...' : 'Clear Key'}
                        </button>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <span
                            className={cx(
                                'rounded-full px-2 py-1',
                                appSettings?.braveSearchApiKeyConfigured
                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                    : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
                            )}
                        >
                            {appSettings?.braveSearchApiKeyConfigured ? 'Key configured' : 'No key configured'}
                        </span>
                        {appSettings?.braveSearchApiKeyManagedByApp ? (
                            <span className="rounded-full bg-sky-100 px-2 py-1 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
                                Managed by app secure storage
                            </span>
                        ) : null}
                        {appSettings?.braveSearchApiKeyFromEnvironment ? (
                            <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                Environment variable fallback active
                            </span>
                        ) : null}
                    </div>

                    {braveKeyTestNotice ? (
                        <div
                            className={cx(
                                'mt-3 rounded-lg border px-3 py-2 text-sm',
                                braveKeyTestNotice.tone === 'loading' &&
                                'border-accent-300 bg-accent-50 text-accent-700 dark:border-accent-800 dark:bg-accent-900/20 dark:text-accent-300',
                                braveKeyTestNotice.tone === 'success' &&
                                'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300',
                                braveKeyTestNotice.tone === 'error' &&
                                'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300',
                            )}
                        >
                            {braveKeyTestNotice.message}
                        </div>
                    ) : null}
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/30">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100">LibraryThing</h4>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                Import a LibraryThing JSON or tab-delimited export. No LibraryThing password is stored.
                            </p>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={libraryThingEnabled}
                            disabled={!appSettings || libraryThingBusy}
                            onClick={() => onSetLibraryThingEnabled(!libraryThingEnabled)}
                            className={cx(
                                'relative mt-1 inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 disabled:pointer-events-none disabled:opacity-60',
                                libraryThingEnabled
                                    ? 'border-accent-500 bg-accent-500'
                                    : 'border-slate-300 bg-slate-200 dark:border-slate-600 dark:bg-slate-700',
                            )}
                            title={libraryThingEnabled ? 'Disable LibraryThing integration' : 'Enable LibraryThing integration'}
                        >
                            <span
                                className={cx(
                                    'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
                                    libraryThingEnabled ? 'translate-x-6' : 'translate-x-1',
                                )}
                            />
                        </button>
                    </div>

                    <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
                        <input
                            id="librarything-catalog-label"
                            type="text"
                            autoComplete="off"
                            spellCheck={false}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
                            placeholder="Optional catalog label or username"
                            value={libraryThingCatalogLabelInput}
                            onChange={(event) => onSetLibraryThingCatalogLabelInput(event.target.value)}
                        />
                        <button
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-45 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
                            disabled={libraryThingBusy}
                            onClick={onSaveLibraryThingCatalogLabel}
                        >
                            {isSetLibraryThingCatalogLabelPending ? 'Saving...' : 'Save Label'}
                        </button>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                        <button
                            className="inline-flex items-center gap-2 rounded-lg bg-accent-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 disabled:pointer-events-none disabled:opacity-50"
                            disabled={libraryThingBusy}
                            onClick={onImportLibraryThingExport}
                        >
                            <Upload size={16} />
                            {isImportLibraryThingPending ? 'Importing...' : 'Import LibraryThing'}
                        </button>
                        <button
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-45 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
                            disabled={!libraryThingHasData || libraryThingBusy}
                            onClick={onClearLibraryThingIntegration}
                        >
                            <Trash2 size={16} />
                            {isClearLibraryThingPending ? 'Clearing...' : 'Clear'}
                        </button>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <span
                            className={cx(
                                'inline-flex items-center gap-1 rounded-full px-2 py-1',
                                libraryThingEnabled
                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                                    : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
                            )}
                        >
                            <BookOpen size={12} />
                            {libraryThingEnabled ? 'Integration on' : 'Integration off'}
                        </span>
                        <span className="rounded-full bg-slate-200 px-2 py-1 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                            {appSettings?.libraryThingBookCount ?? 0} linked books
                        </span>
                        {appSettings?.libraryThingLastImportAt ? (
                            <span className="rounded-full bg-sky-100 px-2 py-1 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
                                Imported {new Date(appSettings.libraryThingLastImportAt).toLocaleString()}
                            </span>
                        ) : null}
                    </div>

                    {libraryThingNotice ? (
                        <div
                            className={cx(
                                'mt-3 rounded-lg border px-3 py-2 text-sm',
                                libraryThingNotice.tone === 'loading' &&
                                'border-accent-300 bg-accent-50 text-accent-700 dark:border-accent-800 dark:bg-accent-900/20 dark:text-accent-300',
                                libraryThingNotice.tone === 'success' &&
                                'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300',
                                libraryThingNotice.tone === 'error' &&
                                'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300',
                            )}
                        >
                            {libraryThingNotice.message}
                        </div>
                    ) : null}
                </div>
            </div>
        </section>
    )
}
