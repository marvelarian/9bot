import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { GlobalFetchLoader } from '@/components/system/GlobalFetchLoader'

const inter = Inter({ subsets: ['latin'] })

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
      <body className={inter.className}>
        <GlobalFetchLoader />
        {children}
      </body>
    </html>
  )
}

