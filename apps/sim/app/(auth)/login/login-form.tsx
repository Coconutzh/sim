'use client'

import { useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Eye, EyeOff } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Input,
  Label,
  Loader,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalHeader,
} from '@/components/emcn'
import { requestJson } from '@/lib/api/client/request'
import { forgetPasswordContract } from '@/lib/api/contracts'
import { client } from '@/lib/auth/auth-client'
import { getEnv, isFalsy, isTruthy } from '@/lib/core/config/env'
import { validateCallbackUrl } from '@/lib/core/security/input-validation'
import { cn } from '@/lib/core/utils/cn'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { captureClientEvent } from '@/lib/posthog/client'
import { AUTH_SUBMIT_BTN } from '@/app/(auth)/components/auth-button-classes'
import { SocialLoginButtons } from '@/app/(auth)/components/social-login-buttons'
import { SSOLoginButton } from '@/app/(auth)/components/sso-login-button'

const logger = createLogger('LoginForm')

const validateEmailField = (emailValue: string): string[] => {
  const errors: string[] = []

  if (!emailValue || !emailValue.trim()) {
    errors.push('请输入邮箱')
    return errors
  }

  const validation = quickValidateEmail(emailValue.trim().toLowerCase())
  if (!validation.isValid) {
    errors.push(validation.reason || '请输入有效的邮箱地址')
  }

  return errors
}

const PASSWORD_VALIDATIONS = {
  required: {
    test: (value: string) => Boolean(value && typeof value === 'string'),
    message: '请输入密码',
  },
  notEmpty: {
    test: (value: string) => value.trim().length > 0,
    message: '密码不能为空',
  },
}

const validatePassword = (passwordValue: string): string[] => {
  const errors: string[] = []

  if (!PASSWORD_VALIDATIONS.required.test(passwordValue)) {
    errors.push(PASSWORD_VALIDATIONS.required.message)
    return errors
  }

  if (!PASSWORD_VALIDATIONS.notEmpty.test(passwordValue)) {
    errors.push(PASSWORD_VALIDATIONS.notEmpty.message)
    return errors
  }

  return errors
}

export default function LoginPage({
  githubAvailable,
  googleAvailable,
  isProduction,
}: {
  githubAvailable: boolean
  googleAvailable: boolean
  isProduction: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordErrors, setPasswordErrors] = useState<string[]>([])
  const [showValidationError, setShowValidationError] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const callbackUrlParam = searchParams?.get('callbackUrl')
  const isValidCallbackUrl = callbackUrlParam ? validateCallbackUrl(callbackUrlParam) : false
  const invalidCallbackRef = useRef(false)
  if (callbackUrlParam && !isValidCallbackUrl && !invalidCallbackRef.current) {
    invalidCallbackRef.current = true
    logger.warn('Invalid callback URL detected and blocked:', { url: callbackUrlParam })
  }
  const callbackUrl = isValidCallbackUrl ? callbackUrlParam! : '/workspace'
  const isInviteFlow = searchParams?.get('invite_flow') === 'true'

  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false)
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('')
  const [isSubmittingReset, setIsSubmittingReset] = useState(false)
  const [resetStatus, setResetStatus] = useState<{
    type: 'success' | 'error' | null
    message: string
  }>({ type: null, message: '' })

  const [email, setEmail] = useState('')
  const [emailErrors, setEmailErrors] = useState<string[]>([])
  const [showEmailValidationError, setShowEmailValidationError] = useState(false)
  const [resetSuccessMessage, setResetSuccessMessage] = useState<string | null>(() =>
    searchParams?.get('resetSuccess') === 'true' ? '密码重置成功，请使用新密码登录。' : null
  )

  useEffect(() => {
    captureClientEvent('login_page_viewed', {})
  }, [])

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEmail = e.target.value
    setEmail(newEmail)

    const errors = validateEmailField(newEmail)
    setEmailErrors(errors)
    setShowEmailValidationError(false)
  }

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPassword = e.target.value
    setPassword(newPassword)

    const errors = validatePassword(newPassword)
    setPasswordErrors(errors)
    setShowValidationError(false)
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsLoading(true)

    const redirectToVerify = (emailToVerify: string) => {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('verificationEmail', emailToVerify)
      }
      router.push('/verify')
    }

    const formData = new FormData(e.currentTarget)
    const emailRaw = formData.get('email') as string
    const email = emailRaw.trim().toLowerCase()

    const emailValidationErrors = validateEmailField(email)
    setEmailErrors(emailValidationErrors)
    setShowEmailValidationError(emailValidationErrors.length > 0)

    const passwordValidationErrors = validatePassword(password)
    setPasswordErrors(passwordValidationErrors)
    setShowValidationError(passwordValidationErrors.length > 0)

    if (emailValidationErrors.length > 0 || passwordValidationErrors.length > 0) {
      setIsLoading(false)
      return
    }

    try {
      const safeCallbackUrl = callbackUrl
      let errorHandled = false

      setFormError(null)
      const result = await client.signIn.email(
        {
          email,
          password,
          callbackURL: safeCallbackUrl,
        },
        {
          onError: (ctx: any) => {
            logger.error('Login error:', ctx.error)

            if (ctx.error.code?.includes('EMAIL_NOT_VERIFIED')) {
              errorHandled = true
              redirectToVerify(email)
              return
            }

            errorHandled = true
            const errorMessage: string[] = ['邮箱或密码错误']

            if (
              ctx.error.code?.includes('BAD_REQUEST') ||
              ctx.error.message?.includes('Email and password sign in is not enabled')
            ) {
              errorMessage.push('当前未开放邮箱密码登录。')
            } else if (
              ctx.error.code?.includes('INVALID_CREDENTIALS') ||
              ctx.error.message?.includes('invalid password')
            ) {
              errorMessage.push('邮箱或密码错误，请重试。')
            } else if (
              ctx.error.code?.includes('USER_NOT_FOUND') ||
              ctx.error.message?.includes('not found')
            ) {
              errorMessage.push('该邮箱未注册，请先注册。')
            } else if (ctx.error.code?.includes('MISSING_CREDENTIALS')) {
              errorMessage.push('请输入邮箱和密码。')
            } else if (ctx.error.code?.includes('EMAIL_PASSWORD_DISABLED')) {
              errorMessage.push('邮箱密码登录已停用。')
            } else if (ctx.error.code?.includes('FAILED_TO_CREATE_SESSION')) {
              errorMessage.push('创建会话失败，请稍后重试。')
            } else if (ctx.error.code?.includes('too many attempts')) {
              errorMessage.push('登录尝试次数过多，请稍后重试或重置密码。')
            } else if (ctx.error.code?.includes('account locked')) {
              errorMessage.push('账号已被安全锁定，请重置密码。')
            } else if (ctx.error.code?.includes('network')) {
              errorMessage.push('网络异常，请检查网络后重试。')
            } else if (ctx.error.message?.includes('rate limit')) {
              errorMessage.push('请求过于频繁，请稍后再试。')
            }

            setResetSuccessMessage(null)
            setPasswordErrors(errorMessage)
            setShowValidationError(true)
          },
        }
      )

      if (!result || result.error) {
        // Show error if not already handled by onError callback
        if (!errorHandled) {
          setResetSuccessMessage(null)
          const errorMessage = result?.error?.message || '登录失败，请重试。'
          setPasswordErrors([errorMessage])
          setShowValidationError(true)
        }
        setIsLoading(false)
        return
      }

      // Clear reset success message on successful login
      setResetSuccessMessage(null)

      // Explicit redirect fallback if better-auth doesn't redirect
      router.push(safeCallbackUrl)
    } catch (err: any) {
      if (err.message?.includes('not verified') || err.code?.includes('EMAIL_NOT_VERIFIED')) {
        redirectToVerify(email)
        return
      }

      logger.error('Uncaught login error:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleForgotPassword = async () => {
    if (!forgotPasswordEmail) {
      setResetStatus({
        type: 'error',
        message: '请输入邮箱地址',
      })
      return
    }

    const emailValidation = quickValidateEmail(forgotPasswordEmail.trim().toLowerCase())
    if (!emailValidation.isValid) {
      setResetStatus({
        type: 'error',
        message: '请输入有效的邮箱地址',
      })
      return
    }

    try {
      setIsSubmittingReset(true)
      setResetStatus({ type: null, message: '' })

      try {
        await requestJson(forgetPasswordContract, {
          body: {
            email: forgotPasswordEmail,
            redirectTo: `${getBaseUrl()}/reset-password`,
          },
        })
      } catch (requestError) {
        let errorMessage = requestError instanceof Error ? requestError.message : '密码重置请求失败'

        if (
          errorMessage.includes('Invalid body parameters') ||
          errorMessage.includes('invalid email')
        ) {
          errorMessage = '请输入有效的邮箱地址'
        } else if (errorMessage.includes('Email is required')) {
          errorMessage = '请输入邮箱地址'
        } else if (
          errorMessage.includes('user not found') ||
          errorMessage.includes('User not found')
        ) {
          errorMessage = '该邮箱未注册'
        }

        throw new Error(errorMessage)
      }

      setResetStatus({
        type: 'success',
        message: '密码重置链接已发送至您的邮箱',
      })

      setTimeout(() => {
        setForgotPasswordOpen(false)
        setResetStatus({ type: null, message: '' })
      }, 2000)
    } catch (error) {
      logger.error('Error requesting password reset:', { error })
      setResetStatus({
        type: 'error',
        message: error instanceof Error ? error.message : '密码重置请求失败',
      })
    } finally {
      setIsSubmittingReset(false)
    }
  }

  const ssoEnabled = isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))
  const emailEnabled = !isFalsy(getEnv('NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED'))
  const hasSocial = githubAvailable || googleAvailable
  const hasOnlySSO = ssoEnabled && !emailEnabled && !hasSocial
  const showTopSSO = hasOnlySSO
  const showBottomSection = hasSocial || (ssoEnabled && !hasOnlySSO)
  const showDivider = (emailEnabled || showTopSSO) && showBottomSection

  return (
    <>
      <div className='space-y-1 text-center'>
        <h1 className='text-balance font-[430] font-season text-[40px] text-white leading-[110%] tracking-[-0.02em]'>
          登录
        </h1>
        <p className='font-[430] font-season text-[color-mix(in_srgb,var(--landing-text-subtle)_60%,transparent)] text-lg leading-[125%] tracking-[0.02em]'>
          请输入账号信息
        </p>
      </div>

      {/* SSO Login Button (primary top-only when it is the only method) */}
      {showTopSSO && (
        <div className='mt-8'>
          <SSOLoginButton callbackURL={callbackUrl} variant='primary' />
        </div>
      )}

      {/* Email/Password Form - show unless explicitly disabled */}
      {!isFalsy(getEnv('NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED')) && (
        <form onSubmit={onSubmit} className='mt-8 space-y-8'>
          <div className='space-y-6'>
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <Label htmlFor='email'>邮箱</Label>
              </div>
              <Input
                id='email'
                name='email'
                placeholder='请输入邮箱'
                required
                autoCapitalize='none'
                autoComplete='email'
                autoCorrect='off'
                value={email}
                onChange={handleEmailChange}
                className={cn(
                  showEmailValidationError &&
                    emailErrors.length > 0 &&
                    'border-red-500 focus:border-red-500'
                )}
              />
              {showEmailValidationError && emailErrors.length > 0 && (
                <div className='mt-1 space-y-1 text-red-400 text-xs'>
                  {emailErrors.map((error, index) => (
                    <p key={index}>{error}</p>
                  ))}
                </div>
              )}
            </div>
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <Label htmlFor='password'>密码</Label>
                <button
                  type='button'
                  onClick={() => setForgotPasswordOpen(true)}
                  className='font-medium text-[var(--landing-text-muted)] text-xs transition hover:text-[var(--landing-text)]'
                >
                  忘记密码？
                </button>
              </div>
              <div className='relative'>
                <Input
                  id='password'
                  name='password'
                  required
                  type={showPassword ? 'text' : 'password'}
                  autoCapitalize='none'
                  autoComplete='current-password'
                  autoCorrect='off'
                  placeholder='请输入密码'
                  value={password}
                  onChange={handlePasswordChange}
                  className={cn(
                    'pr-10',
                    showValidationError &&
                      passwordErrors.length > 0 &&
                      'border-red-500 focus:border-red-500'
                  )}
                />
                <button
                  type='button'
                  onClick={() => setShowPassword(!showPassword)}
                  className='-translate-y-1/2 absolute top-1/2 right-3 text-[var(--landing-text-muted)] transition hover:text-[var(--landing-text)]'
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {showValidationError && passwordErrors.length > 0 && (
                <div className='mt-1 space-y-1 text-red-400 text-xs'>
                  {passwordErrors.map((error, index) => (
                    <p key={index}>{error}</p>
                  ))}
                </div>
              )}
            </div>
          </div>

          {resetSuccessMessage && (
            <div className='text-[#4CAF50] text-xs'>
              <p>{resetSuccessMessage}</p>
            </div>
          )}

          {formError && (
            <div className='text-red-400 text-xs'>
              <p>{formError}</p>
            </div>
          )}

          <button type='submit' disabled={isLoading} className={AUTH_SUBMIT_BTN}>
            {isLoading ? (
              <span className='flex items-center gap-2'>
                <Loader className='h-4 w-4' animate />
                登录中...
              </span>
            ) : (
              '登录'
            )}
          </button>
        </form>
      )}

      {/* Divider - show when we have multiple auth methods */}
      {showDivider && (
        <div className='relative my-6 font-light'>
          <div className='absolute inset-0 flex items-center'>
            <div className='w-full border-[var(--landing-bg-elevated)] border-t' />
          </div>
          <div className='relative flex justify-center text-sm'>
            <span className='bg-[var(--landing-bg)] px-4 font-[340] text-[var(--landing-text-muted)]'>
              或使用其他方式登录
            </span>
          </div>
        </div>
      )}

      {showBottomSection && (
        <div className={cn(!emailEnabled ? 'mt-8' : undefined)}>
          <SocialLoginButtons
            googleAvailable={googleAvailable}
            githubAvailable={githubAvailable}
            isProduction={isProduction}
            callbackURL={callbackUrl}
          >
            {ssoEnabled && !hasOnlySSO && (
              <SSOLoginButton callbackURL={callbackUrl} variant='outline' />
            )}
          </SocialLoginButtons>
        </div>
      )}

      {/* Only show signup link if email/password signup is enabled */}
      {!isFalsy(getEnv('NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED')) && (
        <div className='pt-6 text-center font-light text-[14px]'>
          <span className='font-normal'>还没有账号？ </span>
          <Link
            href={isInviteFlow ? `/signup?invite_flow=true&callbackUrl=${callbackUrl}` : '/signup'}
            className='font-medium text-[var(--landing-text)] underline-offset-4 transition hover:text-white hover:underline'
          >
            注册
          </Link>
        </div>
      )}

      <div className='absolute right-0 bottom-0 left-0 px-8 pb-6 text-center font-[340] text-[13px] text-[var(--landing-text-muted)] leading-relaxed sm:px-8 md:px-11'>
        <p>
          登录即代表您已阅读并同意{' '}
          <Link
            href='/terms'
            target='_blank'
            rel='noopener noreferrer'
            className='text-[var(--landing-text-muted)] underline-offset-4 transition hover:text-[var(--landing-text)] hover:underline'
          >
            《服务条款》
          </Link>{' '}
          与{' '}
          <Link
            href='/privacy'
            target='_blank'
            rel='noopener noreferrer'
            className='text-[var(--landing-text-muted)] underline-offset-4 transition hover:text-[var(--landing-text)] hover:underline'
          >
            《隐私政策》
          </Link>
        </p>
        <p className='mt-1'>© 2026 大智若娱・大型活动 AI 数智平台</p>
      </div>

      <Modal open={forgotPasswordOpen} onOpenChange={setForgotPasswordOpen}>
        <ModalContent className='dark' size='sm'>
          <ModalHeader>重置密码</ModalHeader>
          <ModalBody>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                handleForgotPassword()
              }}
            >
              <ModalDescription className='mb-4 text-[var(--text-muted)] text-sm'>
                请输入您的邮箱，如果账号存在，我们将向您发送密码重置链接。
              </ModalDescription>
              <div className='space-y-4'>
                <div className='space-y-2'>
                  <Label htmlFor='reset-email'>邮箱</Label>
                  <Input
                    id='reset-email'
                    value={forgotPasswordEmail}
                    onChange={(e) => setForgotPasswordEmail(e.target.value)}
                    placeholder='请输入邮箱'
                    required
                    type='email'
                    className={cn(
                      resetStatus.type === 'error' && 'border-red-500 focus:border-red-500'
                    )}
                  />
                  {resetStatus.type === 'error' && (
                    <div className='mt-1 text-red-400 text-xs'>
                      <p>{resetStatus.message}</p>
                    </div>
                  )}
                </div>
                {resetStatus.type === 'success' && (
                  <div className='mt-1 text-[#4CAF50] text-xs'>
                    <p>{resetStatus.message}</p>
                  </div>
                )}
                <button type='submit' disabled={isSubmittingReset} className={AUTH_SUBMIT_BTN}>
                  {isSubmittingReset ? (
                    <span className='flex items-center gap-2'>
                      <Loader className='h-4 w-4' animate />
                      发送中...
                    </span>
                  ) : (
                    '发送重置链接'
                  )}
                </button>
              </div>
            </form>
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  )
}
