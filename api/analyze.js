export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { base64, mimeType } = req.body
    const GEMINI_KEY = process.env.GEMINI_API_KEY || 'AIzaSyAS2zdvqmp0MOkVagQ2aqPS_EQY8Yg5V-o'

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite
:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: mimeType || 'image/jpeg', data: base64 } },
              { text: `Du bist ein Kassenbon-Experte. Analysiere dieses Bon-Foto.
Antworte NUR mit JSON (kein Markdown):
{"store":"Geschäftsname","date":"YYYY-MM-DD","total":12.34,"items":[{"name":"Produkt","quantity":1,"price":1.99,"category":"Lebensmittel"}]}
Kategorien: Lebensmittel, Getränke, Haushalt, Hygiene, Snacks, Tiefkühlkost, Backwaren, Sonstiges
date: heutiges Datum falls nicht lesbar. total: Gesamtbetrag als Zahl. Falls kein Bon: total:0, items:[].` }
            ]
          }]
        })
      }
    )

    const data = await response.json()
    if (!response.ok) throw new Error(data.error?.message || 'Gemini Fehler')
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
    const clean = text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)
    if (!parsed.date || parsed.date.includes('Y')) parsed.date = new Date().toISOString().slice(0, 10)
    return res.status(200).json(parsed)

  } catch (err) {
    return res.status(500).json({ error: { message: err.message } })
  }
}
