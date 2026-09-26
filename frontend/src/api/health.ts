export interface HealthResponse {
  status: 'ok' | 'error'
  db: 'ok' | 'unavailable'
}

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch('/api/health')
  return (await response.json()) as HealthResponse
}
