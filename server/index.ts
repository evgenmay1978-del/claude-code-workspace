import { createServer } from 'node:http'
import { URL } from 'node:url'
import { WebSocketServer } from 'ws'
import { createApp } from './app.js'
import { resolveSession } from './auth/router.js'
import { openDatabase } from './db.js'
import { TerminalManager } from './terminal/manager.js'

const database = openDatabase()
const terminalManager = new TerminalManager(database)
const app = createApp(database, terminalManager)
const server = createServer(app)
const webSockets = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 })
const terminalPath = /^\/ws\/terminal\/([0-9a-f-]{36})$/i

function rejectUpgrade(socket: import('node:stream').Duplex, status: number, label: string) {
  socket.write(`HTTP/1.1 ${status} ${label}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  socket.destroy()
}

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const match = terminalPath.exec(url.pathname)
  if (!match) return rejectUpgrade(socket, 404, 'Not Found')

  const principal = resolveSession(database, request.headers.cookie)
  if (!principal) return rejectUpgrade(socket, 401, 'Unauthorized')
  if (!terminalManager.owns(match[1], principal.userId)) return rejectUpgrade(socket, 404, 'Not Found')

  const origin = request.headers.origin
  const publicOrigin = process.env.PUBLIC_ORIGIN
  const expectedHost = (request.headers['x-forwarded-host'] ?? request.headers.host ?? '').toString().split(',')[0].trim().toLowerCase()
  try {
    if (!origin) return rejectUpgrade(socket, 403, 'Forbidden')
    const originUrl = new URL(origin)
    const expectedOriginHost = publicOrigin ? new URL(publicOrigin).host.toLowerCase() : expectedHost
    if (originUrl.host.toLowerCase() !== expectedOriginHost) return rejectUpgrade(socket, 403, 'Forbidden')
  } catch {
    return rejectUpgrade(socket, 403, 'Forbidden')
  }

  webSockets.handleUpgrade(request, socket, head, client => {
    if (!terminalManager.attach(match[1], principal.userId, client)) {
      client.close(1008, 'terminal unavailable')
      return
    }
    webSockets.emit('connection', client, request)
  })
})

const port = Number(process.env.API_PORT ?? process.env.PORT ?? 3000)
const host = process.env.HOST ?? '0.0.0.0'
server.listen(port, host, () => {
  console.info(`Polar Workspace listening on ${host}:${port}`)
})

function shutdown() {
  webSockets.close()
  terminalManager.shutdown()
  server.close(() => {
    database.close()
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
