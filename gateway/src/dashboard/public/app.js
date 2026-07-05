(function(){
'use strict';

// ============================================================
// STATE
// ============================================================
const app = {
  goals: [], sessions: [], stats: null, feedback: [], memory: null, cost: null,
  selectedGoalId: null, isPaused: false, currentView: 'overview',
  charts: {}
};
const $ = id => document.getElementById(id);

// ============================================================
// TOAST
// ============================================================
let toastTimer = null;
function showToast(msg, type = 'info') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast ' + type + ' show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ============================================================
// MODAL
// ============================================================
let modalCb = null;
function openModal(title, msg, cb) {
  $('modal-title').textContent = title;
  $('modal-message').textContent = msg;
  $('confirmModal').classList.add('active');
  modalCb = cb;
  $('modal-confirm-btn').onclick = function(){ closeModal(); if(modalCb) modalCb(); };
}
function closeModal(){ $('confirmModal').classList.remove('active'); modalCb = null; }
window.openModal = openModal; window.closeModal = closeModal;

// ============================================================
// GATEWAY CONTROLS
// ============================================================
async function callGateway(action, payload){
  try {
    const r = await fetch('/api/gateway/' + action, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ goalId: app.selectedGoalId, ...payload })
    });
    const result = await r.json();
    if(r.ok) { showToast(result.message || action + ' done', 'success'); refreshAll(); }
    else showToast(result.error || 'Action failed', 'error');
    return result;
  } catch(e){ showToast('Network error', 'error'); return null; }
}
window.gatewayPause = function(){ callGateway('pause'); app.isPaused = true; };
window.gatewayResume = function(){ callGateway('resume'); app.isPaused = false; };
window.gatewayCancel = function(){ openModal('Cancel Goal','Stop current execution?', ()=>callGateway('cancel')); };
window.gatewayCheckpoint = function(){ callGateway('checkpoint'); };
window.gatewayRollback = function(){ openModal('Rollback','Revert to last checkpoint?', ()=>callGateway('rollback')); };
window.gatewayClean = function(){ openModal('Clean Memory','Remove low-energy entries?', ()=>showToast('Clean done','success')); };

// ============================================================
// VIEW SWITCHING
// ============================================================
function switchView(name){
  document.querySelectorAll('.view').forEach(el=>el.classList.remove('active'));
  const target = $('view-'+name);
  if(target) target.classList.add('active');
  document.querySelectorAll('.nav-tab').forEach(el=>el.classList.remove('active'));
  const tab = document.querySelector('.nav-tab[data-view="'+name+'"]');
  if(tab) tab.classList.add('active');
  app.currentView = name;
  renderView(name);
}
window.switchView = switchView;

// ============================================================
// GOAL SELECTION
// ============================================================
function selectGoal(goalId){
  app.selectedGoalId = goalId;
  $('goalSelector').value = goalId||'';
  renderView(app.currentView);
}
window.selectGoal = selectGoal;

function updateGoalSelector(goals){
  const sel = $('goalSelector');
  const current = sel.value;
  sel.innerHTML = '<option value="">All Goals</option>';
  goals.forEach(g=>{
    const opt = document.createElement('option');
    opt.value = g.goalId||g.id||'';
    opt.textContent = (g.goalId||g.id||'unknown').slice(0,36);
    if(opt.value===current) opt.selected = true;
    sel.appendChild(opt);
  });
  if(!current&&goals.length) sel.value = goals[0].goalId||goals[0].id||'';
  app.selectedGoalId = sel.value||null;
}

// ============================================================
// DATA LOADERS
// ============================================================
async function loadStats(){
  try{ const r=await fetch('/api/stats'); app.stats=await r.json(); }catch{ app.stats=null; }
}
async function loadGoals(){
  try{ const r=await fetch('/api/goals'); app.goals=await r.json(); }catch{ app.goals=[]; }
}
async function loadSessions(){
  try{ const r=await fetch('/api/sessions'); app.sessions=await r.json(); }catch{ app.sessions=[]; }
}
async function loadFeedback(){
  try{ const r=await fetch('/api/feedback'); app.feedback=await r.json(); }catch{ app.feedback=[]; }
}
async function loadMemory(goalId){
  try{
    const url = goalId ? '/api/memory/'+goalId : '/api/memory';
    const r = await fetch(url); app.memory = await r.json();
  }catch{ app.memory = null; }
}
async function loadGoalCost(goalId){
  if(!goalId){ app.cost=null; return; }
  try{ const r=await fetch('/api/costs/'+goalId); app.cost=await r.json(); }catch{ app.cost=null; }
}

async function refreshAll(){
  await Promise.all([loadStats(), loadGoals(), loadSessions(), loadFeedback()]);
  updateGoalSelector(app.goals);
  const gid = app.selectedGoalId||(app.goals[0]?.goalId||app.goals[0]?.id);
  if(gid) await Promise.all([loadMemory(gid), loadGoalCost(gid), loadAlignmentData(gid)]);
  else { app.memory=null; app.cost=null; }
  renderView(app.currentView);
}

// ============================================================
// CHART RENDERERS
// ============================================================
function destroyChart(key){
  if(app.charts[key]){ app.charts[key].destroy(); delete app.charts[key]; }
}

// ============================================================
// RENDER: OVERVIEW
// ============================================================
function renderOverview(){
  const goals = app.goals||[];
  const s = app.stats||{};
  const total = goals.length;
  const active = goals.filter(g=>g.phase!=='COMPLETED'&&g.phase!=='FAILED'&&g.phase!=='ARCHIVED').length;
  const completed = goals.filter(g=>g.phase==='COMPLETED').length;
  const loops = goals.reduce((sum,g)=>sum+(g.loop||0),0);

  $('ov-total-goals').textContent = total;
  const failed = goals.filter(g=>g.phase==='FAILED').length;
  $('ov-goals-by-status').textContent = '⚡'+active+' active \u00B7 \u2705'+completed+' done \u00B7 \u274C'+failed+' failed';
  $('ov-active-goals').textContent = active;
  $('ov-completed-goals').textContent = completed;
  $('ov-success-rate').textContent = total>0 ? Math.round(completed/total*100)+'% success' : '\u2014';
  $('ov-total-loops').textContent = loops;
  $('ov-goal-count').textContent = total+' goals';

  const list = $('ov-goal-list');
  if(!goals.length){
    list.innerHTML = '<div class="text-secondary text-sm py-4">No goals found</div>';
    return;
  }
  list.innerHTML = goals.map(g=>{
    const pct = g.loop ? Math.min(Math.round((g.loop/5)*100),100) : 0;
    const cls = g.phase==='COMPLETED'?'purple':g.phase==='FAILED'?'red':g.phase==='EXECUTING'?'green':g.phase==='REVIEWING'?'yellow':'blue';
    return '<div class="goal-card'+(app.selectedGoalId===(g.goalId||g.id)?' selected':'')+'" onclick="selectGoal(\''+(g.goalId||g.id)+'\');switchView(\'goals\')">'+
      '<div class="flex items-center justify-between">'+
        '<div class="flex items-center gap-3"><span class="font-mono text-sm">'+(g.goalId||g.id||'unknown').slice(0,36)+'</span><span class="tag tag-'+cls+'">'+(g.phase||'PENDING')+'</span></div>'+
        '<span class="text-xs text-secondary">Loop #'+(g.loop||0)+'</span>'+
      '</div>'+
      '<div class="flex items-center gap-4 mt-2 text-xs text-muted">'+
        '<span>Wave '+(g.currentWave||0)+'/'+(g.totalWaves||0)+'</span>'+
        '<span>'+pct+'%</span>'+
        '<span>'+(g.nextAction||'\u2014')+'</span>'+
        '<span>'+(g.updatedAt?new Date(g.updatedAt).toLocaleString():'\u2014')+'</span>'+
      '</div>'+
      '<div class="mt-2 progress-track"><div class="progress-fill blue" style="width:'+pct+'%"></div></div></div>';
  }).join('');
  $('ov-log-count').textContent = (s.logsToday||0)+' events';
}

// ============================================================
// RENDER: GOAL DETAIL
// ============================================================
function renderGoalDetail(){
  const goals = app.goals||[];
  const g = goals.find(x=>(x.goalId||x.id)===app.selectedGoalId)||null;
  if(!g){
    $('goal-detail-title').textContent='No Goal Selected'; $('goal-detail-status').textContent='\u2014';
    $('goal-detail-status').className='tag tag-blue';
    $('goal-detail-content').innerHTML='<div class="text-secondary text-sm py-4">Select a goal from the list or dropdown</div>';
    $('gm-loop').textContent='\u2014'; $('gm-wave').textContent='\u2014'; $('gm-progress').textContent='\u2014'; $('gm-updated').textContent='\u2014';
    $('gm-bar').style.width='0%';
    ['loops','sessions','memory','cost','analytics','timeline'].forEach(v=>{ const l=$ (v+'-goal-label'); if(l) l.textContent='\u2014'; });
    return;
  }
  const pct = g.loop ? Math.min(Math.round((g.loop/5)*100),100) : 0;
  const cls = g.phase==='COMPLETED'?'purple':g.phase==='FAILED'?'red':g.phase==='EXECUTING'?'green':g.phase==='REVIEWING'?'yellow':'blue';
  $('goal-detail-title').textContent=(g.goalId||g.id||'').slice(0,40);
  $('goal-detail-status').textContent=app.isPaused?'PAUSED':(g.phase||'PENDING');
  $('goal-detail-status').className='tag tag-'+(app.isPaused?'yellow':cls);
  $('goal-detail-content').innerHTML=
    '<div class="space-y-2 text-sm"><div class="flex justify-between"><span class="text-secondary">Goal ID</span><span class="font-mono">'+(g.goalId||g.id||'\u2014')+'</span></div>'+
    '<div class="flex justify-between"><span class="text-secondary">Phase</span><span>'+(g.phase||'PENDING')+'</span></div>'+
    '<div class="flex justify-between"><span class="text-secondary">Next Action</span><span>'+(g.nextAction||'\u2014')+'</span></div>'+
    '<div class="flex justify-between"><span class="text-secondary">Session</span><span class="font-mono text-xs">'+(g.sessionId||'\u2014')+'</span></div></div>';
  $('gm-loop').textContent='#'+(g.loop||0);
  $('gm-wave').textContent=(g.currentWave||0)+'/'+(g.totalWaves||0);
  $('gm-progress').textContent=pct+'%';
  $('gm-updated').textContent=g.updatedAt?new Date(g.updatedAt).toLocaleString():'\u2014';
  $('gm-bar').style.width=pct+'%';
  ['loops','sessions','memory','cost','analytics','timeline'].forEach(v=>{ const l=$(v+'-goal-label'); if(l) l.textContent=(g.goalId||g.id||'').slice(0,30); });
}

// ============================================================
// RENDER: MEMORY
// ============================================================
async function renderMemoryView(){
  const container = $('memory-content');
  if(app.selectedGoalId) await loadMemory(app.selectedGoalId);
  const mem = app.memory;
  if(!mem||!mem.entries||!mem.entries.length){
    container.innerHTML='<div class="text-secondary text-sm">No memory entries for this goal</div>';
    return;
  }
  const tiers = mem.tiers||{};
  container.innerHTML=
    '<div class="grid-4 mb-4">'+
      Object.entries(tiers).map(([k,v])=>'<div><span class="tag tag-'+({L5:'purple',T4:'blue',T3:'green',T2:'yellow',T1:'red'})[k]||'blue'+
        '">'+k+'</span> '+v+'</div>').join('')+
    '</div>'+
    '<div class="text-xs text-secondary">Total: '+mem.total+' entries</div>'+
    '<div class="mt-3 max-h-64 overflow-y-auto space-y-1">'+
    mem.entries.slice(0,30).map(m=>
      '<div class="text-xs text-secondary py-1 border-b border-white/5"><span class="tag tag-'+({L5:'purple',T4:'blue',T3:'green',T2:'yellow',T1:'red'})[m.tier]||'blue'+
      '">'+m.tier+'</span> '+(m.file||'\u2014')+' <span class="text-muted">'+(m.content||'').slice(0,80)+'...</span></div>'
    ).join('')+'</div>';
}

// ============================================================
// RENDER: SESSIONS
// ============================================================
function renderSessionsView(){
  const container = $('sessions-content');
  const sessions = app.sessions||[];
  const filtered = app.selectedGoalId ? sessions.filter(s=>(s.goalId||s.id)===app.selectedGoalId) : sessions;
  if(!filtered.length){ container.innerHTML='<div class="text-secondary text-sm">No sessions</div>'; return; }
  container.innerHTML = filtered.map(s=>
    '<div class="flex items-center justify-between py-2 border-b border-white/5">'+
      '<span class="font-mono text-xs">'+(s.id||s.sessionId||'\u2014').slice(0,16)+'</span>'+
      '<span class="tag tag-'+(s.status==='active'?'green':'yellow')+'">'+(s.status||'idle')+'</span>'+
      '<span class="text-xs text-muted">'+(s.agent||'\u2014')+'</span>'+
      '<span class="text-xs text-muted">'+(s.idle||'\u2014')+'</span></div>'
  ).join('');
}

// ============================================================
// RENDER: LOOPS
// ============================================================
async function renderLoopsView(){
  const container = $('loops-content');
  if(!app.selectedGoalId){ container.innerHTML='<div class="text-secondary text-sm">Select a goal</div>'; return; }
  container.innerHTML='<div class="text-secondary text-sm">Loop timeline for: '+app.selectedGoalId.slice(0,30)+'</div>';
  try{
    const detail = await fetch('/api/goals/'+app.selectedGoalId+'/loops/1').then(r=>r.json()).catch(()=>null);
    if(detail&&detail.waves){
      const waves = detail.waves;
      container.innerHTML = '<div class="relative pl-8">'+
        waves.map(w=>{
          const color = w.status==='failed'?'red':w.status==='running'?'yellow':'green';
          return '<div class="relative mb-4">'+
            '<div class="timeline-dot" style="position:absolute;left:-16px;top:6px;width:10px;height:10px;border-radius:50%;background:var(--'+color+');border:2px solid var(--bg-base)"></div>'+
            '<div class="p-3 rounded-lg border border-white/5" style="background:rgba(255,255,255,0.02)">'+
            '<div class="flex items-center gap-2 text-xs"><span class="tag tag-'+color+'">Wave '+w.waveNum+'</span>'+
            '<span class="text-muted">'+(w.status||'completed')+'</span></div></div></div>';
        }).join('')+'</div>';
    }
  }catch(e){ container.innerHTML='<div class="text-secondary text-sm">No loop data</div>'; }
}

// ============================================================
// RENDER: COST
// ============================================================
async function renderCostView(){
  const container = $('cost-content');
  if(!app.selectedGoalId){ container.innerHTML='<div class="text-secondary text-sm">Select a goal</div>'; return; }
  await loadGoalCost(app.selectedGoalId);
  const data = app.cost||{};
  container.innerHTML=
    '<div class="grid-3 mb-4">'+
      '<div class="card p-3 text-center"><div class="text-xs text-secondary">Total Tokens</div><div class="text-xl font-bold font-mono text-blue-400">'+((data.totalTokens||0).toLocaleString())+'</div></div>'+
      '<div class="card p-3 text-center"><div class="text-xs text-secondary">Total Cost</div><div class="text-xl font-bold font-mono text-green-400">$'+((data.totalCost||0).toFixed(4))+'</div></div>'+
      '<div class="card p-3 text-center"><div class="text-xs text-secondary">By Tool</div><div class="text-xl font-bold font-mono text-yellow-400">'+((data.byTool||[]).length)+' tools</div></div>'+
    '</div>'+
    '<div class="grid-2">'+
      '<div class="card p-4"><div class="text-sm font-semibold mb-3"><i class="fas fa-chart-bar text-blue-400 mr-2"></i>Cost by Wave</div><div style="height:120px"><canvas id="costWaveCanvas"></canvas></div></div>'+
      '<div class="card p-4"><div class="text-sm font-semibold mb-3"><i class="fas fa-chart-pie text-purple-400 mr-2"></i>Cost by Tool</div><div style="height:120px"><canvas id="costToolCanvas"></canvas></div></div>'+
    '</div>';
  destroyChart('costWave'); destroyChart('costTool');
  const wCtx = $('costWaveCanvas');
  if(wCtx){
    const wd = data.byWave||[];
    app.charts.costWave = new Chart(wCtx,{
      type:'bar',
      data:{labels:wd.length?wd.map(w=>'W'+w.waveNum):['No data'], datasets:[{label:'Tokens', data:wd.length?wd.map(w=>w.tokens||0):[0], backgroundColor:'#5b8def', borderRadius:4}]},
      options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
      scales:{y:{beginAtZero:true, grid:{color:'rgba(255,255,255,0.04)'}, ticks:{color:'#8896b0'}}, x:{ticks:{color:'#8896b0'}}}}
    });
  }
  const tCtx = $('costToolCanvas');
  if(tCtx){
    const td = data.byTool||[];
    const colors = ['#5b8def','#3bc98a','#8b7cf7','#e8b84b','#e8636b','#4dd4e8'];
    app.charts.costTool = new Chart(tCtx, {
      type: 'doughnut',
      data: {
        labels: td.length ? td.map(t => t.toolName) : ['No data'],
        datasets: [{
          data: td.length ? td.map(t => t.cost || 0) : [1],
          backgroundColor: colors.slice(0, Math.max(td.length, 1)),
          borderColor: 'rgba(9,13,26,0.6)',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { color: '#8896b0', boxWidth: 10, font: { size: 10 } }
          }
        },
        cutout: '60%'
      }
    });
  }
}

// ============================================================
// RENDER: ANALYTICS
// ============================================================
async function renderAnalyticsView(){
  const container = $('analytics-content');
  if(!app.selectedGoalId){ container.innerHTML='<div class="text-secondary text-sm">Select a goal</div>'; return; }
  const gid = app.selectedGoalId;
  container.innerHTML = '<div class="text-secondary text-sm">Loading analytics for: '+gid.slice(0,30)+'</div>';
  try{
    const detail = await fetch('/api/goals/'+gid+'/loops/1').then(r=>r.json()).catch(()=>null);
    const goals = app.goals||[];
    const g = goals.find(x=>(x.goalId||x.id)===gid);
    container.innerHTML =
      '<div class="grid-4 mb-4">'+
        '<div class="card p-3 text-center"><div class="text-xs text-secondary">Loops</div><div class="text-xl font-bold font-mono">'+(g?.loop||0)+'</div></div>'+
        '<div class="card p-3 text-center"><div class="text-xs text-secondary">Waves</div><div class="text-xl font-bold font-mono">'+(g?.currentWave||0)+'/'+(g?.totalWaves||0)+'</div></div>'+
        '<div class="card p-3 text-center"><div class="text-xs text-secondary">Sessions</div><div class="text-xl font-bold font-mono">'+(g?.sessions||0)+'</div></div>'+
        '<div class="card p-3 text-center"><div class="text-xs text-secondary">Status</div><div class="text-xl font-bold font-mono">'+(g?.phase||'\u2014')+'</div></div>'+
      '</div>'+
      '<div class="card p-4"><div class="text-sm font-semibold mb-3">Cost Trend</div><div style="height:120px"><canvas id="analyticsCostCanvas"></canvas></div></div>';
    destroyChart('analytics');
    const aCtx = $('analyticsCostCanvas');
    if(aCtx){
      const data = app.cost||{};
      const byWave = data.byWave||[];
      const costData = byWave.map(w=>w.cost||0);
      app.charts.analytics = new Chart(aCtx,{
        type:'line',
        data:{labels:byWave.length?byWave.map(w=>'W'+w.waveNum):['No data'],
          datasets:[{label:'Cost ($)', data:costData.length?costData:[0], borderColor:'#5b8def', backgroundColor:'rgba(91,141,239,0.1)', fill:true, tension:0.3, pointRadius:3}]},
        options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
        scales:{y:{beginAtZero:true, grid:{color:'rgba(255,255,255,0.04)'}, ticks:{color:'#8896b0'}}, x:{ticks:{color:'#8896b0'}}}}
      });
    }
  }catch(e){ container.innerHTML='<div class="text-secondary text-sm">Analytics unavailable</div>'; }
}

// ============================================================
// RENDER: TIMELINE
// ============================================================
function renderTimelineView(){
  const container = $('timeline-content');
  const fb = app.feedback||[];
  const filtered = app.selectedGoalId ? fb.filter(f=>f.goalId===app.selectedGoalId) : fb;
  if(!filtered.length){ container.innerHTML='<div class="text-secondary text-sm">No interventions recorded</div>'; return; }
  container.innerHTML = filtered.slice(0,30).map(f=>
    '<div class="flex items-center gap-4 py-2 border-b border-white/5 text-sm">'+
      '<span class="text-xs text-muted">'+(f.timestamp?new Date(f.timestamp).toLocaleString():'\u2014')+'</span>'+
      '<span>'+(f.type==='thumbs_up'?'\uD83D\uDC4D':f.type==='thumbs_down'?'\uD83D\uDC4E':'\u270F\uFE0F')+'</span>'+
      '<span class="text-secondary">'+(f.targetId||'\u2014')+'</span>'+
      '<span class="text-xs text-muted">'+(f.comment||'')+'</span></div>'
  ).join('');
}

// ============================================================
// RENDER ROUTER
// ============================================================
function renderView(name){
  switch(name){
    case 'overview': renderOverview(); break;
    case 'goals': renderGoalDetail(); break;
    case 'loops': renderLoopsView(); break;
    case 'sessions': renderSessionsView(); break;
    case 'memory': renderMemoryView(); break;
    case 'cost': renderCostView(); break;
    case 'analytics': renderAnalyticsView(); break;
    case 'timeline': renderTimelineView(); break;
    case 'alignment': renderAlignment(); break;
  }
}

// ============================================================
// ALIGNMENT
// ============================================================
async function loadAlignmentData(goalId) {
  try {
    var url = '/api/alignment' + (goalId ? '?goalId=' + encodeURIComponent(goalId) : '');
    var r = await fetch(url);
    app.state.alignment = await r.json();
  } catch(e) { app.state.alignment = null; }
}

function renderAlignment() {
  var data = app.state.alignment || {};
  var weights = data.weights || { speed: 0.3, quality: 0.5, cost: 0.2 };
  var actual = data.actualWeights || { speed: 0, quality: 0, cost: 0 };
  var score = data.score || 0;
  var circumference = 263.89;
  var dashoffset = circumference - (circumference * score / 100);
  var colors = { speed: 'var(--blue)', quality: 'var(--green)', cost: 'var(--yellow)' };
  var container = $('view-alignment');

  container.innerHTML =
    '<div class="card p-5 mb-4">' +
      '<div class="flex items-center justify-between mb-4"><h3 class="font-semibold text-sm">Goal Weight Alignment</h3></div>' +
      '<div class="grid grid-cols-2 gap-6">' +
        '<div><h4 class="text-xs font-semibold mb-3" style="color:var(--text-secondary);">Drag to adjust</h4>' +
          Object.keys(weights).map(function(k) {
            return '<div class="mb-3">' +
              '<div class="flex items-center gap-3">' +
                '<span class="text-xs w-12 capitalize" style="color:' + colors[k] + ';">' + k + '</span>' +
                '<input type="range" min="0" max="1" step="0.05" value="' + weights[k] + '"' +
                  ' class="flex-1 h-1.5 rounded-full" style="background:rgba(255,255,255,0.06)"' +
                  ' oninput="updateWeight(\'' + k + '\',this.value)" />' +
                '<span class="font-mono text-xs w-8 text-right" id="w-' + k + '">' + weights[k].toFixed(2) + '</span>' +
              '</div></div>';
          }).join('') +
        '</div>' +
        '<div><h4 class="text-xs font-semibold mb-3" style="color:var(--text-secondary);">Actual Distribution</h4>' +
          Object.keys(actual).map(function(k) {
            var val = actual[k] || 0;
            return '<div class="mb-2"><div class="flex justify-between text-xs mb-1"><span class="capitalize" style="color:' + colors[k] + ';">' + k + '</span><span class="font-mono">' + val.toFixed(2) + '</span></div>' +
              '<div class="h-2 rounded-full" style="background:var(--bg-tertiary);"><div class="h-2 rounded-full" style="width:' + (val * 100) + '%;background:' + colors[k] + ';"></div></div></div>';
          }).join('') +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="card p-5">' +
      '<h3 class="font-semibold text-sm mb-4">Alignment Score</h3>' +
      '<div class="flex items-center gap-4">' +
        '<div class="relative w-24 h-24">' +
          '<svg class="w-24 h-24 transform -rotate-90">' +
            '<circle cx="48" cy="48" r="42" fill="none" stroke="var(--bg-tertiary)" stroke-width="6"/>' +
            '<circle cx="48" cy="48" r="42" fill="none" stroke="' + (score > 70 ? 'var(--green)' : score > 40 ? 'var(--yellow)' : 'var(--red)') + '" stroke-width="6" stroke-dasharray="' + circumference + '" stroke-dashoffset="' + dashoffset + '"/>' +
          '</svg>' +
          '<div class="absolute inset-0 flex items-center justify-center"><span class="text-xl font-bold" style="color:' + (score > 70 ? 'var(--green)' : score > 40 ? 'var(--yellow)' : 'var(--red)') + ';">' + score + '%</span></div>' +
        '</div>' +
        '<div class="text-sm" style="color:var(--text-secondary);">' +
          (score > 70 ? 'Good alignment' : score > 40 ? 'Some deviation' : 'Misaligned') +
        '</div>' +
      '</div>' +
    '</div>';
}

window.updateWeight = function(key, val) {
  var data = app.state.alignment || { weights: { speed: 0.3, quality: 0.5, cost: 0.2 }, actualWeights: { speed: 0, quality: 0, cost: 0 } };
  data.weights[key] = parseFloat(val);
  var total = Object.values(data.weights).reduce(function(a, b) { return a + b; }, 0);
  Object.keys(data.weights).forEach(function(k) {
    data.weights[k] = parseFloat((data.weights[k] / total).toFixed(2));
    var el = document.getElementById('w-' + k);
    if (el) el.textContent = data.weights[k].toFixed(2);
  });
  // Recompute alignment score
  var actual = data.actualWeights || { speed: 0, quality: 0, cost: 0 };
  var diff = Math.abs(data.weights.speed - actual.speed) +
    Math.abs(data.weights.quality - actual.quality) +
    Math.abs(data.weights.cost - actual.cost);
  data.score = Math.round((1 - diff / 2) * 100);
  app.state.alignment = data;
  renderAlignment();
  // Save to backend
  fetch('/api/alignment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data.weights)
  }).catch(function() {});
};

// ============================================================
// SSE
// ============================================================
function setupSSE(){
  const port = window.location.port||'3000';
  const base = window.location.protocol+'//'+window.location.hostname+':'+port;
  const es = new EventSource(base+'/api/events?stream=true');
  es.onmessage = function(e){
    try{
      const ev = JSON.parse(e.data);
      if(ev.type==='state_change'||ev.type==='feedback') refreshAll();
      const container = $('ov-log-container');
      const empty = $('ov-log-empty');
      if(empty) empty.remove();
      const line = document.createElement('div');
      line.className = 'log-line';
      const time = new Date().toLocaleTimeString();
      line.innerHTML = '<span class="log-time">'+time+'</span><span class="log-level info">'+(ev.type||'evt')+'</span><span class="log-msg">'+(ev.message||JSON.stringify(ev).slice(0,80))+'</span>';
      container.appendChild(line);
      container.scrollTop = container.scrollHeight;
      while(container.children.length>100) container.removeChild(container.firstChild);
    }catch(e){}
  };
  es.onerror = function(){};
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async function(){
  document.querySelectorAll('.nav-tab').forEach(el=>{
    el.addEventListener('click', function(){ switchView(this.dataset.view); });
  });
  app.projectDir = window.location.pathname||'unknown';
  $('project-path').textContent = app.projectDir.slice(0,30)||'~/workspace';
  $('goalSelector').addEventListener('change', function(){ selectGoal(this.value); });
  setupSSE();
  await refreshAll();
  setInterval(refreshAll, 15000);
  renderView('overview');
});

window.switchView = switchView;
})();
