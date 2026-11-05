import fs from 'node:fs'

export async function callControl(file: string, method: string, args: unknown): Promise<unknown> {
  const stat = fs.lstatSync(file)
  if (
    !stat.isFile() ||
    stat.size > 4096 ||
    (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
  )
    throw new Error('Arquivo de conexão precisa ser regular e privado (chmod 600).')
  const connection = JSON.parse(fs.readFileSync(file, 'utf8'))
  const url = new URL(connection.url)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== '/rpc' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    typeof connection.token !== 'string' ||
    !/^[\w-]{43}$/.test(connection.token)
  )
    throw new Error('Conexão de controle inválida.')
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
    headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ method, args }),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Controle indisponível.')
  return result
}
