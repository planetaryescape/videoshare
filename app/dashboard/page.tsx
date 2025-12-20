import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { VideoUpload } from '@/components/video-upload'
import { VideoList } from '@/components/video-list'
import { FolderManager } from '@/components/folder-manager'
import { Button } from '@/components/ui/button'
import { LogOut, Upload } from 'lucide-react'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'

async function logout() {
  'use server'
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

async function getFolders(userId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('folders')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[v0] Error fetching folders:', error)
    return []
  }

  return data || []
}

async function getVideos(userId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('videos')
    .select(`
      *,
      folders (
        name
      )
    `)
    .eq('user_id', userId)
    .order('upload_date', { ascending: false })

  if (error) {
    console.error('[v0] Error fetching videos:', error)
    return []
  }

  return data?.map(video => ({
    id: video.id,
    title: video.title,
    filename: video.filename,
    thumbnailUrl: video.thumbnail_url,
    uploadDate: new Date(video.upload_date),
    fileSize: video.file_size,
    isDraft: video.is_draft,
    folderId: video.folder_id,
    folderName: video.folders?.name || null,
    videoUrl: video.video_url
  })) || []
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/login')
  }

  const folders = await getFolders(user.id)
  const videos = await getVideos(user.id)

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-secondary/10 to-accent/10">
      {/* Header */}
      <header className="border-b-2 border-border bg-card/50 backdrop-blur">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-primary font-serif">VideoShare</h1>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
            <form action={logout}>
              <Button variant="outline" type="submit" className="border-2 shadow-brutal">
                <LogOut className="mr-2 h-4 w-4" />
                Log Out
              </Button>
            </form>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="videos" className="space-y-6">
          <TabsList className="border-2 shadow-brutal">
            <TabsTrigger value="videos">My Videos</TabsTrigger>
            <TabsTrigger value="upload">
              <Upload className="mr-2 h-4 w-4" />
              Upload
            </TabsTrigger>
          </TabsList>

          <TabsContent value="videos" className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold">Video Library</h2>
                <p className="text-muted-foreground">
                  {videos.length} {videos.length === 1 ? 'video' : 'videos'} total
                </p>
              </div>
              <FolderManager />
            </div>

            <VideoList videos={videos} folders={folders} />
          </TabsContent>

          <TabsContent value="upload" className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold mb-2">Upload Videos</h2>
              <p className="text-muted-foreground">
                Drag and drop videos or click to browse. Supports batch uploads.
              </p>
            </div>

            <VideoUpload folders={folders} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
