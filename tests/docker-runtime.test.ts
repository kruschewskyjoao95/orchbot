import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BROWSER_MCP,
  createDockerLaunch,
  dockerCreateArgs,
  dockerEnv,
  dockerWorkspace,
  validateDockerAgent,
} from '../src/backend/runtime/docker'
import { OrchbotDatabase } from '../src/backend/storage/db'
import type { Agent } from '../src/shared/types'
import { testSecretStorage } from './secret-storage-fixture'

const exec = promisify(execFile)
let dir: string
let db: OrchbotDatabase
let agent: Agent
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-runtime-test-'))
  db = new OrchbotDatabase(path.join(dir, 'db'), testSecretStorage)
  agent = db.createAgent({ name: 'Dev', provider: 'codex', model: 'test', workspacePath: dir })
})
afterEach(() => {
  db.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('fronteira do runtime Docker', () => {
  it('mantém agentes existentes no host, persiste escolha e rejeita engine incompatível/turno ativo', () => {
    expect(agent.runtime).toBe('host')
    expect(db.setAgentRuntime(agent.id, 'docker').runtime).toBe('docker')
    expect(db.getAgentByThreadId(db.listThreads(agent.id)[0].id)?.runtime).toBe('docker')
    expect(() => db.setAgentRuntime(agent.id, 'vm')).toThrow('inválido')
    const other = db.createAgent({
      name: 'Outro',
      provider: 'gemini',
      model: 'x',
      workspacePath: dir,
    })
    expect(() => db.setAgentRuntime(other.id, 'docker')).toThrow('Codex/Claude')
    const task = db.enqueueTask(agent.id, db.listThreads(agent.id)[0].id, 'x')
    db.updateTaskStatus(task.id, 'running')
    expect(() => db.setAgentRuntime(agent.id, 'host')).toThrow('turno terminar')
  })
  it('migra banco anterior preservando agentes, mensagens e fila com runtime host padrão', () => {
    const thread = db.listThreads(agent.id)[0]
    db.addMessage(thread.id, 'user', 'histórico existente')
    const task = db.enqueueTask(agent.id, thread.id, 'pendente')
    db.close()
    const old = new DatabaseSync(path.join(dir, 'db'))
    old.exec(
      'ALTER TABLE agents DROP COLUMN runtime; ALTER TABLE task_queue DROP COLUMN required_runtime; ALTER TABLE webhook_triggers DROP COLUMN github_repository; DROP TABLE control_requests;',
    )
    old.close()
    db = new OrchbotDatabase(path.join(dir, 'db'), testSecretStorage)
    expect(db.getAgent(agent.id)?.runtime).toBe('host')
    expect(db.getTask(task.id)?.status).toBe('pending')
    expect(db.listMessages(thread.id)[0].text).toBe('histórico existente')
    expect(db.acceptControl('migrated', agent.id, 'nova tarefa').taskId).toBeTruthy()
  })

  it('exige conta com chave explícita, pasta dedicada e engine suportada', () => {
    expect(() => validateDockerAgent(agent, {})).toThrow('chave de API')
    expect(() =>
      validateDockerAgent(agent, {
        apiKey: 'test',
        cliProfile: { envKey: 'CODEX_HOME', directory: dir },
      }),
    ).toThrow('perfis')
    expect(() => validateDockerAgent({ ...agent, provider: 'gemini' }, { apiKey: 'test' })).toThrow(
      'Codex/Claude',
    )
    expect(() =>
      validateDockerAgent({ ...agent, role: 'orchestrator' }, { apiKey: 'test' }),
    ).toThrow('coordenadores')
    if (process.platform === 'linux' && process.getuid?.() !== 0)
      expect(() => validateDockerAgent(agent, { apiKey: 'test' })).not.toThrow()
    else expect(() => validateDockerAgent(agent, { apiKey: 'test' })).toThrow('Linux')
  })
  it('não monta raiz, home, /tmp inteiro, credenciais ou caminho simbólico', () => {
    expect(() => dockerWorkspace('/')).toThrow()
    expect(() => dockerWorkspace(os.homedir())).toThrow()
    expect(() => dockerWorkspace('/tmp')).toThrow()
    const link = path.join(dir, 'link')
    fs.symlinkSync(dir, link)
    expect(() => dockerWorkspace(link)).toThrow()
    expect(dockerWorkspace(dir)).toBe(dir)
  })
  it('só inclui conta selecionada e MCP explícito; valores secretos não aparecem no argv', () => {
    const env = dockerEnv({
      apiKey: 'test-secret',
      envKeys: ['OPENAI_API_KEY'],
      extraEnv: { ORCHBOT_MCP_0_BEARER: 'mcp-secret' },
    })
    expect(env).toEqual({ OPENAI_API_KEY: 'test-secret', ORCHBOT_MCP_0_BEARER: 'mcp-secret' })
    const args = dockerCreateArgs('orchbot-test', dir, env)
    expect(args.join(' ')).not.toContain('test-secret')
    expect(args.join(' ')).not.toContain('mcp-secret')
    expect(args).toContain('--read-only')
    expect(args).toContain('--cap-drop=ALL')
    expect(args.filter((value) => value.startsWith('type=bind'))).toEqual([
      `type=bind,source=${dir},target=${dir}`,
    ])
    expect(args.join(' ')).not.toMatch(/docker.sock|--privileged|--network=host|--ipc=host/)
  })
})

// Opt-in: sem Docker/imagem no CI normal; executado de verdade no desenvolvimento deste PR.
describe.skipIf(process.env.ORCHBOT_TEST_DOCKER !== '1')(
  'runtime Docker real (sem credenciais)',
  () => {
    it('grava somente no workspace/tmp, não vê sentinela do host e aplica uid/capabilities', async () => {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'orchbot-outside-'))
      fs.writeFileSync(path.join(outside, 'secret'), 'host-only')
      const script = `const fs=require('fs'); let rootWritable=true; try { fs.writeFileSync('/outside','bad') } catch { rootWritable=false } fs.writeFileSync('artifact.txt','ok'); console.log(JSON.stringify({ outside:fs.existsSync(${JSON.stringify(path.join(outside, 'secret'))}), rootWritable, uid:process.getuid(), status:fs.readFileSync('/proc/self/status','utf8'), ambient:process.env.ORCHBOT_CONTROL_FILE }));`
      const launch = await createDockerLaunch('node', ['-e', script], dir, {})
      try {
        const { stdout } = await exec(launch.command, launch.args, { timeout: 15000 })
        const result = JSON.parse(stdout)
        expect(result.outside).toBe(false)
        expect(result.rootWritable).toBe(false)
        expect(result.uid).toBe(process.getuid?.())
        expect(result.status).toMatch(/CapEff:\s+0+\n/)
        expect(result.status).toMatch(/NoNewPrivs:\s+1/)
        expect(result.ambient).toBeUndefined()
        expect(fs.readFileSync(path.join(dir, 'artifact.txt'), 'utf8')).toBe('ok')
      } finally {
        await launch.cleanup()
        fs.rmSync(outside, { recursive: true, force: true })
      }
    }, 30000)
    it('cancelamento remove o processo e o container, sem depender de matar só o cliente Docker', async () => {
      const launch = await createDockerLaunch(
        'node',
        ['-e', "process.stdout.write('ready\\n'); setInterval(()=>{},1000)"],
        dir,
        {},
      )
      const child = spawn(launch.command, launch.args)
      const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
      try {
        await new Promise<void>((resolve, reject) => {
          child.once('error', reject)
          child.stdout.once('data', () => resolve())
        })
        await launch.cleanup()
        await closed
        await expect(exec('docker', ['inspect', launch.args[3]])).rejects.toThrow()
      } finally {
        await launch.cleanup()
        child.kill()
      }
    }, 30000)
    it('CLI e browser MCP reais inicializam; navegador lê página local dentro do container', async () => {
      const script = `
const http=require('http'), {spawn}=require('child_process'), {createInterface}=require('readline');
(async()=>{
 const server=http.createServer((_,res)=>res.end('<title>Orchbot smoke MCP</title><button>Verificado</button>'));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const mcp=spawn('playwright-mcp',${JSON.stringify(BROWSER_MCP.args)});
 const pending=new Map(); let id=0;
 createInterface({input:mcp.stdout}).on('line',line=>{const data=JSON.parse(line); if(data.id) { const pair=pending.get(data.id); if(pair){pending.delete(data.id);data.error?pair.reject(new Error(JSON.stringify(data.error))):pair.resolve(data.result)} }});
 mcp.stderr.on('data',data=>process.stderr.write(data));
 const call=(method,params)=>new Promise((resolve,reject)=>{ const key=++id; pending.set(key,{resolve,reject});mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id:key,method,params})+'\\n') });
 try {
 await call('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'regression',version:'1'}});
 mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\\n');
 const tools=await call('tools/list',{});
 const page=await call('tools/call',{name:'browser_navigate',arguments:{url:'http://127.0.0.1:'+server.address().port}});
 if(page.isError) throw new Error(JSON.stringify(page));
 console.log(JSON.stringify({toolCount:tools.tools.length,page}));
 } finally { mcp.kill(); server.close(); }
})().catch(e=>{console.error(e);process.exit(1)});`
      const launch = await createDockerLaunch('node', ['-e', script], dir, {})
      try {
        const { stdout } = await exec(launch.command, launch.args, { timeout: 20000 })
        const result = JSON.parse(stdout)
        expect(result.toolCount).toBeGreaterThan(5)
        expect(JSON.stringify(result.page)).toContain('Orchbot smoke MCP')
        const snapshot = fs
          .readdirSync(path.join(dir, '.playwright-mcp'))
          .find((file) => file.endsWith('.yml'))
        expect(snapshot).toBeTruthy()
        expect(
          fs.readFileSync(path.join(dir, '.playwright-mcp', snapshot ?? ''), 'utf8'),
        ).toContain('Verificado')
      } finally {
        await launch.cleanup()
      }
      for (const command of ['codex', 'claude']) {
        const version = await createDockerLaunch(command, ['--version'], dir, {})
        try {
          expect((await exec(version.command, version.args, { timeout: 10000 })).stdout).toMatch(
            command === 'codex' ? /0\.166\.0/ : /2\.1\.318/,
          )
        } finally {
          await version.cleanup()
        }
      }
    }, 60000)
  },
)
