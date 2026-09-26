// Vercel function: forwards transit-time requests to TravelTime with the API credentials,
// so the key stays on the server. Locally, the Vite dev proxy (vite.config.ts) does the same job.
// Set TRAVELTIME_APP_ID and TRAVELTIME_API_KEY in the Vercel project's environment variables.

export async function POST(request: Request): Promise<Response> {
  const appId = process.env.TRAVELTIME_APP_ID
  const apiKey = process.env.TRAVELTIME_API_KEY
  if (!appId || !apiKey) return new Response('TravelTime credentials are not configured', { status: 500 })

  const upstream = await fetch('https://api.traveltimeapp.com/v4/time-filter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Application-Id': appId, 'X-Api-Key': apiKey },
    body: await request.text(),
  })
  return new Response(upstream.body, { status: upstream.status, headers: { 'Content-Type': 'application/json' } })
}
