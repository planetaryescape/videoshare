'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Copy, ExternalLink, MoreVertical, Trash2, Edit2, Eye, EyeOff, Check } from 'lucide-react'

interface Video {
  id: string
  title: string
  filename: string
  thumbnailUrl: string
  uploadDate: Date
  fileSize: number
  isDraft: boolean
  folderId: string | null
  folderName: string | null
}

interface VideoListProps {
  videos: Video[]
  folders: Array<{ id: string; name: string }>
}

type SortOption = 'date-desc' | 'date-asc' | 'name-asc' | 'name-desc'

export function VideoList({ videos: initialVideos, folders }: VideoListProps) {
  const [videos, setVideos] = useState(initialVideos)
  const [sortBy, setSortBy] = useState<SortOption>('date-desc')
  const [filterFolder, setFilterFolder] = useState<string>('all')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB'
  }

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(date)
  }

  const copyShareLink = async (videoId: string) => {
    const shareUrl = `${window.location.origin}/watch/${videoId}`
    await navigator.clipboard.writeText(shareUrl)
    setCopiedId(videoId)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const toggleDraft = async (videoId: string) => {
    // TODO: Update database
    setVideos(prev =>
      prev.map(v => (v.id === videoId ? { ...v, isDraft: !v.isDraft } : v))
    )
  }

  const deleteVideo = async (videoId: string) => {
    if (confirm('Are you sure you want to delete this video?')) {
      // TODO: Delete from database and storage
      setVideos(prev => prev.filter(v => v.id !== videoId))
    }
  }

  // Apply filters and sorting
  const filteredAndSorted = videos
    .filter(video => {
      if (filterFolder === 'all') return true
      if (filterFolder === 'none') return video.folderId === null
      return video.folderId === filterFolder
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'date-desc':
          return b.uploadDate.getTime() - a.uploadDate.getTime()
        case 'date-asc':
          return a.uploadDate.getTime() - b.uploadDate.getTime()
        case 'name-asc':
          return a.title.localeCompare(b.title)
        case 'name-desc':
          return b.title.localeCompare(a.title)
        default:
          return 0
      }
    })

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="flex-1 min-w-[200px]">
          <Select value={filterFolder} onValueChange={setFilterFolder}>
            <SelectTrigger className="border-2 shadow-brutal">
              <SelectValue placeholder="All folders" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All folders</SelectItem>
              <SelectItem value="none">No folder</SelectItem>
              {folders.map(folder => (
                <SelectItem key={folder.id} value={folder.id}>
                  {folder.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 min-w-[200px]">
          <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortOption)}>
            <SelectTrigger className="border-2 shadow-brutal">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date-desc">Newest first</SelectItem>
              <SelectItem value="date-asc">Oldest first</SelectItem>
              <SelectItem value="name-asc">Name (A-Z)</SelectItem>
              <SelectItem value="name-desc">Name (Z-A)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Video Grid */}
      {filteredAndSorted.length === 0 ? (
        <div className="text-center py-12 bg-card border-2 border-dashed border-border rounded-lg">
          <p className="text-muted-foreground">No videos found</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredAndSorted.map(video => (
            <div
              key={video.id}
              className="bg-card border-2 border-border rounded-lg overflow-hidden shadow-brutal hover:shadow-brutal-lg transition-shadow"
            >
              {/* Thumbnail */}
              <div className="relative aspect-video bg-muted">
                <Image
                  src={video.thumbnailUrl || "/placeholder.svg"}
                  alt={video.title}
                  fill
                  className="object-cover"
                />
                {video.isDraft && (
                  <Badge className="absolute top-2 right-2 bg-muted text-muted-foreground border-2">
                    Draft
                  </Badge>
                )}
              </div>

              {/* Content */}
              <div className="p-4 space-y-3">
                <div>
                  <h3 className="font-semibold text-lg line-clamp-2 mb-1">
                    {video.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">{video.filename}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{formatDate(video.uploadDate)}</span>
                  <span>•</span>
                  <span>{formatFileSize(video.fileSize)}</span>
                  {video.folderName && (
                    <>
                      <span>•</span>
                      <Badge variant="outline" className="text-xs">
                        {video.folderName}
                      </Badge>
                    </>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => copyShareLink(video.id)}
                    className="flex-1 shadow-brutal"
                    disabled={video.isDraft}
                  >
                    {copiedId === video.id ? (
                      <>
                        <Check className="mr-2 h-4 w-4" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="mr-2 h-4 w-4" />
                        Copy Link
                      </>
                    )}
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline" className="border-2 shadow-brutal">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="border-2">
                      <DropdownMenuItem onClick={() => window.open(`/watch/${video.id}`, '_blank')}>
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Open
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => toggleDraft(video.id)}>
                        {video.isDraft ? (
                          <>
                            <Eye className="mr-2 h-4 w-4" />
                            Publish
                          </>
                        ) : (
                          <>
                            <EyeOff className="mr-2 h-4 w-4" />
                            Unpublish
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => deleteVideo(video.id)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
