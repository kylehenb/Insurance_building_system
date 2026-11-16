import { describe, it, expect } from 'vitest'
import { FieldJobDetailsError, updateFieldJobDetails } from '../field-job-details'

// A Bindi Co job's builder/insurer reference and address, changed from the field app.

function fakeService(job: { id: string; insurer: string } | null, updateError: { code?: string } | null = null) {
  const updates: Record<string, unknown>[] = []
  const service = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: job }) }) }) }),
      update: (row: Record<string, unknown>) => { updates.push(row); return { eq: () => ({ eq: async () => ({ error: updateError }) }) } },
    }),
  }
  return { service: service as never, updates }
}

describe('updateFieldJobDetails', () => {
  it('saves the reference as the job number, and the address, tidied', async () => {
    const { service, updates } = fakeService({ id: 'j1', insurer: 'Midcity' })
    expect(await updateFieldJobDetails(service, 't1', 'j1', { reference: ' MC1001 ', address: ' 12 Smith St, Kenwick ' })).toEqual({ reference: 'MC1001', address: '12 Smith St, Kenwick' })
    expect(updates).toEqual([{ job_number: 'MC1001', property_address: '12 Smith St, Kenwick' }])
  })

  it("needs both, and only changes Bindi Co's own jobs", async () => {
    await expect(updateFieldJobDetails(fakeService({ id: 'j1', insurer: 'Midcity' }).service, 't1', 'j1', { reference: ' ', address: 'x' })).rejects.toMatchObject({ status: 400 })
    const irc = fakeService({ id: 'j2', insurer: 'Suncorp' })
    await expect(updateFieldJobDetails(irc.service, 't1', 'j2', { reference: 'A', address: 'B' })).rejects.toMatchObject({ status: 404 })
    expect(irc.updates).toEqual([])
    await expect(updateFieldJobDetails(fakeService(null).service, 't1', 'jx', { reference: 'A', address: 'B' })).rejects.toBeInstanceOf(FieldJobDetailsError)
  })

  it('says so when another job already has the reference', async () => {
    const { service } = fakeService({ id: 'j1', insurer: 'Midcity' }, { code: '23505' })
    await expect(updateFieldJobDetails(service, 't1', 'j1', { reference: 'MC1', address: 'B' })).rejects.toMatchObject({ status: 409, message: 'Another job already has the reference MC1' })
  })
})
