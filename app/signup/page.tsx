import { AuthForm } from '@/components/auth-form'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function SignupPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (user) {
    redirect('/dashboard')
  }
  
  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-secondary/10 to-accent/10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-primary mb-2 font-serif">VideoShare</h1>
          <p className="text-muted-foreground">Share your screen recordings instantly</p>
        </div>
        <AuthForm mode="signup" />
      </div>
    </main>
  )
}
