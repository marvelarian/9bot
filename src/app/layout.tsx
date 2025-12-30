import type { Metadata } from 'next'
import './globals.css'
import { GlobalFetchLoader } from '@/components/system/GlobalFetchLoader'

export const metadata: Metadata = {
  title: 'Grid Trading Bot',
  description: 'Advanced grid trading bot for Delta Exchange',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <GlobalFetchLoader />
        {children}
      </body>
    </html>
  )
}

