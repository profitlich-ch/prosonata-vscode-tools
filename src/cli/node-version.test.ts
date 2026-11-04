import { describe, expect, it } from 'vitest'

import { nodeTooOld } from './node-version.js'

describe('nodeTooOld', () => {
  it('stops a Node without a global fetch and names the binary', () => {
    const message = nodeTooOld('16.20.2', '/Users/x/.nvm/versions/node/v16.20.2/bin/node')
    expect(message).toContain('Node.js 18')
    expect(message).toContain('16.20.2')
    expect(message).toContain('/Users/x/.nvm/versions/node/v16.20.2/bin/node')
  })

  it('lets through any Node with fetch, also one below engines', () => {
    expect(nodeTooOld('18.0.0', '/usr/bin/node')).toBeUndefined()
    expect(nodeTooOld('20.19.1', '/usr/bin/node')).toBeUndefined()
    expect(nodeTooOld('26.1.0', '/usr/bin/node')).toBeUndefined()
  })
})
