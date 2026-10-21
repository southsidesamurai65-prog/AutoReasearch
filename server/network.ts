import type { NetworkSettings } from '../shared/types'

export const DEFAULT_NO_PROXY = 'localhost,127.0.0.1,::1'

export function proxyEnv(
  network: NetworkSettings,
): Record<string, string> {
  if (!network.enabled) return {}

  const env: Record<string, string> = {}
  const http = network.httpProxy.trim()
  const https = network.httpsProxy.trim()
  const noProxy = network.noProxy.trim() || DEFAULT_NO_PROXY
  const caCertPath = network.caCertPath.trim()

  if (http) {
    env.HTTP_PROXY = http
    env.http_proxy = http
  }
  if (https) {
    env.HTTPS_PROXY = https
    env.https_proxy = https
  }
  if (http || https) {
    env.NO_PROXY = noProxy
    env.no_proxy = noProxy
    // Node 24+ needs this for its own fetch; harmless for Bun-based harnesses.
    env.NODE_USE_ENV_PROXY ??= '1'
  }
  if (caCertPath) {
    env.NODE_EXTRA_CA_CERTS = caCertPath
  }

  return env
}
