import Database from 'better-sqlite3'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const dataDirectory = resolve(process.env.DATA_DIR ?? '/data')
const databasePath = resolve(process.env.DB_PATH ?? join(dataDirectory, 'claude-workspace.sqlite'))
const workspacesDirectory = resolve(process.env.WORKSPACES_DIR ?? '/workspaces')
const configDirectory = resolve(process.env.CLAUDE_CONFIG_DIR ?? '/claude-config/.claude')
const homeDirectory = resolve(process.env.CLAUDE_HOME ?? '/claude-config/home')
const archivePath = resolve(process.env.BACKUP_ARCHIVE ?? '/tmp/polar-backup.tar.gz')
const staging = mkdtempSync(join(tmpdir(), 'polar-backup-'))

function copyContents(source, destination, excluded = new Set()) {
  mkdirSync(destination, { recursive: true, mode: 0o700 })
  if (!existsSync(source)) return
  for (const entry of readdirSync(source)) {
    if (excluded.has(entry)) continue
    cpSync(join(source, entry), join(destination, entry), {
      recursive: true,
      force: true,
      dereference: false,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    })
  }
}

try {
  if (!existsSync(databasePath)) throw new Error(`Database not found: ${databasePath}`)
  const dataTarget = join(staging, 'data')
  const workspaceTarget = join(staging, 'workspaces')
  const configTarget = join(staging, 'claude-config')
  const homeTarget = join(configTarget, 'home')
  const snapshotPath = join(dataTarget, basename(databasePath))

  copyContents(dataDirectory, dataTarget, new Set([
    basename(databasePath),
    `${basename(databasePath)}-wal`,
    `${basename(databasePath)}-shm`,
  ]))
  mkdirSync(dataTarget, { recursive: true, mode: 0o700 })

  const database = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    await database.backup(snapshotPath)
  } finally {
    database.close()
  }

  copyContents(workspacesDirectory, workspaceTarget)
  copyContents(configDirectory, join(configTarget, '.claude'))
  copyContents(homeDirectory, homeTarget)
  rmSync(archivePath, { force: true })
  execFileSync('tar', ['--create', '--gzip', '--file', archivePath, '--directory', staging, '.'], { stdio: 'inherit' })
  console.log(`Backup archive created at ${archivePath}`)
} finally {
  rmSync(staging, { recursive: true, force: true })
}
