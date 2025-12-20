import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { put } from '@vercel/blob'
import { env } from '@/lib/env'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      )
    }

    const formData = await request.formData()
    const video = formData.get('video') as File
    const title = formData.get('title') as string
    const folderId = formData.get('folderId') as string | null

    if (!video) {
      return NextResponse.json(
        { message: 'No video file provided' },
        { status: 400 }
      )
    }

    // Upload to Vercel Blob
    const blob = await put(`videos/${user.id}/${Date.now()}-${video.name}`, video, {
      access: 'public',
      token: env.BLOB_READ_WRITE_TOKEN,
    })

    // Save video metadata to Supabase
    const { data, error } = await supabase
      .from('videos')
      .insert({
        user_id: user.id,
        folder_id: folderId && folderId !== 'none' ? folderId : null,
        title: title || video.name,
        filename: video.name,
        file_size: video.size,
        video_url: blob.url,
        is_draft: false
      })
      .select()
      .single()

    if (error) {
      console.error('[v0] Error saving video metadata:', error)
      return NextResponse.json(
        { message: 'Failed to save video' },
        { status: 500 }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('[v0] Upload error:', error)
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    )
  }
}
