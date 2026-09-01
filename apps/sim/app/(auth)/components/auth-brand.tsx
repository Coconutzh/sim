import Image from 'next/image'

const PLATFORM_NAME = '大智若娱・大型活动 AI 数智平台'
const PLATFORM_VERSION = 'V1.0 内测'

/** Centered platform identity block shown above the auth forms. */
export function AuthBrand() {
  return (
    <div className='-translate-y-4 mb-8 flex flex-col items-center gap-3'>
      <Image
        src='/logo/company-logo.png?v=20260821'
        alt={PLATFORM_NAME}
        width={3734}
        height={596}
        priority
        unoptimized
        className='h-12 w-auto object-contain sm:h-14'
      />
      <div className='relative inline-block'>
        <span className='block whitespace-nowrap font-[430] font-season text-[22px] text-white tracking-[-0.01em] sm:text-2xl'>
          {PLATFORM_NAME}
        </span>
        <span className='-right-[88px] -translate-y-1/2 absolute top-1/2 whitespace-nowrap rounded-full border border-[color-mix(in_srgb,var(--landing-text-muted)_45%,transparent)] px-2.5 py-0.5 font-[340] text-[var(--landing-text-muted)] text-xs'>
          {PLATFORM_VERSION}
        </span>
      </div>
    </div>
  )
}
