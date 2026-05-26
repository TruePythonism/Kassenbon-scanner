export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
}

// Rate Limiting: 50 Scans pro Woche pro IP
const rateLimitMap = new Map()

function checkRateLimit(ip) {
  const now = Date.now()
  const weekMs = 7 * 24 * 60 * 60 * 1000
  
  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + weekMs })
    return { allowed: true, remaining: 49 }
  }
  
  const entry = rateLimitMap.get(ip)
  
  if (now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + weekMs })
    return { allowed: true, remaining: 49 }
  }
  
  if (entry.count >= 50) {
    const resetIn = Math.ceil((entry.resetAt - now) / (1000 * 60 * 60))
    return { allowed: false, remaining: 0, resetIn }
  }
  
  entry.count++
  return { allowed: true, remaining: 50 - entry.count }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Rate limit check
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown'
  const limit = checkRateLimit(ip)
  
  if (!limit.allowed) {
    return res.status(429).json({ 
      error: { message: `Wochenlimit erreicht (50 Scans). Noch ${limit.resetIn} Stunden bis zur Freischaltung.` }
    })
  }

  try {
    const { base64, mimeType } = req.body

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType || 'image/jpeg',
                data: base64,
              }
            },
            {
              type: 'text',
              text: `Du bist ein Kassenbon-Experte. Analysiere dieses Bon-Foto.
Antworte NUR mit JSON (kein Markdown):
{"store":"Geschäftsname","date":"YYYY-MM-DD","total":12.34,"items":[{"name":"Produkt","quantity":1,"price":1.99,"category":"Lebensmittel"}]}
Kategorien: Lebensmittel, Getränke, Haushalt, Hygiene, Snacks, Tiefkühlkost, Backwaren, Sonstiges
date: heutiges Datum falls nicht lesbar. total: Gesamtbetrag als Zahl. Falls kein Bon: total:0, items:[].`
            }
          ]
        }]
      })
    })

    const data = await response.json()
    if (data.error) throw new Error(data.error.message)
    
    const raw = data.content?.map(b => b.text || '').join('') || '{}'
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim())
    if (!parsed.date || parsed.date.includes('Y')) parsed.date = new Date().toISOString().slice(0, 10)
    
    return res.status(200).json({ 
      ...parsed, 
      _remaining: limit.remaining 
    })

  } catch (err) {
    return res.status(500).json({ error: { message: err.message } })
  }
}
