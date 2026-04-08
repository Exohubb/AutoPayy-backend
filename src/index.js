require('dotenv').config()

const express = require('express')
const cors = require('cors')
const app = express()

// ── In-memory log buffer (viewable via /api/npci/logs) ────────────
const logBuffer = []
global.logBuffer = logBuffer
const MAX_LOGS = 200
const origLog = console.log
const origError = console.error

console.log = (...args) => {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
  logBuffer.push({ t: new Date().toISOString(), m: msg })
  if (logBuffer.length > MAX_LOGS) logBuffer.shift()
  origLog.apply(console, args)
}

console.error = (...args) => {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
  logBuffer.push({ t: new Date().toISOString(), m: '[ERR] ' + msg })
  if (logBuffer.length > MAX_LOGS) logBuffer.shift()
  origError.apply(console, args)
}

app.use(cors())

// Log ALL incoming requests
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url} content-type:${req.headers['content-type'] || 'NONE'} len:${req.headers['content-length'] || 'NONE'}`)
  next()
})

// Parse JSON for all routes EXCEPT /api/npci/extract (manual body parse there)
app.use((req, res, next) => {
  if (req.method === 'POST' && (req.url === '/api/npci/extract' || req.path === '/api/npci/extract')) {
    next()
  } else {
    express.json({ limit: '50mb' })(req, res, (err) => {
      if (err) {
        console.error(`[BODY] Parse error for ${req.url}: ${err.type} ${err.message}`)
      }
      next()
    })
  }
})

// Health check
app.get('/health', (_req, res) => res.json({
  status: 'ok',
  version: 'v7-full-fields',
  timestamp: new Date().toISOString()
}))

// NPCI routes
app.use('/api/npci', require('./routes/npci'))

// Payment routes (Razorpay)
app.use('/api/payments', require('./routes/payments'))

// Global error handler
app.use((err, req, res, next) => {
  console.error(`[GLOBAL-ERROR] ${req.method} ${req.url}: ${err.message}`)
  res.status(500).json({ success: false, error: err.message })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`AutoPayy backend v7-full-fields running on port ${PORT}`))
