import Link from 'next/link'

interface WorkbenchStatusCardProps {
  eyebrow?: string
  title: string
  message: string
  actionLabel?: string
  actionHref?: string
}

export function WorkbenchStatusCard({
  eyebrow = '协作工作台',
  title,
  message,
  actionLabel,
  actionHref,
}: WorkbenchStatusCardProps) {
  return (
    <main className='min-h-screen bg-[#f7f4ed] px-6 py-10 text-[#271f18]'>
      <section className='mx-auto max-w-3xl rounded-[2rem] border border-[#e2d8c7] bg-white p-10 shadow-sm'>
        <p className='text-[#9b5b2e] text-sm font-medium'>{eyebrow}</p>
        <h1 className='mt-3 text-3xl font-semibold tracking-tight'>{title}</h1>
        <p className='mt-4 text-[#6f6256]'>{message}</p>
        {actionLabel && actionHref && (
          <Link
            className='mt-6 inline-flex rounded-xl bg-[#271f18] px-5 py-3 font-semibold text-sm text-white'
            href={actionHref}
          >
            {actionLabel}
          </Link>
        )}
      </section>
    </main>
  )
}
