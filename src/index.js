require('dotenv').config()

const express = require('express')
const cors    = require('cors')
const app     = express()

app.use(cors())

// Log ALL requests before body parsing
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url} content-type: ${req.headers['content-type'] || 'NONE'} content-length: ${req.headers['content-length'] || 'NONE'}`)
  next()
})

// Parse JSON body — but SKIP for /api/npci/extract (handled manually in route)
app.use((req, res, next) => {
  if (req.method === 'POST' && req.url === '/api/npci/extract') {
    // Skip express.json() — the route handler will parse body manually
    next()
  } else {
    express.json({ limit: '50mb' })(req, res, next)
  }
})

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }))

// NPCI routes
app.use('/api/npci', require('./routes/npci'))

// Global error handler
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.url} → ${err.type || 'unknown'}: ${err.message}`)
  res.status(500).json({ success: false, error: err.message })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`AutoPayy backend running on port ${PORT}`))
