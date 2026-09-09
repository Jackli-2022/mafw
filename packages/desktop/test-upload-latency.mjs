// 端到端时延测试脚本
// 模拟桌面端 → Main IPC → Gateway HTTP 的完整链路

import { performance } from 'perf_hooks'

const GATEWAY_PORT = 3000
const TEST_SIZES = [32, 64, 128, 256] // KB

// 生成随机 WAV 数据（模拟真实音频）
function generateWavBuffer(sizeKB) {
  const headerSize = 44
  const dataSize = sizeKB * 1024 - headerSize
  const buffer = Buffer.alloc(sizeKB * 1024)
  
  // RIFF header
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(sizeKB * 1024 - 8, 4)
  buffer.write('WAVE', 8)
  
  // fmt chunk
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(16000, 24) // sample rate
  buffer.writeUInt32LE(32000, 28) // byte rate
  buffer.writeUInt16LE(2, 32) // block align
  buffer.writeUInt16LE(16, 34) // bits per sample
  
  // data chunk
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  
  // 填充随机音频数据（模拟真实音频的振幅变化）
  for (let i = 0; i < dataSize; i += 2) {
    const sample = Math.sin(i * 0.01) * 16000 + (Math.random() - 0.5) * 8000
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), 44 + i)
  }
  
  return buffer
}

async function testUpload(sizeKB) {
  const buffer = generateWavBuffer(sizeKB)
  
  // 模拟 Main 进程的上传逻辑
  const t0 = performance.now()
  
  // 1. 准备阶段（Buffer 转换）
  const t1 = performance.now()
  const uint8 = new Uint8Array(buffer)
  const t2 = performance.now()
  
  // 2. HTTP 请求阶段
  const qs = new URLSearchParams({ type: 'audio/wav' })
  const res = await fetch(
    `http://127.0.0.1:${GATEWAY_PORT}/api/media/upload-and-create?${qs.toString()}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: uint8,
      signal: AbortSignal.timeout(15_000),
    }
  )
  const t3 = performance.now()
  
  // 3. 解析响应阶段
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  const data = await res.json()
  const t4 = performance.now()
  
  return {
    sizeKB,
    prepMs: (t2 - t1).toFixed(2),
    httpMs: (t3 - t2).toFixed(2),
    parseMs: (t4 - t3).toFixed(2),
    totalMs: (t4 - t0).toFixed(2),
    taskId: data.id?.slice(0, 8),
    state: data.state,
  }
}

async function main() {
  console.log('=== 端到端时延测试 ===\n')
  console.log('Gateway:', `http://127.0.0.1:${GATEWAY_PORT}`)
  console.log('测试文件大小:', TEST_SIZES.join(', '), 'KB\n')
  
  // 健康检查
  try {
    const health = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/health`)
    if (!health.ok) throw new Error('Gateway not healthy')
    console.log('✓ Gateway 健康\n')
  } catch (e) {
    console.error('✗ Gateway 不可用:', e.message)
    process.exit(1)
  }
  
  // 测试不同大小
  const results = []
  for (const size of TEST_SIZES) {
    try {
      const result = await testUpload(size)
      results.push(result)
      console.log(`${size}KB: prep=${result.prepMs}ms http=${result.httpMs}ms parse=${result.parseMs}ms total=${result.totalMs}ms (task=${result.taskId} state=${result.state})`)
    } catch (e) {
      console.error(`${size}KB: ✗ ${e.message}`)
    }
  }
  
  console.log('\n=== 统计 ===')
  if (results.length > 0) {
    const totals = results.map(r => parseFloat(r.totalMs))
    const avg = totals.reduce((a, b) => a + b, 0) / totals.length
    const min = Math.min(...totals)
    const max = Math.max(...totals)
    console.log(`平均: ${avg.toFixed(2)}ms`)
    console.log(`最小: ${min.toFixed(2)}ms`)
    console.log(`最大: ${max.toFixed(2)}ms`)
    console.log(`\n✓ 所有测试完成`)
  }
}

main().catch(e => {
  console.error('测试失败:', e)
  process.exit(1)
})
