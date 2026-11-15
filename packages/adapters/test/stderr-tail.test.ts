import { describe, expect, it } from 'vitest'
import { StderrTail, withStderr } from '../src/shared/stderr-tail'

describe('StderrTail', () => {
  it('keeps the last lines, joins split chunks, drops colours and cuts long lines', () => {
    const tail = new StderrTail(3, 10)
    tail.push('one\r\ntw')
    tail.push('o\n\n\u001b[31mthree\u001b[0m\nfour is a long line\nfive')
    expect(tail.last()).toEqual(['three', 'four is a…', 'five'])
    expect(tail.last(2)).toEqual(['four is a…', 'five'])
  })

  it('adds the lines to a message only when there are any', () => {
    const tail = new StderrTail()
    expect(withStderr('agent exited (code 1)', tail)).toBe('agent exited (code 1)')
    tail.push('Error: not logged in\n')
    expect(withStderr('agent exited (code 1)', tail)).toBe('agent exited (code 1):\nError: not logged in')
  })
})
