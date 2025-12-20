import { z } from 'zod'

const envSchema = z.object({
  // Server-side variables
  BLOB_READ_WRITE_TOKEN: z.string().min(1),
  
  // Client-side variables (prefixed with NEXT_PUBLIC_)
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL: z.string().url().optional(),
})

// Function to validate environment variables
const validateEnv = () => {
  const result = envSchema.safeParse({
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL: process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL,
  })

  if (!result.success) {
    console.error('❌ Invalid environment variables:', result.error.flatten().fieldErrors)
    
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Invalid environment variables')
    }
    
    // In development, return the data even if partial/invalid to avoid breaking types
    // but we need to satisfy the type. safeParse data is undefined on error.
    // We can cast to any then to the type as a last resort in dev, 
    // or better, just provide the values manually for the return.
    return {
      BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL: process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL,
    } as any as z.infer<typeof envSchema>
  }

  return result.data
}

export const env = validateEnv()
