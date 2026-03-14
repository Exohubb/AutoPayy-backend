require('dotenv').config()

const express = require('express')
const cors    = require('cors')
const app     = express()

app.use(cors())

// Log ALL requests BEFORE body parsing
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url} content-type: ${req.headers['content-type'] || 'NONE'} content-length: ${req.headers['content-length'] || 'NONE'}`)
  next()
})

// Parse JSON with generous limit
app.use(express.json({ limit: '50mb' }))

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }))

// NPCI routes
app.use('/api/npci', require('./routes/npci'))

// Global error handler (MUST be after routes)
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.url} → ${err.type || 'unknown'}: ${err.message}`)
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, error: 'Payload too large' })
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: 'Invalid JSON body' })
  }
  res.status(500).json({ success: false, error: err.message })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`AutoPayy backend running on port ${PORT}`))
