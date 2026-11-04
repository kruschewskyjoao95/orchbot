import { describe, expect, it } from 'vitest'
import { fillFieldScript } from '../src/backend/browser/electron-driver'

function reactInput(initial: string) {
  let dom = initial
  let tracker = initial
  const proto: object = {}
  Object.defineProperty(proto, 'value', {
    configurable: true,
    get: () => dom,
    set: (next: string) => {
      dom = String(next)
    },
  })
  const el = Object.create(proto) as {
    value: string
    dispatchEvent: (event: Event) => boolean
  }
  Object.defineProperty(el, 'value', {
    configurable: true,
    get: () => dom,
    set: (next: string) => {
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, next)
      tracker = String(next)
    },
  })
  const events: string[] = []
  el.dispatchEvent = (event) => {
    events.push(event.type)
    return true
  }
  return {
    el,
    events,
    dom: () => dom,
    tracker: () => tracker,
  }
}

function runFill(selector: string, value: string, el: object | null) {
  const document = { querySelector: () => el }
  const run = new Function('document', 'Event', fillFieldScript(selector, value))
  return run(document, Event)
}

describe('preencher campo no navegador', () => {
  it('atualiza o DOM sem avisar o rastreador do React, e dispara input', () => {
    const field = reactInput('antigo')
    runFill('#email', 'joao@example.com', field.el)
    expect(field.dom()).toBe('joao@example.com')
    expect(field.tracker()).toBe('antigo')
    expect(field.events).toEqual(['input', 'change'])
  })

  it('campo comum recebe o valor', () => {
    let dom = ''
    const proto: object = {}
    Object.defineProperty(proto, 'value', {
      configurable: true,
      get: () => dom,
      set: (next: string) => {
        dom = String(next)
      },
    })
    const el = Object.create(proto) as { dispatchEvent: (event: Event) => boolean }
    el.dispatchEvent = () => true
    runFill('#q', 'orchbot', el)
    expect(dom).toBe('orchbot')
  })

  it('campo ausente falha', () => {
    expect(() => runFill('#sumiu', 'x', null)).toThrow('Campo não encontrado no DOM')
  })
})
