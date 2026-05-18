export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const body = req.body
    
    // Log was reinkommt
    const items = body?.messages?.[0]?.content
    const imageItem = items?.find(i => i.type === 'image')
    const mimeType = imageItem?.source?.media_type
    const dataLength = imageItem?.source?.data?.length
    
    console.log('MIME:', mimeType, '| Base64 Länge:', dataLength)

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    })

    const data = await response.json()
    
    if (!response.ok) {
      console.log('API Fehler:', JSON.stringify(data))
    }
    
    return res.status(response.status).json(data)
  } catch (err) {
    console.log('Handler Fehler:', err.message)
    return res.status(500).json({ error: { message: err.message } })
  }
}
