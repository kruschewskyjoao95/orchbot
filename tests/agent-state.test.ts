import { expect, it } from 'vitest'
import { needsYou, stateFromQueue, stateFromTask } from '../src/renderer/src/agent-state'
import type { TaskQueueItem } from '../src/shared/types'

const task = (status: TaskQueueItem['status']) => ({ status }) as TaskQueueItem

it('estado pela fila: rodando vence, depois pausa, depois a última tarefa encerrada', () => {
  expect(stateFromQueue([task('pending'), task('running')], true)).toBe('working')
  expect(stateFromQueue([task('failed')], true)).toBe('paused')
  expect(stateFromQueue([task('pending'), task('failed'), task('completed')], false)).toBe('failed')
  expect(stateFromQueue([task('completed'), task('failed')], false)).toBe('idle')
  expect(stateFromQueue([], false)).toBe('idle')
})

it('eventos da fila: resposta em agente fechado vira "Respondeu"; falha e pausa pedem você', () => {
  expect(stateFromTask('idle', task('running'), false)).toBe('working')
  expect(stateFromTask('working', task('completed'), false)).toBe('responded')
  expect(stateFromTask('working', task('completed'), true)).toBe('idle')
  expect(stateFromTask('working', task('failed'), true)).toBe('failed')
  expect(stateFromTask('paused', task('cancelled'), false)).toBe('paused')
  expect(stateFromTask('responded', task('pending'), false)).toBe('responded')
  expect([needsYou('failed'), needsYou('paused'), needsYou('responded')]).toEqual([
    true,
    true,
    false,
  ])
})
