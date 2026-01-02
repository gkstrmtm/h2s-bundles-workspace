import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'H2S Dashboard Backend',
  description: 'Backend API for H2S Dashboard',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
