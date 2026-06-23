/* eslint-disable react-hooks/refs */
import { lazy, Suspense } from 'react'
import { AnimatePresence } from 'motion/react'
import { Minus, Plus } from 'lucide-react'
import { ConfirmDialog } from './features/library/components/ConfirmDialog'
import { LibraryHeader } from './features/library/components/LibraryHeader'
import { LibrarySidebar } from './features/library/components/LibrarySidebar'
import { LibraryView } from './features/library/views/LibraryView'
import { useLibraryAppController } from './features/library/hooks/useLibraryAppController'
import { cx } from './features/library/lib/cx'

const BOTTOM_OVERLAY_CLASSES = ['bottom-6', 'bottom-32', 'bottom-[14.5rem]', 'bottom-[21rem]'] as const
const BookDetailsPanel = lazy(() =>
  import('./features/library/components/BookDetailsPanel').then((module) => ({ default: module.BookDetailsPanel })),
)
const BulkMatchProgressOverlay = lazy(() =>
  import('./features/library/components/overlays/BulkMatchProgressOverlay').then((module) => ({
    default: module.BulkMatchProgressOverlay,
  })),
)
const CoverRefreshOverlay = lazy(() =>
  import('./features/library/components/overlays/CoverRefreshOverlay').then((module) => ({
    default: module.CoverRefreshOverlay,
  })),
)
const CsvImportProgressOverlay = lazy(() =>
  import('./features/library/components/overlays/CsvImportProgressOverlay').then((module) => ({
    default: module.CsvImportProgressOverlay,
  })),
)
const ScanProgressOverlay = lazy(() =>
  import('./features/library/components/overlays/ScanProgressOverlay').then((module) => ({
    default: module.ScanProgressOverlay,
  })),
)
const SettingsView = lazy(() =>
  import('./features/library/views/SettingsView').then((module) => ({ default: module.SettingsView })),
)
const TagManagerView = lazy(() =>
  import('./features/library/views/TagManagerView').then((module) => ({ default: module.TagManagerView })),
)

function App() {
  const controller = useLibraryAppController()
  const { layout, sidebar, header, libraryView, tagView, settingsView, detailsPanel, overlays, confirmDialog } = controller
  const activeView = layout.activeView
  const scrollContainerRef = layout.scrollContainerRef
  const bottomOverlayKeys = [
    overlays.showBulkMatchProgressPopup ? 'bulk-match' : null,
    overlays.showScanProgressPopup ? 'scan' : null,
    overlays.showCsvImportProgressPopup ? 'csv-import' : null,
    overlays.coverRefreshNotice ? 'cover-refresh' : null,
  ].filter((key): key is string => Boolean(key))
  const bottomClassFor = (key: string) =>
    BOTTOM_OVERLAY_CLASSES[
      Math.min(Math.max(bottomOverlayKeys.indexOf(key), 0), BOTTOM_OVERLAY_CLASSES.length - 1)
    ]
  const hasBottomOverlay = bottomOverlayKeys.length > 0
  const zoomControlsBottomClass =
    hasBottomOverlay
      ? BOTTOM_OVERLAY_CLASSES[Math.min(bottomOverlayKeys.length, BOTTOM_OVERLAY_CLASSES.length - 1)]
      : 'bottom-6'

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 text-slate-900 transition-colors duration-300 dark:bg-slate-950 dark:text-slate-100">
      <LibrarySidebar {...sidebar} />

      <main className="relative flex min-w-0 flex-1 flex-col">
        <LibraryHeader {...header} />

        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-6">
          {activeView === 'library' ? (
            <LibraryView {...libraryView} />
          ) : activeView === 'tags' ? (
            <Suspense fallback={<ViewFallback />}>
              <TagManagerView {...tagView} />
            </Suspense>
          ) : (
            <Suspense fallback={<ViewFallback />}>
              <SettingsView {...settingsView} />
            </Suspense>
          )}
        </div>

        {overlays.showCoverZoomControls ? (
          <div
            className={cx(
              'absolute right-6 z-40 flex items-center gap-1 rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-lg backdrop-blur-sm dark:border-slate-700 dark:bg-slate-800/95',
              zoomControlsBottomClass,
            )}
          >
            <span className="flex" title={overlays.canZoomOut ? 'Decrease cover size' : 'Minimum cover size reached'}>
              <button
                onClick={overlays.onZoomCoversOut}
                disabled={!overlays.canZoomOut}
                className="rounded-lg p-1.5 text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:text-slate-300 dark:hover:bg-slate-700"
                aria-label="Decrease cover size"
              >
                <Minus size={14} />
              </button>
            </span>
            <span className="min-w-10 text-center text-xs font-semibold text-slate-600 dark:text-slate-300">{overlays.zoomPercent}%</span>
            <span className="flex" title={overlays.canZoomIn ? 'Increase cover size' : 'Maximum cover size reached'}>
              <button
                onClick={overlays.onZoomCoversIn}
                disabled={!overlays.canZoomIn}
                className="rounded-lg p-1.5 text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:text-slate-300 dark:hover:bg-slate-700"
                aria-label="Increase cover size"
              >
                <Plus size={14} />
              </button>
            </span>
          </div>
        ) : null}

        <AnimatePresence>
          {overlays.showBulkMatchProgressPopup ? (
            <Suspense fallback={null}>
              <BulkMatchProgressOverlay
                progress={overlays.bulkMatchProgress}
                progressPercent={overlays.bulkMatchProgressPercent}
                bottomClassName={bottomClassFor('bulk-match')}
                onDismiss={overlays.onDismissBulkMatchProgress}
              />
            </Suspense>
          ) : null}
        </AnimatePresence>

        <AnimatePresence>
          {overlays.showScanProgressPopup ? (
            <Suspense fallback={null}>
              <ScanProgressOverlay
                scanStatus={overlays.scanStatus}
                progressPercent={overlays.progressPercent}
                scanProgress={overlays.scanProgress}
                bottomClassName={bottomClassFor('scan')}
                onDismiss={overlays.onDismissScanProgress}
              />
            </Suspense>
          ) : null}
        </AnimatePresence>

        <AnimatePresence>
          {overlays.showCsvImportProgressPopup ? (
            <Suspense fallback={null}>
              <CsvImportProgressOverlay
                csvImportProgress={overlays.csvImportProgress}
                bottomClassName={bottomClassFor('csv-import')}
                onDismiss={overlays.onDismissCsvImportProgress}
              />
            </Suspense>
          ) : null}
        </AnimatePresence>

        <AnimatePresence>
          {overlays.coverRefreshNotice ? (
            <Suspense fallback={null}>
              <CoverRefreshOverlay
                coverRefreshNotice={overlays.coverRefreshNotice}
                scanStatus={overlays.scanStatus}
                progressPercent={overlays.progressPercent}
                scanProgress={overlays.scanProgress}
                bottomClassName={bottomClassFor('cover-refresh')}
                onDismiss={overlays.onDismissCoverRefreshNotice}
              />
            </Suspense>
          ) : null}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {detailsPanel.isOpen && detailsPanel.book ? (
          <Suspense fallback={null}>
            <BookDetailsPanel
              key={detailsPanel.book.id}
              book={detailsPanel.book}
              onClose={detailsPanel.onClose}
              onSave={detailsPanel.onSave}
              onPreviewRescan={detailsPanel.onPreviewRescan}
              onApplyCuratedMetadata={detailsPanel.onApplyCuratedMetadata}
              onOpenFile={detailsPanel.onOpenFile}
              onOpenFolder={detailsPanel.onOpenFolder}
              onRequestHide={detailsPanel.onRequestHide}
              onRequestDelete={detailsPanel.onRequestDelete}
              isSaving={detailsPanel.isSaving}
              isHiding={detailsPanel.isHiding}
              isRescanPreviewing={detailsPanel.isRescanPreviewing}
              isApplyingCuratedMetadata={detailsPanel.isApplyingCuratedMetadata}
              isDeleting={detailsPanel.isDeleting}
            />
          </Suspense>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {confirmDialog.dialog ? (
          <ConfirmDialog dialog={confirmDialog.dialog} onCancel={confirmDialog.onCancel} onConfirm={confirmDialog.onConfirm} />
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function ViewFallback() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
      Loading...
    </div>
  )
}

export default App
