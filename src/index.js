require('dotenv').config()

const express = require('express')
const cors    = require('cors')
const app     = express()

app.use(cors())
app.use(express.json({ limit: '50mb' }))

// Catch body parse errors (payload too large, invalid JSON, etc.)
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    console.error(`[BODY] Payload too large: ${req.headers['content-length']} bytes`)
    return res.status(413).json({ success: false, error: 'Payload too large' })
  }
  if (err.type === 'entity.parse.failed') {
    console.error(`[BODY] Invalid JSON body`)
    return res.status(400).json({ success: false, error: 'Invalid JSON' })
  }
  next(err)
})

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }))

// NPCI routes
app.use('/api/npci', require('./routes/npci'))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`AutoPayy backend running on port ${PORT}`))
