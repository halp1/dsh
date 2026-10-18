import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSwallowedForTest, swallowed } from '../src/silent.ts'

beforeEach(() => {
  resetSwallowedForTest()
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('swallowed（S-6 静默吞错记录）', () => {
  it('记录 reason 到宿主日志（[usage-billing] 门面）', () => {
    swallowed('reconcile-ref-missing')
    expect(vi.mocked(console.info)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(console.info)).toHaveBeenCalledWith('[usage-billing] swallowed: reconcile-ref-missing')
  })

  it('Error 附加 message，非 Error 原样附加', () => {
    swallowed('ledger-load-failed', new Error('bad json'))
    expect(vi.mocked(console.info)).toHaveBeenCalledWith(
      '[usage-billing] swallowed: ledger-load-failed', 'bad json',
    )
    swallowed('odd-shape', 42)
    expect(vi.mocked(console.info)).toHaveBeenCalledWith(
      '[usage-billing] swallowed: odd-shape', 42,
    )
  })

  it('同 reason 5 分钟内节流为一条；不同 reason 各自独立', () => {
    swallowed('same-key')
    swallowed('same-key')
    swallowed('same-key')
    expect(vi.mocked(console.info)).toHaveBeenCalledTimes(1)
    swallowed('other-key')
    expect(vi.mocked(console.info)).toHaveBeenCalledTimes(2)
  })

  it('reset 后同 reason 可再次记录（测试隔离）', () => {
    swallowed('key')
    resetSwallowedForTest()
    swallowed('key')
    expect(vi.mocked(console.info)).toHaveBeenCalledTimes(2)
  })
})
