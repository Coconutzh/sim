const fs = require('node:fs/promises')
const path = require('node:path')
const { chromium } = require('playwright')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const DEFAULT_MIXAMO_URL = 'https://www.mixamo.com/#/?page=1'

function parseArgs(argv) {
  const options = {
    limit: 100,
    startPage: 1,
    maxPages: 120,
    delayMs: 1200,
    selectionSettleMs: 6500,
    mismatchRetryLimit: 2,
    downloadTimeoutMs: 240000,
    headless: false,
    force: false,
    allPages: false,
    useDefaultChromeProfile: false,
    startUrl: DEFAULT_MIXAMO_URL,
    chromePath: '',
    downloadDir: path.join(REPO_ROOT, 'imgs', 'mixamo', 'fbx'),
    browserProfileDir: path.join(REPO_ROOT, 'imgs', 'mixamo', 'browser-profile'),
    manifestPath: path.join(REPO_ROOT, 'imgs', 'mixamo', 'manifest.json'),
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = argv[index + 1]

    if (arg === '--limit') {
      options.limit = Number(value)
      index += 1
    } else if (arg === '--start-page') {
      options.startPage = Number(value)
      index += 1
    } else if (arg === '--max-pages') {
      options.maxPages = Number(value)
      index += 1
    } else if (arg === '--delay-ms') {
      options.delayMs = Number(value)
      index += 1
    } else if (arg === '--selection-settle-ms') {
      options.selectionSettleMs = Number(value)
      index += 1
    } else if (arg === '--mismatch-retry-limit') {
      options.mismatchRetryLimit = Number(value)
      index += 1
    } else if (arg === '--download-timeout-ms') {
      options.downloadTimeoutMs = Number(value)
      index += 1
    } else if (arg === '--download-dir') {
      options.downloadDir = path.resolve(value)
      index += 1
    } else if (arg === '--manifest') {
      options.manifestPath = path.resolve(value)
      index += 1
    } else if (arg === '--browser-profile-dir') {
      options.browserProfileDir = path.resolve(value)
      index += 1
    } else if (arg === '--start-url') {
      options.startUrl = value
      index += 1
    } else if (arg === '--chrome-path') {
      options.chromePath = value
      index += 1
    } else if (arg === '--headless') {
      options.headless = true
    } else if (arg === '--force') {
      options.force = true
    } else if (arg === '--all-pages') {
      options.allPages = true
    } else if (arg === '--use-default-chrome-profile') {
      options.useDefaultChromeProfile = true
    }
  }

  if (!Number.isFinite(options.limit) || options.limit < 1) {
    throw new Error('--limit must be a positive number')
  }
  if (!Number.isFinite(options.startPage) || options.startPage < 1) {
    throw new Error('--start-page must be a positive number')
  }
  if (!Number.isFinite(options.maxPages) || options.maxPages < options.startPage) {
    throw new Error('--max-pages must be greater than or equal to --start-page')
  }
  if (!Number.isFinite(options.selectionSettleMs) || options.selectionSettleMs < 0) {
    throw new Error('--selection-settle-ms must be zero or a positive number')
  }
  if (!Number.isInteger(options.mismatchRetryLimit) || options.mismatchRetryLimit < 0) {
    throw new Error('--mismatch-retry-limit must be zero or a positive integer')
  }

  return options
}

function log(message, data) {
  const suffix = data === undefined ? '' : ` ${JSON.stringify(data)}`
  process.stdout.write(`[${new Date().toISOString()}] ${message}${suffix}\n`)
}

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function readJson(filePath, fallback) {
  try {
    const content = await fs.readFile(filePath, 'utf8')
    return JSON.parse(content)
  } catch {
    return fallback
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`)
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeKey(value) {
  return extractAnimationName(value).toLowerCase()
}

function extractAnimationName(value) {
  return normalizeText(value).replace(/\s+Description:.*$/i, '').trim()
}

function normalizeAnimationIdentity(value) {
  return extractAnimationName(value)
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function animationNamesMatch(expected, actual) {
  return (
    normalizeAnimationIdentity(expected) !== '' &&
    normalizeAnimationIdentity(expected) === normalizeAnimationIdentity(actual)
  )
}

function isTrustedDownloadedItem(item) {
  if (!item || item.status !== 'downloaded' || !item.filePath) return false
  const evidenceName = item.suggestedFilename || item.selectedTitle
  return Boolean(evidenceName && animationNamesMatch(item.name, evidenceName))
}

function sanitizeFileBase(name) {
  const cleaned = extractAnimationName(name)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/[^A-Za-z0-9._ -]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 140)

  return cleaned || 'mixamo_animation'
}

function targetPathForName(name, suggestedFilename, downloadDir) {
  const suggestedExt = path.extname(suggestedFilename || '')
  const extension = suggestedExt || '.fbx'
  return path.join(downloadDir, `${sanitizeFileBase(name)}${extension.toLowerCase()}`)
}

function makePageUrl(startUrl, pageNumber) {
  const parsed = new URL(startUrl)
  const hash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash
  const [hashPath = '/', hashQuery = ''] = hash.split('?')
  const params = new URLSearchParams(hashQuery)
  params.set('page', String(pageNumber))
  parsed.hash = `${hashPath}?${params.toString()}`
  return parsed.toString()
}

function sanitizeUrlForLog(value) {
  try {
    const parsed = new URL(value)
    if (/adobe|adobelogin|services\.adobe/i.test(parsed.hostname)) {
      return `${parsed.origin}${parsed.pathname}?[redacted]`
    }
    if (parsed.hash.startsWith('#/imsauth')) {
      parsed.hash = '#/imsauth?[redacted]'
    }
    return parsed.toString()
  } catch {
    return '[invalid-url]'
  }
}

function buildManifestIndex(manifest) {
  const index = new Map()
  for (const item of manifest.items || []) {
    index.set(normalizeKey(item.name), item)
  }
  return index
}

async function loadManifest(options) {
  const manifest = await readJson(options.manifestPath, {
    version: 1,
    source: 'mixamo',
    createdAt: new Date().toISOString(),
    items: [],
  })

  manifest.updatedAt = new Date().toISOString()
  manifest.options = {
    limit: options.limit,
    startPage: options.startPage,
    maxPages: options.maxPages,
    allPages: options.allPages,
    defaultFormat: 'FBX Binary(.fbx)',
    skin: 'With Skin',
  }

  return manifest
}

async function launchContext(options) {
  const defaultUserDataDir = path.join(
    process.env.LOCALAPPDATA || '',
    'Google',
    'Chrome',
    'User Data'
  )
  const userDataDir = options.useDefaultChromeProfile
    ? defaultUserDataDir
    : options.browserProfileDir
  const args = ['--disable-blink-features=AutomationControlled']

  if (options.useDefaultChromeProfile) {
    args.push('--profile-directory=Default')
  }

  const launchOptions = {
    headless: options.headless,
    acceptDownloads: true,
    downloadsPath: path.join(path.dirname(options.manifestPath), 'tmp-downloads'),
    viewport: { width: 1600, height: 1000 },
    args,
  }

  if (options.chromePath) {
    launchOptions.executablePath = options.chromePath
  }

  try {
    return await chromium.launchPersistentContext(userDataDir, launchOptions)
  } catch (error) {
    if (!options.useDefaultChromeProfile) {
      throw error
    }

    log('Default Chrome profile could not be opened, falling back to a local browser profile', {
      error: error.message,
    })
    return chromium.launchPersistentContext(options.browserProfileDir, {
      ...launchOptions,
      args: ['--disable-blink-features=AutomationControlled'],
    })
  }
}

async function tryAutoAdobeLogin(page, loginState) {
  const email = process.env.MIXAMO_ADOBE_EMAIL || process.env.MIXAMO_EMAIL || ''
  const password = process.env.MIXAMO_ADOBE_PASSWORD || process.env.MIXAMO_PASSWORD || ''

  if (!email || !password) {
    return { action: 'missing-credentials' }
  }

  const result = await page.evaluate(
    ({ emailValue, passwordValue, submittedEmail, submittedPassword }) => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity || '1') > 0 &&
          !element.disabled
        )
      }
      const setValue = (input, value) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        setter?.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }
      const clickButton = (pattern) => {
        const target = Array.from(document.querySelectorAll('button, input[type="submit"], div[role="button"]'))
          .filter(isVisible)
          .find((element) => {
            const text = normalize(element.innerText || element.textContent || element.value)
            const aria = normalize(element.getAttribute('aria-label') || '')
            return pattern.test(text) || pattern.test(aria)
          })

        if (!target) return false
        target.click()
        return true
      }
      const visibleInputs = Array.from(document.querySelectorAll('input')).filter(isVisible)
      const passwordInput = visibleInputs.find(
        (input) => input.type === 'password' || /password|passwd/i.test(input.name || input.id || '')
      )
      const emailInput = visibleInputs.find(
        (input) =>
          input.type === 'email' ||
          /email|username|account/i.test(
            `${input.name || ''} ${input.id || ''} ${input.placeholder || ''} ${input.getAttribute('aria-label') || ''}`
          )
      )

      if (passwordInput && !submittedPassword) {
        passwordInput.focus()
        setValue(passwordInput, passwordValue)
        const clicked = clickButton(/^(sign in|log in|continue|next)$/i)
        return { action: clicked ? 'submitted-password' : 'filled-password' }
      }

      if (emailInput && !submittedEmail) {
        emailInput.focus()
        setValue(emailInput, emailValue)
        const clicked = clickButton(/^(continue|next)$/i)
        return { action: clicked ? 'submitted-email' : 'filled-email' }
      }

      return { action: 'no-login-field' }
    },
    {
      emailValue: email,
      passwordValue: password,
      submittedEmail: loginState.submittedEmail,
      submittedPassword: loginState.submittedPassword,
    }
  )

  if (result.action === 'submitted-email') {
    loginState.submittedEmail = true
    log('Submitted Adobe email from environment; waiting for password step')
    await page.waitForTimeout(5000)
  } else if (result.action === 'submitted-password') {
    loginState.submittedPassword = true
    log('Submitted Adobe password from environment; waiting for Mixamo UI')
    await page.waitForTimeout(8000)
  } else if (result.action === 'filled-email' || result.action === 'filled-password') {
    log('Filled Adobe login field but could not find submit button', { step: result.action })
    await page.waitForTimeout(3000)
  }

  return result
}

async function waitForMixamoReady(page) {
  let lastLogAt = 0
  let clickedLogin = false
  let nudgedToAnimations = false
  const loginState = {
    submittedEmail: false,
    submittedPassword: false,
  }

  for (let attempt = 0; attempt < 420; attempt += 1) {
    let state
    try {
      state = await page.evaluate(() => {
        const bodyText = document.body?.innerText || ''
        return {
          hasAnimations: /Animations/i.test(bodyText),
          hasSearch:
            /Search/i.test(bodyText) ||
            Array.from(document.querySelectorAll('input')).some((input) =>
              /search/i.test(input.getAttribute('placeholder') || input.getAttribute('aria-label') || '')
            ),
          hasAppControls: /24 Per Page|Upload Character|Aero Update|Default Character|Download Settings/i.test(
            bodyText
          ),
          hasLandingLogin: /Get animated\.|Sign Up for Free|Log In/i.test(bodyText),
          hasAdobeLogin: /sign in|email address|continue|adobe account/i.test(bodyText),
          url: location.href,
        }
      })
    } catch (error) {
      if (/Execution context was destroyed|Cannot find context|Target closed/i.test(error.message)) {
        await page.waitForTimeout(1000)
        continue
      }
      throw error
    }
    state.url = sanitizeUrlForLog(state.url)

    if (state.hasAnimations && state.hasAppControls) {
      return
    }

    if (
      !nudgedToAnimations &&
      state.hasAnimations &&
      state.hasAppControls &&
      !state.hasSearch &&
      state.url.startsWith('https://www.mixamo.com/')
    ) {
      nudgedToAnimations = true
      log('Mixamo is authenticated but not on the animation grid; navigating to animations page')
      await page.goto(DEFAULT_MIXAMO_URL, { waitUntil: 'domcontentloaded', timeout: 90000 })
      await page.waitForTimeout(2500)
      continue
    }

    if (state.hasLandingLogin && !clickedLogin) {
      const clicked = await page.evaluate(() => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
        const visible = (element) => {
          const rect = element.getBoundingClientRect()
          const style = window.getComputedStyle(element)
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden'
        }
        const target = Array.from(document.querySelectorAll('a, button'))
          .filter((element) => normalize(element.innerText || element.textContent) === 'log in')
          .filter(visible)
          .sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0]

        if (!target) return false
        target.click()
        return true
      })

      if (clicked) {
        clickedLogin = true
        log('Clicked Mixamo Log In button; waiting for Adobe login or app UI')
        await page.waitForTimeout(2000)
      }
    }

    if (state.hasAdobeLogin) {
      await tryAutoAdobeLogin(page, loginState)
    }

    const now = Date.now()
    if (now - lastLogAt > 15000) {
      log('Waiting for Mixamo UI; finish login in the opened browser if needed', state)
      lastLogAt = now
    }
    await page.waitForTimeout(1000)
  }

  throw new Error('Timed out waiting for Mixamo to become ready')
}

async function getScrollHandle(page) {
  return page.evaluateHandle(() => {
    const elements = Array.from(document.querySelectorAll('body *'))
    const candidates = elements
      .map((element) => {
        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        return { element, rect, style }
      })
      .filter(({ element, rect, style }) => {
        if (style.display === 'none' || style.visibility === 'hidden') return false
        if (rect.left < -5 || rect.top < 70) return false
        if (rect.left > window.innerWidth * 0.58) return false
        if (rect.width < 280 || rect.height < 250) return false
        return element.scrollHeight > element.clientHeight + 80
      })
      .sort((a, b) => b.element.scrollHeight - a.element.scrollHeight)

    return candidates[0]?.element || document.scrollingElement || document.documentElement
  })
}

async function getScrollMetrics(scrollHandle) {
  return scrollHandle.evaluate((element) => ({
    clientHeight: element.clientHeight || window.innerHeight,
    scrollHeight: element.scrollHeight || document.documentElement.scrollHeight,
  }))
}

async function setScrollPosition(scrollHandle, position) {
  await scrollHandle.evaluate((element, value) => {
    element.scrollTop = value
  }, position)
}

async function getVisibleCardCandidates(page) {
  return page.evaluate(() => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim()
    const extractAnimationName = (value) =>
      normalize(value)
        .replace(/\s+Description:.*$/i, '')
        .trim()
    const isVisible = (element, rect) => {
      const style = window.getComputedStyle(element)
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || '1') > 0 &&
        rect.width > 0 &&
        rect.height > 0
      )
    }
    const blocked = /download|upload|aero update|characters|animations|search|privacy|terms|cookie|adobe|per page|copyright|part of/i
    const rawCandidates = []

    for (const element of Array.from(document.querySelectorAll('a, button, li, div'))) {
      const rect = element.getBoundingClientRect()
      if (!isVisible(element, rect)) continue
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      if (rect.left < 0 || rect.top < 115) continue
      if (rect.bottom < 130 || rect.top > window.innerHeight - 30) continue
      if (rect.right > window.innerWidth * 0.58) continue
      if (centerX < 0 || centerX > window.innerWidth * 0.58) continue
      if (centerY < 130 || centerY > window.innerHeight - 30) continue
      if (rect.width < 90 || rect.width > 380) continue
      if (rect.height < 70 || rect.height > 380) continue

      const rawText = normalize(element.innerText || element.textContent)
      const text = extractAnimationName(rawText)
      if (!text || text.length > 90) continue
      if (text.includes('\n')) continue
      if (/^\d+$/.test(text)) continue
      if (blocked.test(text)) continue

      const hasMedia = Boolean(element.querySelector('img, canvas, video, svg'))
      const hasLargeChild = Array.from(element.children).some((child) => {
        const childRect = child.getBoundingClientRect()
        return childRect.width > 60 && childRect.height > 60
      })

      if (!hasMedia && !hasLargeChild && rect.height < rect.width * 0.8) continue

      rawCandidates.push({
        text,
        x: centerX,
        y: centerY,
        top: rect.top,
        left: rect.left,
        area: rect.width * rect.height,
      })
    }

    const byText = new Map()
    for (const candidate of rawCandidates) {
      const key = candidate.text.toLowerCase()
      const existing = byText.get(key)
      if (!existing || candidate.area < existing.area) {
        byText.set(key, candidate)
      }
    }

    return Array.from(byText.values()).sort((a, b) => a.top - b.top || a.left - b.left)
  })
}

async function getSelectedAnimationCandidates(page) {
  return page.evaluate(() => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim()
    const cleanTitle = (value) =>
      normalize(value)
        .replace(/\s+on\s+(default character|x bot|y bot)$/i, '')
        .trim()
    const isVisible = (element, rect) => {
      const style = window.getComputedStyle(element)
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || '1') > 0 &&
        rect.width > 0 &&
        rect.height > 0
      )
    }
    const blocked =
      /download|upload character|aero update|body height|style|overdrive|character arm-space|trim|mirror|in place|format|skin|frames per second|keyframe reduction|download settings|cancel|search|characters|animations/i
    const candidates = []

    for (const element of Array.from(document.querySelectorAll('h1, h2, h3, header, div, span'))) {
      const rect = element.getBoundingClientRect()
      if (!isVisible(element, rect)) continue
      if (rect.left < window.innerWidth * 0.48) continue
      if (rect.top < 70 || rect.top > window.innerHeight * 0.75) continue

      const lines = String(element.innerText || element.textContent || '')
        .split(/\n+/)
        .map(cleanTitle)
        .filter(Boolean)

      for (const text of lines) {
        if (text.length < 2 || text.length > 100) continue
        if (blocked.test(text)) continue
        if (/^\d+(\s*\/\s*\d+)?$/.test(text)) continue

        candidates.push({
          text,
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        })
      }
    }

    const byText = new Map()
    for (const candidate of candidates) {
      const key = candidate.text.toLowerCase()
      const existing = byText.get(key)
      const score =
        (candidate.left > window.innerWidth * 0.72 ? 2 : 0) +
        (candidate.top < 180 ? 1 : 0) -
        candidate.width / 10000
      if (!existing || score > existing.score) {
        byText.set(key, { ...candidate, score })
      }
    }

    return Array.from(byText.values())
      .sort((a, b) => b.score - a.score || a.top - b.top)
      .slice(0, 12)
      .map(({ score, ...candidate }) => candidate)
  })
}

async function waitForSelectedAnimation(page, name, timeoutMs = 30000) {
  const startedAt = Date.now()
  let lastCandidates = []

  while (Date.now() - startedAt < timeoutMs) {
    lastCandidates = await getSelectedAnimationCandidates(page)
    const match = lastCandidates.find((candidate) => animationNamesMatch(name, candidate.text))

    if (match) {
      return {
        selectedTitle: match.text,
        candidates: lastCandidates.map((candidate) => candidate.text),
      }
    }

    await page.waitForTimeout(500)
  }

  throw new Error(
    `Selected animation did not become "${name}". Visible right-panel titles: ${lastCandidates
      .map((candidate) => candidate.text)
      .join(' | ')}`
  )
}

async function collectCardsOnCurrentPage(page) {
  const scrollHandle = await getScrollHandle(page)
  const metrics = await getScrollMetrics(scrollHandle)
  const step = Math.max(260, Math.floor(metrics.clientHeight * 0.7))
  const maxScroll = Math.max(0, metrics.scrollHeight - metrics.clientHeight)
  const seen = new Map()

  for (let position = 0; position <= maxScroll + 20; position += step) {
    await setScrollPosition(scrollHandle, Math.min(position, maxScroll))
    await page.waitForTimeout(450)
    const candidates = await getVisibleCardCandidates(page)
    for (const candidate of candidates) {
      const key = normalizeKey(candidate.text)
      if (!seen.has(key)) {
        seen.set(key, {
          name: candidate.text,
          scrollTop: Math.min(position, maxScroll),
        })
      }
    }
  }

  await setScrollPosition(scrollHandle, 0)
  await page.waitForTimeout(300)
  await scrollHandle.dispose()
  return Array.from(seen.values())
}

function buildScrollSearchPositions(maxScroll, step, scrollHint) {
  const positions = []
  const add = (value) => {
    const normalized = Math.max(0, Math.min(maxScroll, Math.round(value)))
    if (!positions.includes(normalized)) {
      positions.push(normalized)
    }
  }

  if (Number.isFinite(scrollHint)) {
    add(scrollHint - step)
    add(scrollHint)
    add(scrollHint + step)
  }

  for (let position = 0; position <= maxScroll + 20; position += step) {
    add(position)
  }

  return positions
}

async function clickCardByName(page, name, cardHint = {}) {
  const targetKey = normalizeKey(name)
  const scrollHandle = await getScrollHandle(page)
  const metrics = await getScrollMetrics(scrollHandle)
  const step = Math.max(260, Math.floor(metrics.clientHeight * 0.7))
  const maxScroll = Math.max(0, metrics.scrollHeight - metrics.clientHeight)
  let lastSelectionError = ''
  const searchPositions = buildScrollSearchPositions(maxScroll, step, cardHint.scrollTop)

  for (const position of searchPositions) {
    await setScrollPosition(scrollHandle, position)
    await page.waitForTimeout(350)
    const candidates = await getVisibleCardCandidates(page)
    const candidate = candidates.find((item) => normalizeKey(item.text) === targetKey)

    if (candidate) {
      await page.mouse.click(candidate.x, candidate.y)
      try {
        const selected = await waitForSelectedAnimation(page, name, 18000)
        await scrollHandle.dispose()
        return selected
      } catch (error) {
        lastSelectionError = error.message
      }
    }
  }

  await scrollHandle.dispose()
  throw new Error(
    lastSelectionError || `Could not select animation card after clicking candidates: ${name}`
  )
}

async function waitForSelectionToSettle(page, name, options) {
  if (options.selectionSettleMs > 0) {
    await page.waitForTimeout(options.selectionSettleMs)
  }
  return waitForSelectedAnimation(page, name, 15000)
}

async function enableInPlaceIfAvailable(page) {
  const result = await page.evaluate(() => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
    const visible = (element) => {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
      )
    }
    const labels = Array.from(document.querySelectorAll('label, span, div'))
      .filter((element) => normalize(element.innerText || element.textContent) === 'in place')
      .filter(visible)
      .sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left)

    for (const label of labels) {
      let scope = label.closest('label') || label.parentElement
      for (let depth = 0; scope && depth < 4; depth += 1, scope = scope.parentElement) {
        const checkboxes = Array.from(scope.querySelectorAll('input[type="checkbox"]'))
        const checkbox = checkboxes.find(visible)
        if (checkbox) {
          const before = checkbox.checked
          if (!before) checkbox.click()
          return { found: true, before, after: checkbox.checked, method: 'checkbox' }
        }
      }

      label.click()
      return { found: true, before: null, after: null, method: 'label' }
    }

    return { found: false, before: null, after: null, method: 'none' }
  })

  if (result.found && result.before === false) {
    await page.waitForTimeout(2600)
  }

  return result
}

async function clickMainDownloadButton(page) {
  const clicked = await page.evaluate(() => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
    const visible = (element) => {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      return (
        rect.width >= 70 &&
        rect.height >= 24 &&
        rect.height <= 90 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || '1') > 0
      )
    }
    const candidates = Array.from(document.querySelectorAll('button, a, div'))
      .filter((element) => normalize(element.innerText || element.textContent) === 'download')
      .filter(visible)
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.left > window.innerWidth * 0.55 && rect.top < 320)
      .sort((a, b) => a.rect.top - b.rect.top)

    const target = candidates[0]?.element
    if (!target) return false
    target.click()
    return true
  })

  if (!clicked) {
    throw new Error('Could not find the main Mixamo DOWNLOAD button')
  }
}

async function waitForDownloadDialog(page) {
  await page.waitForFunction(() => /download settings/i.test(document.body?.innerText || ''), null, {
    timeout: 60000,
  })
}

async function ensureDownloadSettings(page) {
  await page.evaluate(() => {
    const dispatch = (select) => {
      select.dispatchEvent(new Event('input', { bubbles: true }))
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }

    for (const select of Array.from(document.querySelectorAll('select'))) {
      const options = Array.from(select.options)
      const withSkin = options.find((option) => /with skin/i.test(option.textContent || ''))
      const fbxBinary = options.find((option) => /fbx binary/i.test(option.textContent || ''))
      const fps30 = options.find((option) => /^30$/.test((option.textContent || '').trim()))
      const keyframeNone = options.find((option) => /^none$/i.test((option.textContent || '').trim()))

      if (withSkin) {
        select.value = withSkin.value
        dispatch(select)
      } else if (fbxBinary) {
        select.value = fbxBinary.value
        dispatch(select)
      } else if (fps30) {
        select.value = fps30.value
        dispatch(select)
      } else if (keyframeNone) {
        select.value = keyframeNone.value
        dispatch(select)
      }
    }
  })
}

async function clickDialogDownloadButton(page) {
  const clicked = await page.evaluate(() => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
    const visible = (element) => {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      return (
        rect.width >= 70 &&
        rect.height >= 24 &&
        rect.height <= 90 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || '1') > 0
      )
    }
    const candidates = Array.from(document.querySelectorAll('button, a, div'))
      .filter((element) => normalize(element.innerText || element.textContent) === 'download')
      .filter(visible)
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.left > window.innerWidth * 0.45 && rect.top > 260)
      .sort((a, b) => b.rect.top - a.rect.top)

    const target = candidates[0]?.element
    if (!target) return false
    target.click()
    return true
  })

  if (!clicked) {
    throw new Error('Could not find the dialog DOWNLOAD button')
  }
}

async function dismissDialog(page) {
  await page.keyboard.press('Escape').catch(() => undefined)
  await page.waitForTimeout(500)
}

async function downloadAnimation(page, name, options, cardHint = {}) {
  const selection = await clickCardByName(page, name, cardHint)

  await waitForSelectionToSettle(page, name, options)
  const inPlace = await enableInPlaceIfAvailable(page)
  await waitForSelectionToSettle(page, name, options)

  let lastMismatch = ''
  for (let attempt = 0; attempt <= options.mismatchRetryLimit; attempt += 1) {
    await waitForSelectedAnimation(page, name, 15000)
    await clickMainDownloadButton(page)
    await waitForDownloadDialog(page)
    await ensureDownloadSettings(page)

    const downloadPromise = page.waitForEvent('download', { timeout: options.downloadTimeoutMs })
    await clickDialogDownloadButton(page)
    const download = await downloadPromise
    const failure = await download.failure()

    if (failure) {
      throw new Error(`Download failed: ${failure}`)
    }

    const suggestedFilename = download.suggestedFilename()
    if (!animationNamesMatch(name, suggestedFilename)) {
      await download.delete().catch(() => undefined)
      await dismissDialog(page)
      lastMismatch = `Downloaded filename mismatch: requested "${name}", but Mixamo produced "${suggestedFilename}". Final file was not saved.`

      if (attempt < options.mismatchRetryLimit) {
        log('Downloaded filename mismatch; waiting and retrying same selected animation', {
          name,
          suggestedFilename,
          attempt: attempt + 1,
          retriesRemaining: options.mismatchRetryLimit - attempt,
        })
        await waitForSelectionToSettle(page, name, options)
        continue
      }

      throw new Error(lastMismatch)
    }

    const filePath = targetPathForName(name, suggestedFilename, options.downloadDir)
    await fs.mkdir(options.downloadDir, { recursive: true })
    await download.saveAs(filePath)
    await dismissDialog(page)

    return {
      filePath,
      fileName: path.basename(filePath),
      suggestedFilename,
      selectedTitle: selection.selectedTitle,
      inPlace,
    }
  }

  throw new Error(lastMismatch || `Failed to download animation: ${name}`)
}

async function countExistingDownloads(manifest) {
  let count = 0
  for (const item of manifest.items || []) {
    if (isTrustedDownloadedItem(item) && (await exists(item.filePath))) {
      count += 1
    }
  }
  return count
}

async function run() {
  const options = parseArgs(process.argv.slice(2))
  await fs.mkdir(options.downloadDir, { recursive: true })
  await fs.mkdir(path.dirname(options.manifestPath), { recursive: true })

  const manifest = await loadManifest(options)
  const manifestIndex = buildManifestIndex(manifest)
  let completed = options.force ? 0 : await countExistingDownloads(manifest)

  log('Starting Mixamo downloader', {
    limit: options.limit,
    completed,
    startPage: options.startPage,
    maxPages: options.maxPages,
    allPages: options.allPages,
    downloadDir: options.downloadDir,
    useDefaultChromeProfile: options.useDefaultChromeProfile,
  })

  const context = await launchContext(options)
  const page = context.pages()[0] || (await context.newPage())
  page.setDefaultTimeout(45000)

  try {
    await page.goto(makePageUrl(options.startUrl, options.startPage), {
      waitUntil: 'domcontentloaded',
      timeout: 90000,
    })
    await waitForMixamoReady(page)

    for (
      let pageNumber = options.startPage;
      pageNumber <= options.maxPages && (options.allPages || completed < options.limit);
      pageNumber += 1
    ) {
      const pageUrl = makePageUrl(options.startUrl, pageNumber)
      log('Opening animation page', { pageNumber, pageUrl })
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 90000 })
      await waitForMixamoReady(page)
      await page.waitForTimeout(2500)

      const cards = await collectCardsOnCurrentPage(page)
      const names = cards.map((card) => card.name)
      log('Collected visible animation cards', { pageNumber, count: names.length, names })

      if (names.length === 0) {
        log('No animation cards found on page, continuing', { pageNumber })
        continue
      }

      for (const card of cards) {
        const name = card.name
        if (!options.allPages && completed >= options.limit) break

        const key = normalizeKey(name)
        const existing = manifestIndex.get(key)
        if (
          !options.force &&
          isTrustedDownloadedItem(existing) &&
          (await exists(existing.filePath))
        ) {
          completed += 1
          log('Skipping existing download', { completed, name, filePath: existing.filePath })
          continue
        }

        if (
          !options.force &&
          existing?.status === 'downloaded' &&
          existing.filePath &&
          (await exists(existing.filePath))
        ) {
          log('Existing download is not trusted; redownloading', {
            name,
            filePath: existing.filePath,
            suggestedFilename: existing.suggestedFilename,
            selectedTitle: existing.selectedTitle,
          })
        }

        try {
          log('Downloading animation', { next: completed + 1, limit: options.limit, name })
          const result = await downloadAnimation(page, name, options, card)
          const item = {
            name,
            pageNumber,
            status: 'downloaded',
            filePath: result.filePath,
            fileName: result.fileName,
            suggestedFilename: result.suggestedFilename,
            selectedTitle: result.selectedTitle,
            inPlace: result.inPlace,
            downloadedAt: new Date().toISOString(),
          }

          manifestIndex.set(key, item)
          manifest.items = Array.from(manifestIndex.values())
          manifest.updatedAt = new Date().toISOString()
          await writeJson(options.manifestPath, manifest)
          completed += 1
          log('Downloaded animation', {
            completed,
            limit: options.limit,
            name,
            fileName: result.fileName,
            suggestedFilename: result.suggestedFilename,
            selectedTitle: result.selectedTitle,
            inPlace: result.inPlace,
          })
          await page.waitForTimeout(options.delayMs)
        } catch (error) {
          const item = {
            name,
            pageNumber,
            status: 'failed',
            error: error.message,
            failedAt: new Date().toISOString(),
          }

          manifestIndex.set(key, item)
          manifest.items = Array.from(manifestIndex.values())
          manifest.updatedAt = new Date().toISOString()
          await writeJson(options.manifestPath, manifest)
          log('Failed to download animation', { name, error: error.message })
          await dismissDialog(page)
          await page.waitForTimeout(options.delayMs)
        }
      }
    }
  } finally {
    manifest.updatedAt = new Date().toISOString()
    manifest.completed = completed
    await writeJson(options.manifestPath, manifest)
    await context.close().catch(() => undefined)
  }

  if (!options.allPages && completed < options.limit) {
    throw new Error(`Downloaded ${completed} animations, below requested limit ${options.limit}`)
  }

  log('Mixamo downloader finished', { completed, manifest: options.manifestPath })
}

run().catch((error) => {
  log('Mixamo downloader crashed', { error: error.stack || error.message })
  process.exitCode = 1
})
