/** Params that mean an OAuth authorization is in flight through the login page. */
export function pendingAuthorization(search: string): URLSearchParams | null {
  const query = new URLSearchParams(search)
  if (query.get('response_type') !== 'code') return null
  if (!query.get('client_id') || !query.get('redirect_uri')) return null
  return query
}
