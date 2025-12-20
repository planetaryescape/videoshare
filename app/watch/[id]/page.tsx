import { notFound } from 'next/navigation'
import { Download, Calendar, Folder, FileVideo } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

async function getVideo(id: string) {
  // TODO: Fetch from database
  // Mock data for now
  const mockVideos: Record<string, any> = {
    '1': {
      id: '1',
      title: 'Product Demo - Q4 Features',
      filename: 'product-demo-q4.mp4',
      videoUrl: '/demo-video.mp4', // In production, this would be from storage
      uploadDate: new Date('2024-01-15'),
      fileSize: 52428800, // 50 MB
      isDraft: false,
      folderName: 'Client Demos'
    },
    '2': {
      id: '2',
      title: 'Bug Reproduction - Login Issue',
      filename: 'bug-login-issue.mov',
      videoUrl: '/demo-video.mp4',
      uploadDate: new Date('2024-01-14'),
      fileSize: 15728640, // 15 MB
      isDraft: false,
      folderName: null
    },
    '3': {
      id: '3',
      title: 'Weekly Team Standup',
      filename: 'standup-2024-01-10.mp4',
      videoUrl: '/demo-video.mp4',
      uploadDate: new Date('2024-01-10'),
      fileSize: 104857600, // 100 MB
      isDraft: true,
      folderName: 'Team Updates'
    },
    '4': {
      id: '4',
      title: 'API Integration Tutorial',
      filename: 'api-tutorial.mp4',
      videoUrl: '/demo-video.mp4',
      uploadDate: new Date('2024-01-08'),
      fileSize: 78643200, // 75 MB
      isDraft: false,
      folderName: 'Tutorials'
    }
  }

  return mockVideos[id] || null
}

export default async function WatchPage({ params }: { params: { id: string } }) {
  const video = await getVideo(params.id)

  if (!video) {
    notFound()
  }

  if (video.isDraft) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-secondary/10 to-accent/10 flex items-center justify-center p-4">
        <div className="bg-card border-2 border-border rounded-lg shadow-brutal-lg p-8 max-w-md text-center">
          <h1 className="text-2xl font-bold mb-2">Video Not Available</h1>
          <p className="text-muted-foreground">
            This video is currently in draft mode and not available for viewing.
          </p>
        </div>
      </div>
    )
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB'
  }

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    }).format(date)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-secondary/10 to-accent/10">
      {/* Header */}
      <header className="border-b-2 border-border bg-card/50 backdrop-blur">
        <div className="container mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-primary font-serif">VideoShare</h1>
        </div>
      </header>

      {/* Video Player */}
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-5xl mx-auto space-y-6">
          {/* Video */}
          <div className="bg-card border-2 border-border rounded-lg overflow-hidden shadow-brutal-lg">
            <div className="relative aspect-video bg-black">
              <video
                controls
                className="w-full h-full"
                preload="metadata"
                controlsList="nodownload"
              >
                <source src={video.videoUrl} type="video/mp4" />
                Your browser does not support the video tag.
              </video>
            </div>

            {/* Video Info */}
            <div className="p-6 space-y-4">
              <div>
                <h1 className="text-2xl font-bold mb-2">{video.title}</h1>
                <p className="text-sm text-muted-foreground">{video.filename}</p>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  <span>{formatDate(video.uploadDate)}</span>
                </div>
                <span>•</span>
                <div className="flex items-center gap-2">
                  <FileVideo className="h-4 w-4" />
                  <span>{formatFileSize(video.fileSize)}</span>
                </div>
                {video.folderName && (
                  <>
                    <span>•</span>
                    <div className="flex items-center gap-2">
                      <Folder className="h-4 w-4" />
                      <Badge variant="outline">{video.folderName}</Badge>
                    </div>
                  </>
                )}
              </div>

              <div className="pt-4 border-t-2 border-border">
                <a href={video.videoUrl} download={video.filename}>
                  <Button className="shadow-brutal">
                    <Download className="mr-2 h-4 w-4" />
                    Download Video
                  </Button>
                </a>
              </div>
            </div>
          </div>

          {/* Additional Info */}
          <div className="bg-card border-2 border-border rounded-lg p-6 shadow-brutal">
            <h2 className="text-lg font-semibold mb-3">About this video</h2>
            <p className="text-muted-foreground leading-relaxed">
              This video was shared using VideoShare. No authentication is required to view or download this content.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t-2 border-border bg-card/50 backdrop-blur mt-16">
        <div className="container mx-auto px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">
            Powered by{' '}
            <a href="/" className="text-primary hover:underline font-medium">
              VideoShare
            </a>
          </p>
        </div>
      </footer>
    </div>
  )
}
