import './globals.css'
import type { Metadata } from 'next'
import { Poppins, Lora, Fira_Code } from 'next/font/google'

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans'
})

const lora = Lora({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-serif'
})

const firaCode = Fira_Code({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono'
})

export const metadata: Metadata = {
  title: 'VideoShare - Share Your Screen Recordings',
  description: 'Upload, organize, and share your screen recordings with colleagues via simple links',
    generator: 'v0.app'
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${poppins.variable} ${lora.variable} ${firaCode.variable}`}>
      <body>{children}</body>
    </html>
  )
}
