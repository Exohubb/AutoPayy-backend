require('dotenv').config()

const express = require('express')
const cors    = require('cors')
const app     = express()

app.use(cors())
app.use(express.json({ limit: '1mb' }))

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }))

// NPCI routes
app.use('/api/npci', require('./routes/npci'))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`AutoPayy backend running on port ${PORT}`))
