const log = document.getElementById('log')
const statusText = document.getElementById('status-text')

async function refresh() {
  try {
    const status = await window.mafw.getGatewayStatus()
    statusText.textContent = status
    statusText.className = status === 'running' ? 'running' : 'stopped'

    const lines = await window.mafw.getGatewayLogs()
    log.textContent = lines.join('\n')
    log.scrollTop = log.scrollHeight
  } catch {}
}

setInterval(refresh, 2000)
refresh()
