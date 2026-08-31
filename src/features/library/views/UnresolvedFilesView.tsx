import { UnresolvedFilesSection, type UnresolvedFilesSectionProps } from '../components/UnresolvedFilesSection'

export function UnresolvedFilesView(props: UnresolvedFilesSectionProps) {
  return (
    <div className="mx-auto w-full max-w-7xl">
      <UnresolvedFilesSection {...props} />
    </div>
  )
}
