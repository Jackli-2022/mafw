const API = '/api';
const app = {
  state: { goals: [], sessions: [], stats: null, currentView: 'overview' },
  charts: {}
};

document.addEventListener('DOMContentLoaded', async () => {
  window.switchView = function(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + viewName).classList.add('active');
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    var tab = document.querySelector('.nav-tab[data-view="' + viewName + '"]');
    if (tab) tab.classList.add('active');
    app.currentView = viewName;
    renderCurrentView();
  };
  setupSSE();
  await Promise.all([loadStats(), loadGoals(), loadSessions()]);
  renderCurrentView();
});

function renderCurrentView() {
  switch (app.currentView) {
    case 'overview': renderOverview(); break;
    case 'sessions': renderSessions(); break;
    case 'goals': renderGoals(); break;
    case 'loops': renderLoops(); break;
    case 'analytics': renderAnalytics(); break;
  }
}

function setupSSE() {
  try {
    var port = window.location.port;
    if (port === '3001' || port === '3111') { port = ':3000'; }
    else if (port) { port = ':' + port; }
    else { port = ':3000'; }
    var es = new EventSource(location.protocol + '//' + location.hostname + port + '/api/events?stream=true');
    es.onmessage = function(e) {
      try {
        var ev = JSON.parse(e.data);
        if (ev.type === 'state_change') { loadStats(); loadGoals(); loadSessions(); }
      } catch (_) {}
    };
    es.onerror = function() {
      var dot = document.getElementById('live-dot');
      var lbl = document.getElementById('live-label');
      if (dot) { dot.className = 'status-dot status-red'; }
      if (lbl) { lbl.textContent = '● Disconnected'; lbl.style.color = 'var(--accent-red)'; }
    };
    es.onopen = function() {
      var dot = document.getElementById('live-dot');
      var lbl = document.getElementById('live-label');
      if (dot) { dot.className = 'status-dot status-green pulse'; }
      if (lbl) { lbl.textContent = '● Live'; lbl.style.color = 'var(--accent-green)'; }
    };
  } catch(_) {}
}

async function loadStats() {
  try {
    var res = await fetch(API + '/stats');
    app.state.stats = await res.json();
  } catch (_) { app.state.stats = null; }
}

async function loadGoals() {
  try {
    var res = await fetch(API + '/goals');
    app.state.goals = await res.json();
  } catch (_) { app.state.goals = []; }
}

async function loadSessions() {
  try {
    var res = await fetch(API + '/sessions');
    app.state.sessions = await res.json();
  } catch (_) { app.state.sessions = []; }
}

async function loadGoalDetail(goalId) {
  try {
    var res = await fetch(API + '/goals/' + goalId);
    return await res.json();
  } catch (_) { return null; }
}

async function loadLoopDetail(goalId, loop) {
  try {
    var res = await fetch(API + '/goals/' + goalId + '/loops/' + loop);
    return await res.json();
  } catch (_) { return null; }
}

function renderOverview() {
  var s = app.state.stats || {};
  var goals = app.state.goals || [];
  var sessions = app.state.sessions || [];
  var container = document.getElementById('view-overview');

  var passedLoops = s.loopsToday || 0;
  var reviewingLoops = 0;
  var activeCount = goals.filter(function(g) { return g.phase === 'EXECUTING' || g.phase === 'REVIEWING' || g.phase === 'PLANNING'; }).length;
  var completedToday = goals.filter(function(g) { return g.phase === 'COMPLETED'; }).length;

  var wavesTotal = s.wavesToday || goals.reduce(function(a, g) { return a + (g.loop || 0); }, 0);
  var connectedSessions = sessions.filter(function(s) { return s.status === 'active' || s.status === 'connected'; }).length;
  var stalledSessions = sessions.filter(function(s) { return s.status === 'idle' || s.status === 'stalled'; }).length;

  var loopPhases = {};
  goals.forEach(function(g) {
    var ph = g.phase || 'PENDING';
    loopPhases[ph] = (loopPhases[ph] || 0) + 1;
  });
  var totalGoals = goals.length || 1;
  var phaseOrder = ['PLANNING', 'EXECUTING', 'REVIEWING', 'COMPLETED', 'FAILED'];
  var phaseColors = { PLANNING: 'var(--accent-blue)', EXECUTING: 'var(--accent-green)', REVIEWING: 'var(--accent-yellow)', COMPLETED: 'var(--accent-purple)', FAILED: 'var(--accent-red)' };
  var phaseLabels = { PLANNING: 'Planning', EXECUTING: 'Executing', REVIEWING: 'Reviewing', COMPLETED: 'Completed', FAILED: 'Failed' };

  container.innerHTML =
    '<div class="grid grid-cols-6 gap-4 mb-6">' +
      kpiCard('Active Goals', 'var(--accent-blue)', 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5', activeCount, completedToday + ' completed today') +
      kpiCard('Loops Today', 'var(--accent-purple)', 'M21 12a9 9 0 11-6.22-8.56M21 3v9h-9', s.loopsToday || 0, passedLoops + ' passed\u00B7' + reviewingLoops + ' reviewing') +
      kpiCard('Waves Today', 'var(--accent-green)', 'M13 2L3 14h9l-1 8 10-12h-9l1-8z', s.wavesToday || 0, 'total ' + wavesTotal) +
      kpiCard('Active Sessions', 'var(--accent-yellow)', 'M8 21h8m-4-4v4', sessions.length, connectedSessions + ' connected\u00B7' + stalledSessions + ' stalled') +
      kpiCard('Total Duration', 'var(--text-secondary)', 'M12 6v6l4 2', s.totalDuration || '\u2014', 'avg ' + (s.avgLoopDuration || '\u2014') + ' per loop') +
      kpiCard('Memory Entries', 'var(--accent-blue)', 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5', s.memoryEntries || '\u2014', (s.memoryL1 ? 'L1:' + s.memoryL1 : '') + (s.memoryL2 ? '\u00B7L2:' + s.memoryL2 : '') + (s.memoryL3 ? '\u00B7L3:' + s.memoryL3 : '')) +
    '</div>' +
    '<div class="grid grid-cols-2 gap-4 mb-6">' +
      '<div class="card p-5">' +
        '<div class="flex items-center justify-between mb-4"><h3 class="font-semibold text-sm">Loop Phase Distribution</h3><span class="text-xs" style="color: var(--text-secondary);">Today</span></div>' +
        '<div class="space-y-3">' +
          phaseOrder.map(function(ph) {
            var count = loopPhases[ph] || 0;
            var pct = Math.round(count / totalGoals * 100);
            return '<div><div class="flex justify-between text-xs mb-1"><span style="color: var(--text-secondary);">' + phaseLabels[ph] + '</span><span class="font-mono">' + count + ' (' + pct + '%)</span></div><div class="h-2 rounded-full" style="background: var(--bg-tertiary);"><div class="h-2 rounded-full" style="width: ' + pct + '%; background: ' + phaseColors[ph] + ';"></div></div></div>';
          }).join('') +
        '</div>' +
      '</div>' +
      '<div class="card p-5">' +
        '<div class="flex items-center justify-between mb-4"><h3 class="font-semibold text-sm">Agent Workload</h3><span class="text-xs" style="color: var(--text-secondary);">Calls Today</span></div>' +
        '<div class="space-y-3">' +
          agentBar('PlanAgent', s.planAgentPct || 35, 'var(--accent-blue)') +
          agentBar('CodeAgent', s.codeAgentPct || 45, 'var(--accent-green)') +
          agentBar('ReviewAgent', s.reviewAgentPct || 15, 'var(--accent-yellow)') +
          agentBar('ToolAgent', s.toolAgentPct || 5, 'var(--accent-purple)') +
        '</div>' +
        '<div class="mt-4 pt-3" style="border-top: 1px solid var(--border);">' +
          '<div class="flex justify-between text-xs"><span style="color: var(--text-secondary);">Total Agent Calls</span><span class="font-mono font-semibold">' + (s.totalAgentCalls || '\u2014') + '</span></div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="card p-5">' +
      '<div class="flex items-center justify-between mb-4"><h3 class="font-semibold text-sm">Live Activity</h3><div class="flex items-center gap-2"><span class="status-dot status-green pulse"></span><span class="text-xs" style="color: var(--text-secondary);">Auto-refresh 5s</span></div></div>' +
      '<div class="overflow-x-auto">' +
        '<table class="w-full text-sm"><thead><tr style="border-bottom: 1px solid var(--border); color: var(--text-secondary);"><th class="text-left py-2 px-3 font-medium">Goal</th><th class="text-left py-2 px-3 font-medium">Loop</th><th class="text-left py-2 px-3 font-medium">Phase</th><th class="text-left py-2 px-3 font-medium">Next Action</th><th class="text-left py-2 px-3 font-medium">Status</th><th class="text-left py-2 px-3 font-medium">Last Active</th><th class="text-left py-2 px-3 font-medium">Actions</th></tr></thead><tbody>' +
        (goals.length ? goals.map(function(g) {
          return '<tr class="table-row" style="border-bottom: 1px solid var(--border);"><td class="py-3 px-3 font-mono text-xs">' + escapeHtml(g.goalId || '') + '</td><td class="py-3 px-3 font-mono">#' + (g.loop || 0) + '</td><td class="py-3 px-3">' + phaseBadge(g.phase) + '</td><td class="py-3 px-3 font-mono text-xs" style="color: var(--text-secondary);">' + (g.nextAction || '\u2014') + '</td><td class="py-3 px-3">' + phaseBadge(g.phase) + '</td><td class="py-3 px-3 font-mono text-xs" style="color: var(--accent-green);">' + timeAgo(g.updatedAt) + '</td><td class="py-3 px-3"><button class="btn" onclick="showGoalDetail(\'' + g.goalId + '\')">Details</button></td></tr>';
        }).join('') : '<tr><td class="py-3 px-3 text-sm" style="color: var(--text-secondary);" colspan="7">No active goals</td></tr>') +
        '</tbody></table>' +
      '</div>' +
    '</div>';
}

function kpiCard(label, color, path, value, sub) {
  return '<div class="card p-4"><div class="flex items-center gap-2 text-sm mb-2" style="color: var(--text-secondary);"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2"><path d="' + path + '"/></svg>' + label + '</div><div class="kpi-value" style="color: ' + color + ';">' + value + '</div><div class="kpi-sub">' + sub + '</div></div>';
}

function agentBar(name, pct, color) {
  return '<div class="flex items-center gap-3"><span class="w-20 text-xs font-mono" style="color: var(--text-secondary);">' + name + '</span><div class="flex-1 h-2 rounded-full" style="background: var(--bg-tertiary);"><div class="h-2 rounded-full" style="width: ' + pct + '%; background: ' + color + ';"></div></div><span class="w-12 text-xs font-mono text-right">' + pct + '%</span></div>';
}

function renderSessions() {
  var sessions = app.state.sessions || [];
  var container = document.getElementById('view-sessions');
  container.innerHTML =
    '<div class="card p-5 mb-4">' +
      '<div class="flex items-center justify-between mb-4"><h3 class="font-semibold text-sm">OpenCode Sessions</h3></div>' +
      '<div class="overflow-x-auto">' +
        '<table class="w-full text-sm"><thead><tr style="border-bottom: 1px solid var(--border); color: var(--text-secondary);"><th class="text-left py-2 px-3 font-medium">Session ID</th><th class="text-left py-2 px-3 font-medium">Goal</th><th class="text-left py-2 px-3 font-medium">Agent</th><th class="text-left py-2 px-3 font-medium">Status</th><th class="text-left py-2 px-3 font-medium">Idle</th><th class="text-left py-2 px-3 font-medium">Actions</th></tr></thead><tbody>' +
        (sessions.length ? sessions.map(function(s) {
          var statusClass = s.status === 'active' ? 'tag-green' : s.status === 'idle' ? 'tag-yellow' : 'tag-red';
          return '<tr class="table-row" style="border-bottom: 1px solid var(--border);"><td class="py-3 px-3 font-mono text-xs">' + escapeHtml(s.id || s.sessionId || '') + '</td><td class="py-3 px-3 font-mono text-xs">' + escapeHtml(s.goalId || '\u2014') + '</td><td class="py-3 px-3">' + escapeHtml(s.agent || 'default') + '</td><td class="py-3 px-3"><span class="tag ' + statusClass + '">' + (s.status || 'unknown') + '</span></td><td class="py-3 px-3 font-mono">' + (s.idle || '\u2014') + '</td><td class="py-3 px-3"><button class="btn" style="color: var(--accent-red);">Close</button></td></tr>';
        }).join('') : '<tr><td class="py-3 px-3 text-sm" style="color: var(--text-secondary);" colspan="6">No active sessions</td></tr>') +
        '</tbody></table>' +
      '</div>' +
    '</div>' +
    '<div class="grid grid-cols-2 gap-4">' +
      '<div class="card p-5"><h3 class="font-semibold text-sm mb-4">SSE Event Stream</h3><div class="font-mono text-xs p-3 rounded-lg overflow-y-auto max-h-64" style="background: #010409; border: 1px solid var(--border);" id="sse-stream"><div style="color: var(--text-secondary);">Waiting for events...</div></div></div>' +
      '<div class="card p-5"><h3 class="font-semibold text-sm mb-4">Session Metrics</h3><div class="space-y-4" id="session-metrics"><div class="flex justify-between items-center py-2" style="border-bottom: 1px solid var(--border);"><span class="text-sm" style="color: var(--text-secondary);">Active Sessions</span><span class="font-mono font-semibold">' + sessions.length + '</span></div><div class="flex justify-between items-center py-2"><span class="text-sm" style="color: var(--text-secondary);">Connected</span><span class="font-mono font-semibold">' + sessions.filter(function(s) { return s.status === 'active'; }).length + '</span></div></div></div>' +
    '</div>';
}

function renderGoals() {
  var goals = app.state.goals || [];
  var container = document.getElementById('view-goals');
  if (!goals.length) {
    container.innerHTML = '<div class="card p-5"><div class="text-sm" style="color: var(--text-secondary);">No goals loaded.</div></div>';
    return;
  }
  container.innerHTML =
    '<div class="card p-5 mb-4">' +
      '<div class="flex items-center gap-3 mb-4"><div class="w-3 h-3 rounded-full" style="background: var(--accent-green);"></div><div><div class="font-semibold">Active Goals</div><div class="text-xs font-mono" style="color: var(--text-secondary);">' + goals.length + ' goals</div></div></div>' +
      '<div class="space-y-4">' +
        goals.map(function(g) {
          var badgeCls = phaseTagClass(g.phase);
          var pct = g.loop ? Math.min(Math.round((g.loop / 5) * 100), 100) : 0;
          return '<div class="p-4 rounded-lg" style="background: var(--bg-tertiary); border: 1px solid var(--border);">' +
            '<div class="flex items-center justify-between mb-3"><div class="flex items-center gap-2"><span class="text-lg">\uD83C\uDFAF</span><span class="font-semibold">' + escapeHtml(g.goalId || '') + '</span></div><span class="tag ' + badgeCls + '">' + (g.phase || 'PENDING') + '</span></div>' +
            '<div class="grid grid-cols-4 gap-4 text-sm mb-3">' +
              '<div><div style="color: var(--text-secondary);" class="text-xs mb-1">Loop</div><div class="font-mono font-semibold">#' + (g.loop || 0) + '</div></div>' +
              '<div><div style="color: var(--text-secondary);" class="text-xs mb-1">Next Action</div><div class="font-mono text-xs" style="color: var(--accent-blue);">' + (g.nextAction || '\u2014') + '</div></div>' +
              '<div><div style="color: var(--text-secondary);" class="text-xs mb-1">Session</div><div class="font-mono text-xs">' + (g.sessionId ? g.sessionId.substring(0, 12) + '...' : '\u2014') + '</div></div>' +
              '<div><div style="color: var(--text-secondary);" class="text-xs mb-1">Updated</div><div class="font-mono text-xs">' + timeAgo(g.updatedAt) + '</div></div>' +
            '</div>' +
            '<div class="flex items-center gap-2"><div class="flex-1 h-1.5 rounded-full" style="background: var(--bg-primary);"><div class="h-1.5 rounded-full" style="width: ' + pct + '%; background: linear-gradient(90deg, var(--accent-green), var(--accent-yellow));"></div></div><span class="text-xs font-mono" style="color: var(--text-secondary);">' + pct + '%</span></div>' +
            '<div class="mt-3 flex gap-2"><button class="btn" onclick="showGoalDetail(\'' + g.goalId + '\')">View Details</button></div>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>';
}

function renderLoops() {
  var goals = app.state.goals || [];
  var container = document.getElementById('view-loops');
  var activeGoal = goals[0];
  if (!activeGoal) {
    container.innerHTML = '<div class="card p-5"><div class="text-sm" style="color: var(--text-secondary);">No loop data available.</div></div>';
    return;
  }
  var loopNum = activeGoal.loop || 1;
  var phaseColor = phaseColors[activeGoal.phase] || 'var(--accent-blue)';
  container.innerHTML =
    '<div class="card p-5">' +
      '<div class="flex items-center justify-between mb-6">' +
        '<div>' +
          '<div class="flex items-center gap-2 mb-1"><span class="font-mono text-xs px-2 py-0.5 rounded" style="background: var(--bg-tertiary);">Loop #' + loopNum + '</span><span class="font-semibold">' + escapeHtml(activeGoal.goalId || '') + '</span></div>' +
          '<div class="text-xs font-mono" style="color: var(--text-secondary);">Status: ' + phaseBadge(activeGoal.phase) + ' \u00B7 Next: ' + (activeGoal.nextAction || '\u2014') + '</div>' +
        '</div>' +
        '<div class="flex gap-2"><button class="btn btn-primary">Approve & Complete</button><button class="btn">Request Changes</button><button class="btn" style="color: var(--accent-red);">Abort</button></div>' +
      '</div>' +
      '<div class="relative pl-8">' +
        '<div class="timeline-line"></div>' +
        '<div class="relative mb-6">' +
          '<div class="timeline-dot" style="background: var(--accent-blue);"></div>' +
          '<div class="p-4 rounded-lg" style="background: var(--bg-tertiary); border: 1px solid var(--border);">' +
            '<div class="flex items-center gap-2 mb-2"><span class="font-mono text-xs px-2 py-0.5 rounded" style="background: rgba(88,166,255,0.15); color: var(--accent-blue);">PLAN</span><span class="text-xs" style="color: var(--text-secondary);">Wave 0</span></div>' +
            '<div class="font-mono text-xs space-y-1" style="color: var(--text-secondary);"><div><span style="color: var(--accent-blue);">\u2014</span> PlanAgent \u2192 Planning phase</div></div>' +
          '</div>' +
        '</div>' +
        '<div class="relative mb-6">' +
          '<div class="timeline-dot" style="background: ' + phaseColor + ';"></div>' +
          '<div class="p-4 rounded-lg" style="background: var(--bg-tertiary); border: 1px solid var(--border);">' +
            '<div class="flex items-center gap-2 mb-2"><span class="font-mono text-xs px-2 py-0.5 rounded" style="background: rgba(63,185,80,0.15); color: var(--accent-green);">EXECUTE</span><span class="text-xs" style="color: var(--text-secondary);">Current Loop</span><span class="tag ' + phaseTagClass(activeGoal.phase) + ' text-xs">' + (activeGoal.phase || 'PENDING') + '</span></div>' +
            '<div class="font-mono text-xs space-y-1" style="color: var(--text-secondary);"><div><span style="color: var(--accent-green);">\u2014</span> ' + (activeGoal.nextAction || 'Waiting...') + '</div></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
}

function renderAnalytics() {
  var s = app.state.stats || {};
  var goals = app.state.goals || [];
  var container = document.getElementById('view-analytics');
  var totalLoops = goals.reduce(function(a, g) { return a + (g.loop || 0); }, 0);
  var passed = goals.filter(function(g) { return g.phase === 'COMPLETED'; }).length;
  var reviewing = goals.filter(function(g) { return g.phase === 'REVIEWING'; }).length;
  var failed = goals.filter(function(g) { return g.phase === 'FAILED'; }).length;
  var total = goals.length || 1;
  var successRate = Math.round((passed / total) * 100);

  container.innerHTML =
    '<div class="grid grid-cols-4 gap-4 mb-6">' +
      '<div class="card p-4 text-center"><div class="text-xs mb-1" style="color: var(--text-secondary);">Total Goals</div><div class="text-xl font-bold font-mono">' + goals.length + '</div></div>' +
      '<div class="card p-4 text-center"><div class="text-xs mb-1" style="color: var(--text-secondary);">Total Loops</div><div class="text-xl font-bold font-mono">' + totalLoops + '</div></div>' +
      '<div class="card p-4 text-center"><div class="text-xs mb-1" style="color: var(--text-secondary);">Active Sessions</div><div class="text-xl font-bold font-mono">' + (app.state.sessions ? app.state.sessions.length : 0) + '</div></div>' +
      '<div class="card p-4 text-center"><div class="text-xs mb-1" style="color: var(--text-secondary);">Avg Waves per Goal</div><div class="text-xl font-bold font-mono">' + (goals.length ? (totalLoops / goals.length).toFixed(1) : '0') + '</div></div>' +
    '</div>' +
    '<div class="grid grid-cols-2 gap-4">' +
      '<div class="card p-5">' +
        '<h3 class="font-semibold text-sm mb-4">Loop Success Rate</h3>' +
        '<div class="flex items-center gap-4">' +
          '<div class="relative w-32 h-32">' +
            '<svg class="w-32 h-32 transform -rotate-90">' +
              '<circle cx="64" cy="64" r="56" fill="none" stroke="var(--bg-tertiary)" stroke-width="8"/>' +
              '<circle cx="64" cy="64" r="56" fill="none" stroke="var(--accent-green)" stroke-width="8" stroke-dasharray="351.86" stroke-dashoffset="' + (351.86 - (351.86 * successRate / 100)) + '"/>' +
            '</svg>' +
            '<div class="absolute inset-0 flex items-center justify-center"><div class="text-center"><div class="text-2xl font-bold">' + successRate + '%</div><div class="text-xs" style="color: var(--text-secondary);">' + passed + '/' + total + ' passed</div></div></div>' +
          '</div>' +
          '<div class="flex-1 space-y-2 text-sm">' +
            '<div class="flex justify-between"><span style="color: var(--text-secondary);">Passed</span><span class="font-mono font-semibold" style="color: var(--accent-green);">' + passed + '</span></div>' +
            '<div class="flex justify-between"><span style="color: var(--text-secondary);">Reviewing</span><span class="font-mono font-semibold" style="color: var(--accent-yellow);">' + reviewing + '</span></div>' +
            '<div class="flex justify-between"><span style="color: var(--text-secondary);">Failed</span><span class="font-mono font-semibold" style="color: var(--accent-red);">' + failed + '</span></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="card p-5">' +
        '<h3 class="font-semibold text-sm mb-4">Agent Token Consumption</h3>' +
        '<div class="space-y-3">' +
          tokenBar('PlanAgent', s.planAgentPct || 35, 'var(--accent-blue)', s.planAgentTokens || '') +
          tokenBar('CodeAgent', s.codeAgentPct || 45, 'var(--accent-green)', s.codeAgentTokens || '') +
          tokenBar('ReviewAgent', s.reviewAgentPct || 15, 'var(--accent-yellow)', s.reviewAgentTokens || '') +
        '</div>' +
        '<div class="mt-3 pt-3 text-xs font-mono" style="border-top: 1px solid var(--border); color: var(--text-secondary);">' +
          'Total: ' + (s.totalTokens || '\u2014') + ' tokens' +
        '</div>' +
      '</div>' +
    '</div>';

}

function tokenBar(name, pct, color, tokens) {
  return '<div><div class="flex justify-between text-xs mb-1"><span>' + name + '</span><span class="font-mono">' + pct + '%' + (tokens ? ' (' + tokens + ')' : '') + '</span></div><div class="h-2 rounded-full" style="background: var(--bg-tertiary);"><div class="h-2 rounded-full" style="width: ' + pct + '%; background: ' + color + ';"></div></div></div>';
}

window.showGoalDetail = async function(goalId) {
  var detail = await loadGoalDetail(goalId);
  if (!detail) return;
  switchView('loops');
  var container = document.getElementById('view-loops');
};

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str || '');
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function timeAgo(iso) {
  if (!iso) return '';
  var diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

var phaseColors = {
  PLANNING: 'var(--accent-blue)',
  EXECUTING: 'var(--accent-green)',
  REVIEWING: 'var(--accent-yellow)',
  COMPLETED: 'var(--accent-purple)',
  FAILED: 'var(--accent-red)',
  ARCHIVED: 'var(--text-secondary)',
  PENDING: 'var(--text-secondary)'
};

function phaseTagClass(phase) {
  var map = {
    PLANNING: 'tag-blue',
    EXECUTING: 'tag-green',
    REVIEWING: 'tag-yellow',
    COMPLETED: 'tag-purple',
    FAILED: 'tag-red'
  };
  return map[phase] || '';
}

function phaseBadge(phase) {
  var cls = phaseTagClass(phase);
  return '<span class="tag ' + cls + '">' + (phase || 'UNKNOWN') + '</span>';
}
