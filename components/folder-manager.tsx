'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { FolderPlus } from 'lucide-react'

export function FolderManager() {
  const [open, setOpen] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [loading, setLoading] = useState(false)

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const response = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: folderName })
      })

      if (response.ok) {
        setFolderName('')
        setOpen(false)
        // Refresh the page to show new folder
        window.location.reload()
      }
    } catch (error) {
      console.error('[v0] Failed to create folder:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="border-2 shadow-brutal">
          <FolderPlus className="mr-2 h-4 w-4" />
          New Folder
        </Button>
      </DialogTrigger>
      <DialogContent className="border-2 shadow-brutal-lg">
        <DialogHeader>
          <DialogTitle>Create New Folder</DialogTitle>
          <DialogDescription>
            Organize your videos by creating folders
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleCreateFolder} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="folder-name">Folder Name</Label>
            <Input
              id="folder-name"
              value={folderName}
              onChange={e => setFolderName(e.target.value)}
              placeholder="e.g., Client Demos"
              required
              className="border-2"
            />
          </div>
          <Button type="submit" disabled={loading} className="w-full shadow-brutal">
            Create Folder
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
