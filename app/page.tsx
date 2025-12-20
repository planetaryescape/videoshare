import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { Video, Upload, Share2, FolderOpen } from 'lucide-react'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (user) {
    redirect('/dashboard')
  }
  
  return (
    <main className="min-h-screen bg-gradient-to-br from-background via-secondary/10 to-accent/10">
      <div className="container mx-auto px-4 py-16">
        <div className="text-center mb-16">
          <h1 className="text-6xl font-bold text-primary mb-4 font-serif">
            VideoShare
          </h1>
          <p className="text-xl text-foreground mb-8 max-w-2xl mx-auto leading-relaxed">
            Upload, organize, and share your screen recordings with colleagues. Simple, fast, and built for teams.
          </p>
          <div className="flex gap-4 justify-center">
            <Link href="/signup">
              <Button size="lg" className="shadow-brutal-lg">
                Get Started
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline" className="border-2 shadow-brutal">
                Log In
              </Button>
            </Link>
          </div>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
          <div className="bg-card p-6 rounded-lg border-2 border-primary shadow-brutal">
            <Upload className="h-12 w-12 text-primary mb-4" />
            <h3 className="text-lg font-semibold mb-2">Batch Upload</h3>
            <p className="text-sm text-muted-foreground">
              Drag and drop multiple videos at once with real-time progress tracking
            </p>
          </div>

          <div className="bg-card p-6 rounded-lg border-2 border-secondary shadow-brutal">
            <FolderOpen className="h-12 w-12 text-secondary mb-4" />
            <h3 className="text-lg font-semibold mb-2">Organize</h3>
            <p className="text-sm text-muted-foreground">
              Keep your videos organized in simple folders with easy sorting
            </p>
          </div>

          <div className="bg-card p-6 rounded-lg border-2 border-accent shadow-brutal">
            <Share2 className="h-12 w-12 text-accent-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Share Instantly</h3>
            <p className="text-sm text-muted-foreground">
              Generate public links and copy to clipboard with one click
            </p>
          </div>

          <div className="bg-card p-6 rounded-lg border-2 border-primary shadow-brutal">
            <Video className="h-12 w-12 text-primary mb-4" />
            <h3 className="text-lg font-semibold mb-2">Simple Viewing</h3>
            <p className="text-sm text-muted-foreground">
              No login required for viewers. Just share the link and go
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
