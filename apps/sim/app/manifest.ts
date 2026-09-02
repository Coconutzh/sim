import type { MetadataRoute } from 'next'
import { getBrandConfig } from '@/ee/whitelabeling'

export const dynamic = 'force-dynamic'

export default function manifest(): MetadataRoute.Manifest {
  const brand = getBrandConfig()

  return {
    name: brand.name === 'Sim' ? 'SIM 项目监控' : `${brand.name} 项目监控`,
    short_name: brand.name === 'Sim' ? 'SIM 监控' : brand.name,
    description: '面向领导的 SIM 项目进度、风险与任务监控门户。',
    start_url: '/mobile',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: brand.theme?.primaryColor || '#6F3DFA',
    orientation: 'portrait-primary',
    icons: [
      {
        src: '/favicon/android-chrome-192x192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/favicon/android-chrome-512x512.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/favicon/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
    categories: ['productivity', 'business'],
    shortcuts: [
      {
        name: '项目监控',
        short_name: '监控',
        description: '查看项目进度与风险',
        url: '/mobile',
      },
    ],
    lang: 'zh-CN',
    dir: 'ltr',
  }
}
