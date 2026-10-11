import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/lib/api'

afterEach(() => vi.unstubAllGlobals())

describe('chat history client mapping', () => {
  it('preserves model and the exact token usage returned by the server', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [
        { id: 'm-user', role: 'user', content: [{ type: 'text', text: 'Проверь код' }], model: 'sonnet', inputTokens: 0, outputTokens: 0, createdAt: 1_760_000_000_000 },
        { id: 'm-assistant', role: 'assistant', content: [{ type: 'text', text: 'Готово' }], model: 'sonnet', inputTokens: 321, outputTokens: 45, createdAt: 1_760_000_001_000 },
      ] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const messages = await api.messages('project-id', 'session-id')

    expect(messages[1]).toMatchObject({ id: 'm-assistant', model: 'sonnet', inputTokens: 321, outputTokens: 45, content: 'Готово' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
