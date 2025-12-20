import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { FileQuestion } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-secondary/10 to-accent/10 flex items-center justify-center p-4">
      <div className="bg-card border-2 border-border rounded-lg shadow-brutal-lg p-8 max-w-md text-center space-y-4">
        <FileQuestion className="h-16 w-16 mx-auto text-muted-foreground" />
        <h1 className="text-3xl font-bold">Video Not Found</h1>
        <p className="text-muted-foreground">
          The video you're looking for doesn't exist or has been removed.
        </p>
        <Link href="/">
          <Button className="shadow-brutal">
            Go to Homepage
          </Button>
        </Link>
      </div>
    </div>
  )
}
