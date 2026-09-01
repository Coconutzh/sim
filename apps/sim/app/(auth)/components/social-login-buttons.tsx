'use client'

import { type ReactNode, useEffect, useState } from 'react'
import { Button } from '@/components/emcn'
import { GithubIcon, GoogleIcon } from '@/components/icons'
import { client } from '@/lib/auth/auth-client'

interface SocialLoginButtonsProps {
  githubAvailable: boolean
  googleAvailable: boolean
  callbackURL?: string
  isProduction: boolean
  children?: ReactNode
}

export function SocialLoginButtons({
  githubAvailable,
  googleAvailable,
  callbackURL = '/workspace',
  isProduction,
  children,
}: SocialLoginButtonsProps) {
  const [isGithubLoading, setIsGithubLoading] = useState(false)
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Set mounted state to true on client-side
  useEffect(() => {
    setMounted(true)
  }, [])

  // Only render on the client side to avoid hydration errors
  if (!mounted) return null

  async function signInWithGithub() {
    if (!githubAvailable) return

    setIsGithubLoading(true)
    try {
      await client.signIn.social({ provider: 'github', callbackURL })
    } catch (err: any) {
      let errorMessage = 'GitHub 登录失败'

      if (err.message?.includes('account exists')) {
        errorMessage = '该邮箱已注册，请直接登录。'
      } else if (err.message?.includes('cancelled')) {
        errorMessage = 'GitHub 登录已取消，请重试。'
      } else if (err.message?.includes('network')) {
        errorMessage = '网络异常，请检查网络后重试。'
      } else if (err.message?.includes('rate limit')) {
        errorMessage = '尝试次数过多，请稍后重试。'
      }
    } finally {
      setIsGithubLoading(false)
    }
  }

  async function signInWithGoogle() {
    if (!googleAvailable) return

    setIsGoogleLoading(true)
    try {
      await client.signIn.social({ provider: 'google', callbackURL })
    } catch (err: any) {
      let errorMessage = 'Google 登录失败'

      if (err.message?.includes('account exists')) {
        errorMessage = '该邮箱已注册，请直接登录。'
      } else if (err.message?.includes('cancelled')) {
        errorMessage = 'Google 登录已取消，请重试。'
      } else if (err.message?.includes('network')) {
        errorMessage = '网络异常，请检查网络后重试。'
      } else if (err.message?.includes('rate limit')) {
        errorMessage = '尝试次数过多，请稍后重试。'
      }
    } finally {
      setIsGoogleLoading(false)
    }
  }

  const githubButton = (
    <Button
      variant='outline'
      className='w-full rounded-sm border-[var(--landing-border-strong)] py-1.5 text-sm'
      disabled={!githubAvailable || isGithubLoading}
      onClick={signInWithGithub}
    >
      <GithubIcon className='!h-[18px] !w-[18px] mr-1' />
      {isGithubLoading ? '连接中...' : '使用 GitHub 登录'}
    </Button>
  )

  const googleButton = (
    <Button
      variant='outline'
      className='w-full rounded-sm border-[var(--landing-border-strong)] py-1.5 text-sm'
      disabled={!googleAvailable || isGoogleLoading}
      onClick={signInWithGoogle}
    >
      <GoogleIcon className='!h-[18px] !w-[18px] mr-1' />
      {isGoogleLoading ? '连接中...' : '使用 Google 登录'}
    </Button>
  )

  const hasAnyOAuthProvider = githubAvailable || googleAvailable

  if (!hasAnyOAuthProvider && !children) {
    return null
  }

  return (
    <div className='grid gap-3 font-light'>
      {googleAvailable && googleButton}
      {githubAvailable && githubButton}
      {children}
    </div>
  )
}
