import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function SignupSuccessPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-secondary/10 to-accent/10">
      <div className="w-full max-w-md">
        <Card className="shadow-brutal-lg border-2 border-primary">
          <CardHeader>
            <CardTitle className="text-2xl font-bold">Check Your Email</CardTitle>
            <CardDescription>
              We've sent you a confirmation link
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Please check your email and click the confirmation link to activate your account. 
              Once confirmed, you can log in and start sharing videos.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
