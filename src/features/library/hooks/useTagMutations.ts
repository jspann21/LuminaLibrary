import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import type { TagCount } from '../../../lib/types'
import type { ConfirmDialogState } from '../model/types'

export function useTagMutations(deps: {
    tags: TagCount[]
    selectedTag: string | undefined
    setSelectedTag: (tag: string | undefined) => void
    setScanStatus: React.Dispatch<React.SetStateAction<string>>
    invalidateLibraryData: () => void
    openConfirmDialog: (dialog: ConfirmDialogState) => void
}) {
    const { tags, selectedTag, setSelectedTag, setScanStatus, invalidateLibraryData, openConfirmDialog } = deps

    const [tagManagerQuery, setTagManagerQuery] = useState('')
    const [tagManagerSelection, setTagManagerSelection] = useState<string[]>([])
    const [tagMergeTarget, setTagMergeTarget] = useState('')

    const availableTagSet = useMemo(() => {
        const set = new Set<string>()
        for (const item of tags) {
            set.add(item.tag)
        }
        return set
    }, [tags])
    const effectiveTagManagerSelection = useMemo(
        () => tagManagerSelection.filter((item) => availableTagSet.has(item)),
        [tagManagerSelection, availableTagSet],
    )
    const tagManagerFiltered = useMemo(() => {
        const search = tagManagerQuery.trim().toLowerCase()
        if (!search) return tags
        return tags.filter((item) => item.tag.toLowerCase().includes(search))
    }, [tags, tagManagerQuery])
    const tagManagerSelectionSet = useMemo(
        () => new Set(effectiveTagManagerSelection),
        [effectiveTagManagerSelection],
    )

    const mergeTagsMutation = useMutation({
        mutationFn: (input: { sourceTags: string[]; targetTag: string }) =>
            api.mergeTags(input.sourceTags, input.targetTag),
        onSuccess: (result, input) => {
            setTagMergeTarget(result.targetTag)
            setTagManagerSelection([result.targetTag])
            if (selectedTag && input.sourceTags.some((tag) => tag.toLowerCase() === selectedTag.toLowerCase())) {
                setSelectedTag(result.targetTag)
            }
            setScanStatus(
                `Merged ${result.mergedTagCount} tags into "${result.targetTag}" across ${result.affectedBooks} books`,
            )
            invalidateLibraryData()
        },
    })
    const deleteTagsMutation = useMutation({
        mutationFn: (tags: string[]) => api.deleteTags(tags),
        onSuccess: (result, deletedTags) => {
            setTagManagerSelection([])
            if (selectedTag && deletedTags.some((tag) => tag.toLowerCase() === selectedTag.toLowerCase())) {
                setSelectedTag(undefined)
            }
            setScanStatus(`Deleted ${result.deletedTagCount} tags from ${result.affectedBooks} books`)
            invalidateLibraryData()
        },
    })

    const mergeSelectedTags = () => {
        if (effectiveTagManagerSelection.length === 0) return
        const targetTag = tagMergeTarget.trim()
        if (!targetTag) {
            setScanStatus('Enter a target tag to merge into')
            return
        }
        openConfirmDialog({
            title: 'Merge selected tags?',
            message: `Merge ${effectiveTagManagerSelection.length} selected tag(s) into "${targetTag}"? This will update all tagged books.`,
            confirmLabel: 'Merge Tags',
            tone: 'warning',
            onConfirm: () => mergeTagsMutation.mutate({ sourceTags: effectiveTagManagerSelection, targetTag }),
        })
    }

    const deleteSelectedTags = () => {
        if (effectiveTagManagerSelection.length === 0) return
        openConfirmDialog({
            title: 'Delete selected tags?',
            message: `Delete ${effectiveTagManagerSelection.length} selected tag(s)? This removes these tags from every book.`,
            confirmLabel: 'Delete Tags',
            tone: 'danger',
            onConfirm: () => deleteTagsMutation.mutate(effectiveTagManagerSelection),
        })
    }

    const toggleTagManagerSelection = (tag: string) => {
        setTagManagerSelection((current) => {
            const pruned = current.filter((item) => availableTagSet.has(item))
            return pruned.includes(tag) ? pruned.filter((item) => item !== tag) : [...pruned, tag]
        })
    }

    return {
        tagManagerQuery,
        setTagManagerQuery,
        tagMergeTarget,
        setTagMergeTarget,
        tagManagerFiltered,
        tagManagerSelectionSet,
        effectiveTagManagerSelection,
        mergeTagsMutation,
        deleteTagsMutation,
        mergeSelectedTags,
        deleteSelectedTags,
        toggleTagManagerSelection,
        setTagManagerSelection,
    }
}
