import { test } from 'node:test'
import assert from 'node:assert/strict'
import { probeGateway, defaultCandidates } from '../src/probe.ts'

test('probeGateway returns baseUrl when /health answers ok', async () => {
  const fakeFetch = async () => new Response('{"status":"ok"}', { status: 200 })
  const url = await probeGateway(fakeFetch as typeof fetch, ['http://localhost:3999'])
  assert.equal(url, 'http://localhost:3999')
})

test('probeGateway returns null when all ports fail', async () => {
  const fakeFetch = async () => { throw new Error('ECONNREFUSED') }
  const url = await probeGateway(fakeFetch as typeof fetch, ['http://localhost:3998', 'http://localhost:3999'])
  assert.equal(url, null)
})

test('probeGateway tries ports in order, first healthy wins', async () => {
  const calls: string[] = []
  const fakeFetch = async (u: any) => {
    calls.push(String(u))
    if (String(u).includes('3000')) return new Response('{}', { status: 200 })
    throw new Error('down')
  }
  const url = await probeGateway(fakeFetch as typeof fetch, ['http://localhost:3998', 'http://localhost:3000'])
  assert.equal(url, 'http://localhost:3000')
  assert.equal(calls.length, 2)
})

test('probeGateway treats non-2xx /health as down', async () => {
  const fakeFetch = async () => new Response('{"status":"degraded"}', { status: 503 })
  const url = await probeGateway(fakeFetch as typeof fetch, ['http://localhost:3999'])
  assert.equal(url, null)
})

test('defaultCandidates dedupes when MAFW port equals 3000', () => {
  process.env.MAFW_SERVER_API_PORT = '3000'
  const urls = defaultCandidates()
  assert.equal(urls.length, 1)
  delete process.env.MAFW_SERVER_API_PORT
})
