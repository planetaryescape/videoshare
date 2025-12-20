'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, X, File, CheckCircle2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface UploadFile {
  file: File
  id: string
  progress: number
  status: 'pending' | 'uploading' | 'complete' | 'error'
  error?: string
  title: string
  folderId?: string
}

interface VideoUploadProps {
  folders: Array<{ id: string; name: string }>
}

export function VideoUpload({ folders }: VideoUploadProps) {
  const router = useRouter()
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([])
  const [isDragging, setIsDragging] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    
    const files = Array.from(e.dataTransfer.files).filter(file => {
      const isVideo = file.type.startsWith('video/')
      return isVideo || file.name.match(/\.(mp4|mov|avi|wmv|flv|webm)$/i)
    })

    addFiles(files)
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFiles(Array.from(e.target.files))
    }
  }

  const addFiles = (files: File[]) => {
    const newUploadFiles: UploadFile[] = files.map(file => ({
      file,
      id: Math.random().toString(36).substring(7),
      progress: 0,
      status: 'pending',
      title: file.name.replace(/\.[^/.]+$/, '') // Remove file extension
    }))

    setUploadFiles(prev => [...prev, ...newUploadFiles])
  }

  const removeFile = (id: string) => {
    setUploadFiles(prev => prev.filter(f => f.id !== id))
  }

  const updateFileTitle = (id: string, title: string) => {
    setUploadFiles(prev =>
      prev.map(f => (f.id === id ? { ...f, title } : f))
    )
  }

  const updateFileFolder = (id: string, folderId: string) => {
    setUploadFiles(prev =>
      prev.map(f => (f.id === id ? { ...f, folderId } : f))
    )
  }

  const uploadFile = async (uploadFile: UploadFile) => {
    setUploadFiles(prev =>
      prev.map(f => (f.id === uploadFile.id ? { ...f, status: 'uploading' } : f))
    )

    // Simulate upload with progress
    // In production, this would use FormData and XMLHttpRequest or a library like tus for resumable uploads
    const formData = new FormData()
    formData.append('video', uploadFile.file)
    formData.append('title', uploadFile.title)
    if (uploadFile.folderId) {
      formData.append('folderId', uploadFile.folderId)
    }

    try {
      // Simulate progress
      for (let progress = 0; progress <= 100; progress += 10) {
        await new Promise(resolve => setTimeout(resolve, 300))
        setUploadFiles(prev =>
          prev.map(f => (f.id === uploadFile.id ? { ...f, progress } : f))
        )
      }

      // TODO: Actual upload to storage (Vercel Blob, S3, etc.)
      const response = await fetch('/api/videos/upload', {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        throw new Error('Upload failed')
      }

      setUploadFiles(prev =>
        prev.map(f =>
          f.id === uploadFile.id ? { ...f, status: 'complete', progress: 100 } : f
        )
      )
    } catch (error) {
      setUploadFiles(prev =>
        prev.map(f =>
          f.id === uploadFile.id
            ? { ...f, status: 'error', error: 'Upload failed. Please try again.' }
            : f
        )
      )
    }
  }

  const uploadAll = async () => {
    const pendingFiles = uploadFiles.filter(f => f.status === 'pending')
    
    // Upload files sequentially (in production, you might want to do this in parallel with a limit)
    for (const file of pendingFiles) {
      await uploadFile(file)
    }

    // Refresh the page after all uploads complete
    setTimeout(() => {
      router.refresh()
    }, 1000)
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB'
  }

  return (
    <div className="space-y-6">
      {/* Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          border-2 border-dashed rounded-lg p-12 text-center transition-colors
          ${isDragging 
            ? 'border-primary bg-primary/5' 
            : 'border-border hover:border-primary/50 hover:bg-primary/5'
          }
        `}
      >
        <Upload className="h-12 w-12 mx-auto mb-4 text-primary" />
        <h3 className="text-lg font-semibold mb-2">Drop videos here</h3>
        <p className="text-sm text-muted-foreground mb-4">
          or click to browse files
        </p>
        <Input
          type="file"
          accept="video/*,.mp4,.mov,.avi,.wmv,.flv,.webm"
          multiple
          onChange={handleFileSelect}
          className="hidden"
          id="file-upload"
        />
        <Button asChild variant="outline" className="border-2">
          <label htmlFor="file-upload" className="cursor-pointer">
            Select Files
          </label>
        </Button>
        <p className="text-xs text-muted-foreground mt-4">
          Supported formats: MP4, MOV, AVI, WMV, FLV, WebM
        </p>
      </div>

      {/* Upload Queue */}
      {uploadFiles.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">
              Upload Queue ({uploadFiles.length} {uploadFiles.length === 1 ? 'file' : 'files'})
            </h3>
            <Button
              onClick={uploadAll}
              disabled={uploadFiles.every(f => f.status !== 'pending')}
              className="shadow-brutal"
            >
              Upload All
            </Button>
          </div>

          <div className="space-y-3">
            {uploadFiles.map(uploadFile => (
              <div
                key={uploadFile.id}
                className="bg-card border-2 border-border rounded-lg p-4 shadow-brutal"
              >
                <div className="flex items-start gap-4">
                  <div className="shrink-0">
                    {uploadFile.status === 'complete' && (
                      <CheckCircle2 className="h-6 w-6 text-secondary" />
                    )}
                    {uploadFile.status === 'error' && (
                      <AlertCircle className="h-6 w-6 text-destructive" />
                    )}
                    {(uploadFile.status === 'pending' || uploadFile.status === 'uploading') && (
                      <File className="h-6 w-6 text-muted-foreground" />
                    )}
                  </div>

                  <div className="flex-1 space-y-3">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor={`title-${uploadFile.id}`} className="text-sm font-medium">
                          Title
                        </Label>
                        {uploadFile.status === 'pending' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeFile(uploadFile.id)}
                            className="h-6 w-6 p-0"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      <Input
                        id={`title-${uploadFile.id}`}
                        value={uploadFile.title}
                        onChange={e => updateFileTitle(uploadFile.id, e.target.value)}
                        disabled={uploadFile.status !== 'pending'}
                        className="border-2"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`folder-${uploadFile.id}`} className="text-sm font-medium">
                        Folder (Optional)
                      </Label>
                      <Select
                        value={uploadFile.folderId}
                        onValueChange={value => updateFileFolder(uploadFile.id, value)}
                        disabled={uploadFile.status !== 'pending'}
                      >
                        <SelectTrigger id={`folder-${uploadFile.id}`} className="border-2">
                          <SelectValue placeholder="No folder" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No folder</SelectItem>
                          {folders.map(folder => (
                            <SelectItem key={folder.id} value={folder.id}>
                              {folder.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span>{formatFileSize(uploadFile.file.size)}</span>
                      <span>•</span>
                      <span>{uploadFile.file.name}</span>
                    </div>

                    {uploadFile.status === 'uploading' && (
                      <div className="space-y-2">
                        <Progress value={uploadFile.progress} className="h-2" />
                        <p className="text-sm text-muted-foreground">
                          Uploading... {uploadFile.progress}%
                        </p>
                      </div>
                    )}

                    {uploadFile.status === 'complete' && (
                      <p className="text-sm text-secondary font-medium">Upload complete!</p>
                    )}

                    {uploadFile.status === 'error' && uploadFile.error && (
                      <p className="text-sm text-destructive">{uploadFile.error}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
