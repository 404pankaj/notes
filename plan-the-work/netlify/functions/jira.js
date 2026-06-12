exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) }

  try {
    const { baseUrl, email, token, ticket } = JSON.parse(event.body || '{}')
    if (!baseUrl || !token || !ticket) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing baseUrl, token, or ticket' }) }
    }

    const isCloud = baseUrl.includes('atlassian.net')
    const apiVersion = isCloud ? '3' : '2'
    const cleanBase = baseUrl.replace(/\/$/, '')
    const url = `${cleanBase}/rest/api/${apiVersion}/issue/${encodeURIComponent(ticket)}`

    const authHeader = email
      ? `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
      : `Bearer ${token}`

    const res = await fetch(url, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    })

    const data = await res.json()
    return { statusCode: res.status, headers: CORS, body: JSON.stringify(data) }
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) }
  }
}
