import type { Metadata } from 'next'
import { BUILD_ID } from '@/lib/buildInfo';

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
      <head>
        <meta name="x-build-id" content={BUILD_ID} />
      </head>
      <body data-build-id={BUILD_ID}>
         {/* Build Stamp for Frontend Verification */}
         <div style={{ display: 'none' }} id="server-build-id">{BUILD_ID}</div>
         <script
            dangerouslySetInnerHTML={{
              __html: `console.log("%c[Server] Running Build: ${BUILD_ID}", "background: #222; color: #bada55; font-size: 14px; padding: 4px;"); window.SERVER_BUILD_ID = "${BUILD_ID}";`,
            }}
          />
         {children}
      </body>
    </html>
  )
}
