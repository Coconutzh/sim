'use client'

import { useEffect } from 'react'
import AuthBackground from '@/app/(auth)/components/auth-background'
import { AuthBrand } from '@/app/(auth)/components/auth-brand'

export default function AuthLayoutClient({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add('dark')
    return () => {
      document.documentElement.classList.remove('dark')
    }
  }, [])

  return (
    <AuthBackground className='dark font-[430] font-season'>
      <main className='relative flex min-h-full flex-col text-[var(--landing-text)]'>
        <div className='relative z-30 flex flex-1 items-center justify-center px-4 pb-24'>
          <div className='w-full max-w-lg px-4'>
            <AuthBrand />
            {children}
          </div>
        </div>
      </main>
    </AuthBackground>
  )
}
