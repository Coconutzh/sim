const fs = require('node:fs/promises')
const path = require('node:path')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const DEFAULT_MANIFEST_PATH = path.join(REPO_ROOT, 'imgs', 'mixamo', 'manifest.json')
const DEFAULT_REPORT_PATH = path.join(REPO_ROOT, 'imgs', 'mixamo', 'mismatches.json')

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
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

function parseArgs(argv) {
  const options = {
    manifestPath: DEFAULT_MANIFEST_PATH,
    reportPath: DEFAULT_REPORT_PATH,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = argv[index + 1]

    if (arg === '--manifest') {
      options.manifestPath = path.resolve(value)
      index += 1
    } else if (arg === '--report') {
      options.reportPath = path.resolve(value)
      index += 1
    }
  }

  return options
}

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2))
  const manifest = JSON.parse(await fs.readFile(options.manifestPath, 'utf8'))
  const downloaded = (manifest.items || []).filter((item) => item.status === 'downloaded')
  const mismatches = []
  const missingEvidence = []
  const missingFiles = []

  for (const item of downloaded) {
    if (item.filePath && !(await exists(item.filePath))) {
      missingFiles.push(item)
    }

    const evidenceName = item.suggestedFilename || item.selectedTitle
    if (!evidenceName) {
      missingEvidence.push(item)
      continue
    }

    if (!animationNamesMatch(item.name, evidenceName)) {
      mismatches.push({
        name: item.name,
        pageNumber: item.pageNumber,
        filePath: item.filePath,
        fileName: item.fileName,
        suggestedFilename: item.suggestedFilename,
        selectedTitle: item.selectedTitle,
        downloadedAt: item.downloadedAt,
        inPlace: item.inPlace,
      })
    }
  }

  const topActualNames = Object.entries(
    mismatches.reduce((counts, item) => {
      const actual = item.suggestedFilename || item.selectedTitle || '[unknown]'
      counts[actual] = (counts[actual] || 0) + 1
      return counts
    }, {})
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([name, count]) => ({ name, count }))

  const report = {
    manifestPath: options.manifestPath,
    checkedAt: new Date().toISOString(),
    totals: {
      downloaded: downloaded.length,
      trusted: downloaded.length - mismatches.length - missingEvidence.length,
      mismatches: mismatches.length,
      missingEvidence: missingEvidence.length,
      missingFiles: missingFiles.length,
    },
    topActualNames,
    mismatches,
    missingEvidence: missingEvidence.map((item) => ({
      name: item.name,
      pageNumber: item.pageNumber,
      filePath: item.filePath,
      fileName: item.fileName,
      suggestedFilename: item.suggestedFilename,
      selectedTitle: item.selectedTitle,
    })),
    missingFiles: missingFiles.map((item) => ({
      name: item.name,
      pageNumber: item.pageNumber,
      filePath: item.filePath,
      fileName: item.fileName,
    })),
  }

  await fs.mkdir(path.dirname(options.reportPath), { recursive: true })
  await fs.writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`)

  process.stdout.write(`${JSON.stringify(report.totals, null, 2)}\n`)
  process.stdout.write(`Report: ${options.reportPath}\n`)
  if (topActualNames.length > 0) {
    process.stdout.write(`Top repeated actual downloads: ${JSON.stringify(topActualNames.slice(0, 8))}\n`)
  }
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`)
  process.exitCode = 1
})
