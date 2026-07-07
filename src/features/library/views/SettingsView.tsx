import type { AccentColor } from '../../../context/ThemeContext'
import type { AppSettings, BookDetail, BookPatch, DiscoveredFile, LibraryFolder, MatchPreview, MatchResult } from '../../../lib/types'
import type {
  CsvImportProgressState,
  CsvTransferNotice,
  KeyTestNotice,
  LibraryThingNotice,
  MaintenanceNotice,
  MatchDraft,
  MatchNotice,
} from '../model/types'
import { LibrarySourcesSection } from '../components/settings/LibrarySourcesSection'
import { MaintenanceSection } from '../components/settings/MaintenanceSection'
import { IntegrationsSection } from '../components/settings/IntegrationsSection'
import { AppearanceSection } from '../components/settings/AppearanceSection'
import { UnresolvedFilesSection } from '../components/UnresolvedFilesSection'

type SettingsViewProps = {
  theme: 'light' | 'dark' | 'system'
  accentColor: AccentColor
  accentColors: AccentColor[]
  accentSwatch: Record<AccentColor, string>
  isAccentOpen: boolean
  onSetTheme: (value: 'light' | 'dark' | 'system') => void
  onToggleAccentOpen: () => void
  onSetAccentColor: (value: AccentColor) => void
  onCloseAccentOpen: () => void
  googleBooksApiKeyInput: string
  onSetGoogleBooksApiKeyInput: (value: string) => void
  onSaveGoogleBooksApiKey: () => void
  onTestGoogleBooksApiKey: () => void
  onClearGoogleBooksApiKey: () => void
  libraryThingCatalogLabelInput: string
  onSetLibraryThingCatalogLabelInput: (value: string) => void
  onSaveLibraryThingCatalogLabel: () => void
  onSetLibraryThingEnabled: (enabled: boolean) => void
  onImportLibraryThingExport: () => void
  onClearLibraryThingIntegration: () => void
  appSettings?: AppSettings
  onSetScanOnStartup: (enabled: boolean) => void
  isSetScanOnStartupPending: boolean
  keyTestNotice: KeyTestNotice | null
  libraryThingNotice: LibraryThingNotice | null
  isSetGoogleBooksApiKeyPending: boolean
  isClearGoogleBooksApiKeyPending: boolean
  isTestGoogleBooksApiKeyPending: boolean
  isSetLibraryThingEnabledPending: boolean
  isSetLibraryThingCatalogLabelPending: boolean
  isImportLibraryThingPending: boolean
  isClearLibraryThingPending: boolean
  folderPath: string
  onSetFolderPath: (value: string) => void
  onBrowseForFolder: () => void
  onQuickAddBooks: () => void
  onAddFolder: () => void
  folders: LibraryFolder[]
  onScanFolder: (folderId: string) => void
  onRemoveFolder: (folderId: string) => void
  isScanningFolder: boolean
  isAddingFolder: boolean
  isRemovingFolder: boolean
  onRescanMissingMetadata: () => void
  isRescanMissingMetadataPending: boolean
  onRefreshMissingCovers: () => void
  isRefreshMissingCoversPending: boolean
  onReconcileLocalFiles: () => void
  isReconcileLocalFilesPending: boolean
  maintenanceNotice: MaintenanceNotice | null
  onExportUnresolvedCsv: () => Promise<void>
  onImportEnrichmentCsv: () => Promise<void>
  isExportPending: boolean
  isImportPending: boolean
  csvTransferNotice: CsvTransferNotice | null
  csvImportProgress: CsvImportProgressState
  discoveredQuery: string
  onSetDiscoveredQuery: (value: string) => void
  matchNotice: MatchNotice | null
  discoveredItems: DiscoveredFile[]
  matchDrafts: Record<string, MatchDraft>
  onSetMatchDraft: (fileId: string, patch: MatchDraft) => void
  onPreviewMatch: (input: { fileId: string; title?: string; author?: string; isbn?: string }) => Promise<MatchPreview>
  onConfirmMatch: (input: { fileId: string; title?: string; author?: string; isbn?: string }) => Promise<MatchResult>
  onCreateManualBook: (input: { fileId: string; patch: BookPatch; tags: string[] }) => Promise<BookDetail>
  onAttemptMatchAll: () => void
  isPreviewMatchPending: boolean
  isAttemptMatchPending: boolean
  isAttemptMatchAllPending: boolean
  matchingFileId: string | null
  discoveredPage: number
  discoveredPages: number
  onPreviousDiscoveredPage: () => void
  onNextDiscoveredPage: () => void
}

export function SettingsView(props: SettingsViewProps) {
  return (
    <div className="space-y-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <LibrarySourcesSection
          folderPath={props.folderPath}
          onSetFolderPath={props.onSetFolderPath}
          onBrowseForFolder={props.onBrowseForFolder}
          onQuickAddBooks={props.onQuickAddBooks}
          onAddFolder={props.onAddFolder}
          folders={props.folders}
          onScanFolder={props.onScanFolder}
          onRemoveFolder={props.onRemoveFolder}
          isScanningFolder={props.isScanningFolder}
          isAddingFolder={props.isAddingFolder}
          isRemovingFolder={props.isRemovingFolder}
        />

        <MaintenanceSection
          appSettings={props.appSettings}
          onSetScanOnStartup={props.onSetScanOnStartup}
          isSetScanOnStartupPending={props.isSetScanOnStartupPending}
          onRescanMissingMetadata={props.onRescanMissingMetadata}
          isRescanMissingMetadataPending={props.isRescanMissingMetadataPending}
          onRefreshMissingCovers={props.onRefreshMissingCovers}
          isRefreshMissingCoversPending={props.isRefreshMissingCoversPending}
          onReconcileLocalFiles={props.onReconcileLocalFiles}
          isReconcileLocalFilesPending={props.isReconcileLocalFilesPending}
          maintenanceNotice={props.maintenanceNotice}
          onExportUnresolvedCsv={props.onExportUnresolvedCsv}
          onImportEnrichmentCsv={props.onImportEnrichmentCsv}
          isExportPending={props.isExportPending}
          isImportPending={props.isImportPending}
          csvTransferNotice={props.csvTransferNotice}
          csvImportProgress={props.csvImportProgress}
        />

        <IntegrationsSection
          googleBooksApiKeyInput={props.googleBooksApiKeyInput}
          onSetGoogleBooksApiKeyInput={props.onSetGoogleBooksApiKeyInput}
          onSaveGoogleBooksApiKey={props.onSaveGoogleBooksApiKey}
          onTestGoogleBooksApiKey={props.onTestGoogleBooksApiKey}
          onClearGoogleBooksApiKey={props.onClearGoogleBooksApiKey}
          libraryThingCatalogLabelInput={props.libraryThingCatalogLabelInput}
          onSetLibraryThingCatalogLabelInput={props.onSetLibraryThingCatalogLabelInput}
          onSaveLibraryThingCatalogLabel={props.onSaveLibraryThingCatalogLabel}
          onSetLibraryThingEnabled={props.onSetLibraryThingEnabled}
          onImportLibraryThingExport={props.onImportLibraryThingExport}
          onClearLibraryThingIntegration={props.onClearLibraryThingIntegration}
          appSettings={props.appSettings}
          keyTestNotice={props.keyTestNotice}
          libraryThingNotice={props.libraryThingNotice}
          isSetGoogleBooksApiKeyPending={props.isSetGoogleBooksApiKeyPending}
          isClearGoogleBooksApiKeyPending={props.isClearGoogleBooksApiKeyPending}
          isTestGoogleBooksApiKeyPending={props.isTestGoogleBooksApiKeyPending}
          isSetLibraryThingEnabledPending={props.isSetLibraryThingEnabledPending}
          isSetLibraryThingCatalogLabelPending={props.isSetLibraryThingCatalogLabelPending}
          isImportLibraryThingPending={props.isImportLibraryThingPending}
          isClearLibraryThingPending={props.isClearLibraryThingPending}
        />

        <AppearanceSection
          theme={props.theme}
          accentColor={props.accentColor}
          accentColors={props.accentColors}
          accentSwatch={props.accentSwatch}
          isAccentOpen={props.isAccentOpen}
          onSetTheme={props.onSetTheme}
          onToggleAccentOpen={props.onToggleAccentOpen}
          onSetAccentColor={props.onSetAccentColor}
          onCloseAccentOpen={props.onCloseAccentOpen}
        />
      </div>

      <div className="mx-auto w-full max-w-7xl">
        <UnresolvedFilesSection
          discoveredQuery={props.discoveredQuery}
          onSetDiscoveredQuery={props.onSetDiscoveredQuery}
          matchNotice={props.matchNotice}
          discoveredItems={props.discoveredItems}
          matchDrafts={props.matchDrafts}
          onSetMatchDraft={props.onSetMatchDraft}
          onPreviewMatch={props.onPreviewMatch}
          onConfirmMatch={props.onConfirmMatch}
          onCreateManualBook={props.onCreateManualBook}
          onAttemptMatchAll={props.onAttemptMatchAll}
          isPreviewMatchPending={props.isPreviewMatchPending}
          isAttemptMatchPending={props.isAttemptMatchPending}
          isAttemptMatchAllPending={props.isAttemptMatchAllPending}
          matchingFileId={props.matchingFileId}
          discoveredPage={props.discoveredPage}
          discoveredPages={props.discoveredPages}
          onPreviousDiscoveredPage={props.onPreviousDiscoveredPage}
          onNextDiscoveredPage={props.onNextDiscoveredPage}
        />
      </div>
    </div>
  )
}
