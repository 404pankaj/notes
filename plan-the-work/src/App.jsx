import { useState, useEffect, useCallback } from 'react'
import { LayoutDashboard, ListChecks, AlertTriangle, ChevronLeft, Plus, Pencil, Trash2, Search, ChevronDown, ChevronRight, ExternalLink, X, Settings, RefreshCw, CheckCircle, XCircle, Loader } from 'lucide-react'
import initialData from './data.json'

// ─── Jira helpers ──────────────────────────────────────────────────────
function useJiraConfig() {
  const [cfg, setCfg] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ptw_jira') || 'null') } catch { return null }
  })
  const save = c => { setCfg(c); localStorage.setItem('ptw_jira', JSON.stringify(c)) }
  const clear = () => { setCfg(null); localStorage.removeItem('ptw_jira') }
  return [cfg, save, clear]
}

function adfToText(doc) {
  if (!doc) return ''
  if (typeof doc === 'string') return doc
  const walk = nodes => (nodes || []).flatMap(n => {
    if (n.text) return [n.text]
    if (n.content) return walk(n.content)
    return []
  })
  return walk(doc.content || []).join('').trim()
}

const JIRA_STATUS_MAP = {
  'To Do': 'To be Groomed', 'Backlog': 'To be Groomed', 'Open': 'To be Groomed',
  'In Progress': 'In progress', 'In Review': 'In progress', 'In Development': 'In progress',
  'Done': 'Completed', 'Closed': 'Completed', 'Resolved': 'Completed',
  'Released': 'Released', 'Blocked': 'Blocked', 'Deferred': 'Deferred', 'On Hold': 'On Hold',
}
const JIRA_TASK_STATUS_MAP = {
  'To Do': 'Planned', 'Open': 'Planned', 'Backlog': 'Planned',
  'In Progress': 'In Progress', 'In Review': 'Code Review',
  'Done': 'Done', 'Closed': 'Done', 'Released': 'Released',
  'Blocked': 'Blocked', 'On Hold': 'On Hold',
}

function mapJiraToEpicFields(issue) {
  const f = issue.fields
  return {
    project: f.summary || '',
    status: JIRA_STATUS_MAP[f.status?.name] || f.status?.name || '',
    deliveryOwner: f.assignee?.displayName || f.assignee?.emailAddress || '',
    plannedReleaseDate: f.duedate || '',
    generalComments: adfToText(f.description),
    completionPct: f.status?.statusCategory?.key === 'done' ? 1 : undefined,
  }
}

function mapJiraToTaskFields(issue) {
  const f = issue.fields
  const sprint = f.customfield_10020 || f.customfield_10014
  const sprintName = Array.isArray(sprint) ? sprint[sprint.length - 1]?.name || '' : sprint?.name || ''
  const pts = f.story_points ?? f.customfield_10016 ?? f.customfield_10028
  return {
    task: f.summary || '',
    planningState: JIRA_TASK_STATUS_MAP[f.status?.name] || f.status?.name || 'Planned',
    devOwner: f.assignee?.displayName || '',
    estimatedReleaseDate: f.duedate || '',
    sprintDev: sprintName,
    devEstimates: pts != null ? String(pts) : '',
  }
}

async function callJiraProxy(cfg, ticket) {
  const res = await fetch('/api/jira', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseUrl: cfg.baseUrl, email: cfg.email, token: cfg.token, ticket }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.errorMessages?.[0] || data.message || data.error || `HTTP ${res.status}`)
  return data
}

function JiraFetchBtn({ ticket, onFetch, jiraCfg, mapFn }) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [ok, setOk] = useState(false)
  const go = async () => {
    if (!ticket || !jiraCfg) return
    setLoading(true); setErr(null); setOk(false)
    try {
      const issue = await callJiraProxy(jiraCfg, ticket)
      onFetch(mapFn(issue))
      setOk(true); setTimeout(() => setOk(false), 2000)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }
  if (!jiraCfg) return <span style={{fontSize:11,color:'var(--text3)'}}>Configure Jira to auto-fill</span>
  return (
    <span style={{display:'inline-flex',alignItems:'center',gap:6}}>
      <button className="btn btn-ghost btn-sm" onClick={go} disabled={!ticket || loading} style={{fontSize:11}}>
        {loading ? <Loader size={11} style={{animation:'spin 1s linear infinite'}}/> : ok ? <CheckCircle size={11} color="var(--green)"/> : <RefreshCw size={11}/>}
        {loading ? ' Fetching…' : ok ? ' Done' : ' Fetch from Jira'}
      </button>
      {err && <span style={{fontSize:11,color:'var(--red)',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={err}>{err}</span>}
    </span>
  )
}

// ─── Jira Settings Page ─────────────────────────────────────────────────
function JiraSettingsPage({ jiraCfg, saveJiraCfg, clearJiraCfg }) {
  const blank = { baseUrl: '', email: '', token: '' }
  const [f, setF] = useState(jiraCfg || blank)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const set = k => e => setF(p => ({ ...p, [k]: e.target.value }))

  const test = async () => {
    setTesting(true); setTestResult(null)
    try {
      const isCloud = f.baseUrl.includes('atlassian.net')
      const v = isCloud ? '3' : '2'
      const url = `${f.baseUrl.replace(/\/$/, '')}/rest/api/${v}/myself`
      const auth = f.email
        ? `Basic ${btoa(`${f.email}:${f.token}`)}`
        : `Bearer ${f.token}`
      // Try direct first (works on same network); fallback to proxy
      let data, ok
      try {
        const r = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' } })
        ok = r.ok; data = await r.json()
      } catch {
        // CORS blocked — try via proxy
        const r = await fetch('/api/jira', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ baseUrl: f.baseUrl, email: f.email, token: f.token, ticket: '_myself' }),
        })
        ok = r.status !== 500; data = await r.json()
      }
      if (ok && data.displayName) {
        setTestResult({ ok: true, msg: `Connected as ${data.displayName}` })
        saveJiraCfg(f)
      } else {
        setTestResult({ ok: false, msg: data.errorMessages?.[0] || data.message || 'Auth failed' })
      }
    } catch (e) {
      setTestResult({ ok: false, msg: e.message })
    } finally { setTesting(false) }
  }

  return (
    <>
      <div className="topbar"><h2>Jira Integration</h2></div>
      <div className="content" style={{ maxWidth: 560 }}>
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16, lineHeight: 1.6 }}>
            Connect to Jira to auto-fill epic and task fields from ticket numbers.
            Credentials are stored locally in your browser only.
          </div>
          <div className="form-grid cols-1" style={{ gap: 12 }}>
            <div className="form-group">
              <label>Jira Base URL</label>
              <input type="text" value={f.baseUrl} onChange={set('baseUrl')} placeholder="https://yourcompany.atlassian.net  or  https://jira.company.com/jira" />
            </div>
            <div className="form-group">
              <label>Email / Username</label>
              <input type="text" value={f.email} onChange={set('email')} placeholder="your@email.com  (leave blank to use Bearer token)" />
            </div>
            <div className="form-group">
              <label>API Token / Password / PAT</label>
              <input type="text" value={f.token} onChange={set('token')} placeholder="API token or personal access token" />
            </div>
          </div>
          <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={test} disabled={!f.baseUrl || !f.token || testing}>
              {testing ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle size={13} />}
              {testing ? ' Testing…' : ' Test & Save'}
            </button>
            {jiraCfg && <button className="btn btn-ghost" onClick={() => { clearJiraCfg(); setF(blank); setTestResult(null) }}>Disconnect</button>}
            {testResult && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: testResult.ok ? 'var(--green)' : 'var(--red)' }}>
                {testResult.ok ? <CheckCircle size={14} /> : <XCircle size={14} />}
                {testResult.msg}
              </span>
            )}
          </div>
        </div>

        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>How to get your API token</div>
          <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.8 }}>
            <b>Jira Cloud</b> (atlassian.net): Go to <code style={{ background: 'var(--bg3)', padding: '1px 5px', borderRadius: 3 }}>id.atlassian.com/manage-profile/security/api-tokens</code> → Create token.<br />
            Enter your email + the token above.<br /><br />
            <b>Jira Server / Data Center</b>: Go to your profile → Personal Access Tokens → Create.<br />
            Leave Email blank and paste the PAT as the token.<br /><br />
            <b>Internal servers</b>: The proxy runs from Netlify's servers. If your Jira is behind a
            firewall/VPN, run <code style={{ background: 'var(--bg3)', padding: '1px 5px', borderRadius: 3 }}>netlify dev</code> locally so the proxy runs on your machine.
          </div>
        </div>
      </div>
    </>
  )
}

// ─── helpers ───────────────────────────────────────────────────────────
const STATUS_CLASS = {
  'Completed': 'badge-green', 'completed': 'badge-green', 'Released': 'badge-green', 'Released ': 'badge-green',
  'In progress': 'badge-blue', 'In Progress': 'badge-blue', 'In-progress': 'badge-blue', 'In-Progress': 'badge-blue',
  'To be Groomed': 'badge-amber', 'To Be Groomed': 'badge-amber',
  'Deferred': 'badge-gray', 'Deffered': 'badge-gray', 'On Hold': 'badge-gray', 'On Hold ': 'badge-gray',
  'Partially released': 'badge-teal', 'Partially Released': 'badge-teal',
  'Blocked': 'badge-red',
  'Done': 'badge-green', 'Done, ': 'badge-green',
  'Planned': 'badge-blue',
  'Code Review': 'badge-amber', 'Code Review ': 'badge-amber',
  'Released and Closed': 'badge-green',
}

const PRIORITY_CLASS = { P1: 'badge-red', P2: 'badge-orange', P3: 'badge-amber' }
const IMPACT_CLASS = { High: 'badge-red', Medium: 'badge-orange', Low: 'badge-amber' }
const RISK_STATUS_CLASS = { Closed: 'badge-green', Open: 'badge-red', Planning: 'badge-amber' }

function statusBadge(s) {
  if (!s) return null
  const cls = STATUS_CLASS[s] || 'badge-gray'
  return <span className={`badge ${cls}`}>{s}</span>
}

function Progress({ pct }) {
  if (pct == null) return <span className="text-muted" style={{fontSize:12}}>—</span>
  const v = Math.round(pct * 100)
  const color = v >= 100 ? '#10b981' : v >= 60 ? '#3b82f6' : v >= 30 ? '#f59e0b' : '#ef4444'
  return (
    <div className="progress-wrap">
      <div className="progress-bar"><div className="progress-fill" style={{width:`${v}%`, background:color}} /></div>
      <span className="progress-text">{v}%</span>
    </div>
  )
}

function JiraLink({ ticket }) {
  if (!ticket) return <span className="text-muted">—</span>
  return <span className="jira-link"><ExternalLink size={10} />{ticket}</span>
}

function Modal({ title, onClose, children, large }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${large ? 'modal-lg' : ''}`}>
        <div style={{display:'flex',alignItems:'center',marginBottom:20}}>
          <h3 style={{margin:0,flex:1}}>{title}</h3>
          <button className="btn-icon" onClick={onClose}><X size={16}/></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function useData() {
  const [data, setData] = useState(() => {
    try { const s = localStorage.getItem('ptw_data'); return s ? JSON.parse(s) : initialData } catch { return initialData }
  })
  useEffect(() => { localStorage.setItem('ptw_data', JSON.stringify(data)) }, [data])
  return [data, setData]
}

// ─── Epic form ──────────────────────────────────────────────────────────
const EPIC_STATUSES = ['In progress','To be Groomed','Completed','Partially released','Deferred','Blocked','Released','Planned','On Hold']
const PRODUCT_AREAS = ['Activation','Delivery Layer','Optimization','Signal and Attribution','Observability','Analytics']
const DETAIL_SHEETS = ['Bid Prediction Line Item','Activate-UI','AdServer( Delivery)','ML (Optimization)','CTR Tuning','Bid Landscape','Bidder ( Delivery)','Attribution and ID Consistency','Analytics','(none)']

function EpicForm({ epic, onSave, onClose, jiraCfg }) {
  const blank = { num:'', productArea:'', quarter:'', project:'', epicTicket:'', deliveryOwner:'', status:'To be Groomed', commentsOnProgress:'', completionPct:'', devStart:'', devComplete:'', qaStart:'', qaEnd:'', integrationTestingTicket:'', integrationTestingComplete:'', uatComplete:'', plannedReleaseDate:'', actualReleaseDate:'', generalComments:'' }
  const [f, setF] = useState(epic ? {...epic, completionPct: epic.completionPct != null ? Math.round(epic.completionPct*100) : ''} : blank)
  const set = k => e => setF(p => ({...p, [k]: e.target.value}))
  const save = () => onSave({...f, id: epic?.id || Date.now(), completionPct: f.completionPct !== '' ? parseFloat(f.completionPct)/100 : null })
  const applyJira = fields => setF(p => ({
    ...p,
    ...(fields.project && { project: fields.project }),
    ...(fields.status && { status: fields.status }),
    ...(fields.deliveryOwner && { deliveryOwner: fields.deliveryOwner }),
    ...(fields.plannedReleaseDate && { plannedReleaseDate: fields.plannedReleaseDate }),
    ...(fields.generalComments && { generalComments: fields.generalComments }),
    ...(fields.completionPct != null && { completionPct: Math.round(fields.completionPct * 100) }),
  }))
  return (
    <>
      <div className="form-grid">
        <div className="form-group span-2">
          <label>Epic / Project Name *</label>
          <input type="text" value={f.project} onChange={set('project')} placeholder="Project description..." />
        </div>
        <div className="form-group">
          <label>EPIC Ticket</label>
          <input type="text" value={f.epicTicket||''} onChange={set('epicTicket')} placeholder="APEX-000" />
          <div style={{marginTop:5}}><JiraFetchBtn ticket={f.epicTicket} onFetch={applyJira} jiraCfg={jiraCfg} mapFn={mapJiraToEpicFields} /></div>
        </div>
        <div className="form-group"><label>Delivery Owner</label><input type="text" value={f.deliveryOwner||''} onChange={set('deliveryOwner')} /></div>
        <div className="form-group">
          <label>Product Area</label>
          <select value={f.productArea||''} onChange={set('productArea')}>
            <option value="">Select...</option>
            {PRODUCT_AREAS.map(a => <option key={a}>{a}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Quarter</label><input type="text" value={f.quarter||''} onChange={set('quarter')} placeholder="1, 2, 3, 4" /></div>
        <div className="form-group">
          <label>Status</label>
          <select value={f.status||''} onChange={set('status')}>
            {EPIC_STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Completion % (0-100)</label><input type="number" min="0" max="100" value={f.completionPct} onChange={set('completionPct')} /></div>
        <div className="form-group"><label>Dev Start</label><input type="date" value={f.devStart||''} onChange={set('devStart')} /></div>
        <div className="form-group"><label>Dev Complete</label><input type="date" value={f.devComplete||''} onChange={set('devComplete')} /></div>
        <div className="form-group"><label>QA Start</label><input type="date" value={f.qaStart||''} onChange={set('qaStart')} /></div>
        <div className="form-group"><label>QA End</label><input type="date" value={f.qaEnd||''} onChange={set('qaEnd')} /></div>
        <div className="form-group"><label>Integration Testing Ticket</label><input type="text" value={f.integrationTestingTicket||''} onChange={set('integrationTestingTicket')} /></div>
        <div className="form-group"><label>Integration Testing Complete</label><input type="date" value={f.integrationTestingComplete||''} onChange={set('integrationTestingComplete')} /></div>
        <div className="form-group"><label>UAT Complete</label><input type="text" value={f.uatComplete||''} onChange={set('uatComplete')} /></div>
        <div className="form-group"><label>Planned Release Date</label><input type="date" value={f.plannedReleaseDate||''} onChange={set('plannedReleaseDate')} /></div>
        <div className="form-group"><label>Actual Release Date</label><input type="date" value={f.actualReleaseDate||''} onChange={set('actualReleaseDate')} /></div>
        <div className="form-group span-2"><label>Comments on Progress</label><textarea value={f.commentsOnProgress||''} onChange={set('commentsOnProgress')} /></div>
        <div className="form-group span-2"><label>General Comments</label><textarea value={f.generalComments||''} onChange={set('generalComments')} /></div>
      </div>
      <div className="form-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>Save Epic</button>
      </div>
    </>
  )
}

// ─── Epics Page ──────────────────────────────────────────────────────────
function EpicsPage({ data, setData, onSelectEpic, jiraCfg }) {
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('All')
  const [filterArea, setFilterArea] = useState('All')
  const [filterQ, setFilterQ] = useState('All')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState(null)

  const syncAll = async () => {
    if (!jiraCfg) return
    setSyncing(true); setSyncResult(null)
    let updated = 0, failed = 0
    const epicsWithTickets = data.epics.filter(e => e.epicTicket)
    for (const epic of epicsWithTickets) {
      try {
        const issue = await callJiraProxy(jiraCfg, epic.epicTicket)
        const fields = mapJiraToEpicFields(issue)
        setData(d => ({ ...d, epics: d.epics.map(e => e.id === epic.id ? {
          ...e,
          status: fields.status || e.status,
          deliveryOwner: fields.deliveryOwner || e.deliveryOwner,
          generalComments: fields.generalComments || e.generalComments,
          plannedReleaseDate: fields.plannedReleaseDate || e.plannedReleaseDate,
          completionPct: fields.completionPct != null ? fields.completionPct : e.completionPct,
        } : e) }))
        updated++
      } catch { failed++ }
    }
    setSyncing(false)
    setSyncResult(`Synced ${updated} epics${failed ? `, ${failed} failed` : ''}`)
    setTimeout(() => setSyncResult(null), 4000)
  }

  const epics = data.epics
  const statuses = ['All', ...new Set(epics.map(e => e.status).filter(Boolean))]
  const areas = ['All', ...new Set(epics.map(e => e.productArea).filter(Boolean))]
  const quarters = ['All', ...new Set(epics.map(e => e.quarter).filter(Boolean))]

  const filtered = epics.filter(e => {
    const q = search.toLowerCase()
    if (search && !`${e.project} ${e.epicTicket} ${e.deliveryOwner}`.toLowerCase().includes(q)) return false
    if (filterStatus !== 'All' && e.status !== filterStatus) return false
    if (filterArea !== 'All' && e.productArea !== filterArea) return false
    if (filterQ !== 'All' && String(e.quarter) !== filterQ) return false
    return true
  })

  const stats = {
    total: epics.length,
    inProgress: epics.filter(e => (e.status||'').toLowerCase().includes('in progress')).length,
    completed: epics.filter(e => (e.status||'').toLowerCase().includes('complet') || (e.status||'').toLowerCase().includes('released')).length,
    toGroom: epics.filter(e => (e.status||'').toLowerCase().includes('groom')).length,
  }

  const saveEpic = epic => {
    setData(d => ({
      ...d,
      epics: editing ? d.epics.map(e => e.id === epic.id ? epic : e) : [...d.epics, epic]
    }))
    setShowModal(false); setEditing(null)
  }
  const deleteEpic = id => {
    if (!confirm('Delete this epic?')) return
    setData(d => ({ ...d, epics: d.epics.filter(e => e.id !== id) }))
  }

  return (
    <>
      <div className="topbar">
        <h2>Epics & Projects</h2>
        {jiraCfg && (
          <button className="btn btn-ghost btn-sm" onClick={syncAll} disabled={syncing} title="Sync status from Jira for all epics with tickets">
            {syncing ? <Loader size={13} style={{animation:'spin 1s linear infinite'}}/> : <RefreshCw size={13}/>}
            {syncing ? ' Syncing…' : ' Sync All from Jira'}
          </button>
        )}
        {syncResult && <span style={{fontSize:12,color:'var(--green)'}}>{syncResult}</span>}
        <button className="btn btn-primary btn-sm" onClick={() => { setEditing(null); setShowModal(true) }}><Plus size={14}/>Add Epic</button>
      </div>
      <div className="content">
        <div className="stats-grid">
          <div className="stat-card"><div className="label">Total Epics</div><div className="value">{stats.total}</div></div>
          <div className="stat-card"><div className="label">In Progress</div><div className="value" style={{color:'#60a5fa'}}>{stats.inProgress}</div></div>
          <div className="stat-card"><div className="label">Completed</div><div className="value" style={{color:'#34d399'}}>{stats.completed}</div></div>
          <div className="stat-card"><div className="label">To Be Groomed</div><div className="value" style={{color:'#fbbf24'}}>{stats.toGroom}</div></div>
          <div className="stat-card"><div className="label">Avg Completion</div><div className="value">{Math.round(epics.filter(e=>e.completionPct!=null).reduce((a,e)=>a+(e.completionPct||0),0)/Math.max(1,epics.filter(e=>e.completionPct!=null).length)*100)}%</div></div>
        </div>

        <div className="filters-bar">
          <div className="search-box"><Search size={14}/><input placeholder="Search epics..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
          <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
            {statuses.map(s=><option key={s}>{s}</option>)}
          </select>
          <select value={filterArea} onChange={e=>setFilterArea(e.target.value)}>
            {areas.map(a=><option key={a}>{a}</option>)}
          </select>
          <select value={filterQ} onChange={e=>setFilterQ(e.target.value)}>
            {quarters.map(q=><option key={q}>Q{q !== 'All' ? q : ''}{q==='All'?'All':''}</option>)}
          </select>
          <span className="text-muted" style={{fontSize:12,marginLeft:'auto'}}>{filtered.length} of {epics.length}</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th style={{minWidth:260}}>Epic / Project</th>
                <th>Ticket</th>
                <th>Area</th>
                <th>Q</th>
                <th>Owner</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Dev Start</th>
                <th>Release Date</th>
                <th>Comments</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(epic => (
                <tr key={epic.id} className="clickable" onClick={()=>onSelectEpic(epic)}>
                  <td className="text-muted" style={{fontSize:12}}>{epic.num}</td>
                  <td style={{maxWidth:280}}>
                    <div style={{fontWeight:500,lineHeight:1.4,overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>{epic.project}</div>
                  </td>
                  <td><JiraLink ticket={epic.epicTicket}/></td>
                  <td style={{fontSize:12,color:'var(--text2)'}}>{epic.productArea||'—'}</td>
                  <td style={{fontSize:12,textAlign:'center'}}>{epic.quarter||'—'}</td>
                  <td style={{fontSize:12}}>{epic.deliveryOwner||'—'}</td>
                  <td>{statusBadge(epic.status)}</td>
                  <td><Progress pct={epic.completionPct}/></td>
                  <td style={{fontSize:12,color:'var(--text2)'}}>{epic.devStart||'—'}</td>
                  <td style={{fontSize:12,color:'var(--text2)'}}>{epic.actualReleaseDate || epic.plannedReleaseDate || '—'}</td>
                  <td><div className="note-cell">{epic.commentsOnProgress||epic.generalComments||'—'}</div></td>
                  <td onClick={e=>e.stopPropagation()} style={{whiteSpace:'nowrap'}}>
                    <button className="btn-icon" onClick={()=>{setEditing(epic);setShowModal(true)}}><Pencil size={13}/></button>
                    <button className="btn-icon" onClick={()=>deleteEpic(epic.id)}><Trash2 size={13}/></button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={12} className="empty"><p>No epics match the filters.</p></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {showModal && (
        <Modal title={editing ? 'Edit Epic' : 'Add Epic'} onClose={()=>{setShowModal(false);setEditing(null)}}>
          <EpicForm epic={editing} onSave={saveEpic} onClose={()=>{setShowModal(false);setEditing(null)}} jiraCfg={jiraCfg}/>
        </Modal>
      )}
    </>
  )
}

// ─── Epic Detail Page ────────────────────────────────────────────────────
const TASK_STATUSES = ['Planned','In Progress','Done','Released','Released ','To be started','In-Progress','Code Review','On Hold','NA','Blocked']
const COMPONENTS = ['Bidder','ML','Analytics','Delivery','UI','UI-API','Backend API','UX','TW','Bidder/ML']

function TaskForm({ task, sheetName, onSave, onClose, jiraCfg }) {
  const blank = { releaseMilestone:'', epic:'', task:'', component:'', planningState:'Planned', sprintDev:'', sprintQA:'', devOwner:'', jira:'', devEstimates:'', devStartDate:'', devEndDate:'', qaEstimates:'', qaStartDate:'', qaEndDate:'', integrationTesting:'', uat:'', estimatedReleaseDate:'', dependencies:'' }
  const [f, setF] = useState(task || blank)
  const set = k => e => setF(p => ({...p, [k]: e.target.value}))
  const save = () => onSave({...f, id: task?.id || Date.now(), num: task?.num})
  const applyJira = fields => setF(p => ({
    ...p,
    ...(fields.task && { task: fields.task }),
    ...(fields.planningState && { planningState: fields.planningState }),
    ...(fields.devOwner && { devOwner: fields.devOwner }),
    ...(fields.estimatedReleaseDate && { estimatedReleaseDate: fields.estimatedReleaseDate }),
    ...(fields.sprintDev && { sprintDev: fields.sprintDev }),
    ...(fields.devEstimates && { devEstimates: fields.devEstimates }),
  }))
  return (
    <>
      <div className="form-grid">
        <div className="form-group span-2"><label>Task *</label><textarea value={f.task||''} onChange={set('task')} style={{minHeight:50}} /></div>
        <div className="form-group">
          <label>JIRA Ticket</label>
          <input type="text" value={f.jira||''} onChange={set('jira')} placeholder="APEX-000" />
          <div style={{marginTop:5}}><JiraFetchBtn ticket={f.jira} onFetch={applyJira} jiraCfg={jiraCfg} mapFn={mapJiraToTaskFields} /></div>
        </div>
        <div className="form-group"><label>Dev/QA Owner</label><input type="text" value={f.devOwner||''} onChange={set('devOwner')} /></div>
        <div className="form-group"><label>Epic</label><input type="text" value={f.epic||''} onChange={set('epic')} /></div>
        <div className="form-group"><label>Component</label><input type="text" value={f.component||''} onChange={set('component')} /></div>
        <div className="form-group">
          <label>Planning State</label>
          <select value={f.planningState||''} onChange={set('planningState')}>
            {TASK_STATUSES.map(s=><option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Release Milestone</label><input type="text" value={f.releaseMilestone||''} onChange={set('releaseMilestone')} /></div>
        <div className="form-group"><label>Sprint Dev</label><input type="text" value={f.sprintDev||''} onChange={set('sprintDev')} /></div>
        <div className="form-group"><label>Sprint QA</label><input type="text" value={f.sprintQA||''} onChange={set('sprintQA')} /></div>
        <div className="form-group"><label>Dev Estimates (days)</label><input type="number" value={f.devEstimates||''} onChange={set('devEstimates')} /></div>
        <div className="form-group"><label>Dev Start Date</label><input type="date" value={f.devStartDate||''} onChange={set('devStartDate')} /></div>
        <div className="form-group"><label>Dev End Date</label><input type="date" value={f.devEndDate||''} onChange={set('devEndDate')} /></div>
        <div className="form-group"><label>QA Estimates (days)</label><input type="number" value={f.qaEstimates||''} onChange={set('qaEstimates')} /></div>
        <div className="form-group"><label>QA Start Date</label><input type="date" value={f.qaStartDate||''} onChange={set('qaStartDate')} /></div>
        <div className="form-group"><label>QA End Date</label><input type="date" value={f.qaEndDate||''} onChange={set('qaEndDate')} /></div>
        <div className="form-group"><label>Integration Testing</label><input type="text" value={f.integrationTesting||''} onChange={set('integrationTesting')} /></div>
        <div className="form-group"><label>UAT</label><input type="text" value={f.uat||''} onChange={set('uat')} /></div>
        <div className="form-group"><label>Estimated Release Date</label><input type="date" value={f.estimatedReleaseDate||''} onChange={set('estimatedReleaseDate')} /></div>
        <div className="form-group span-2"><label>Dependencies</label><textarea value={f.dependencies||''} onChange={set('dependencies')} style={{minHeight:50}} /></div>
      </div>
      <div className="form-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save}>Save Task</button>
      </div>
    </>
  )
}

function EpicDetailPage({ epic, data, setData, onBack, jiraCfg }) {
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)

  const sheetKey = Object.keys(data.epicDetails).find(k =>
    epic.epicTicket && (k.toLowerCase().includes(epic.epicTicket.toLowerCase().split('-')[1]?.substring(0,3)||'XXXXXXX')) ||
    Object.keys(data.epicDetails).find(k2 => k2 === k)
  )

  // Try to find the best matching sheet
  const matchSheet = () => {
    const sheets = Object.keys(data.epicDetails)
    // Simple heuristic: check if epic project name keywords match sheet names
    for (const s of sheets) {
      if (epic.project && epic.project.toLowerCase().includes(s.toLowerCase().replace(/[^a-z]/g,''))) return s
    }
    return null
  }

  const [activeSheet, setActiveSheet] = useState(() => {
    const allSheets = Object.keys(data.epicDetails)
    // Try to guess from project name
    const guesses = {
      'Bid Prediction': 'Bid Prediction Line Item',
      'Activate UI': 'Activate-UI',
      'Activate changes': 'Activate-UI',
      'AdServer': 'AdServer( Delivery)',
      'CTR': 'CTR Tuning',
      'Bid Landscape': 'Bid Landscape',
      'Bidder': 'Bidder ( Delivery)',
      'Attribution': 'Attribution and ID Consistency',
      'Analytics': 'Analytics',
      'ML': 'ML (Optimization)',
      'Moving APEx': 'Bid Prediction Line Item',
    }
    for (const [k,v] of Object.entries(guesses)) {
      if (epic.project && epic.project.includes(k)) return v
    }
    return allSheets[0]
  })

  const tasks = (data.epicDetails[activeSheet] || [])
  const allSheets = Object.keys(data.epicDetails)

  const saveTask = task => {
    setData(d => ({
      ...d,
      epicDetails: {
        ...d.epicDetails,
        [activeSheet]: editing
          ? d.epicDetails[activeSheet].map(t => t.id === task.id ? task : t)
          : [...(d.epicDetails[activeSheet]||[]), task]
      }
    }))
    setShowModal(false); setEditing(null)
  }
  const deleteTask = id => {
    if (!confirm('Delete task?')) return
    setData(d => ({
      ...d,
      epicDetails: { ...d.epicDetails, [activeSheet]: d.epicDetails[activeSheet].filter(t=>t.id!==id) }
    }))
  }

  return (
    <>
      <div className="topbar">
        <button className="back-btn" onClick={onBack} style={{marginBottom:0}}><ChevronLeft size={16}/>Back to Epics</button>
        <h2 style={{fontSize:14}}>{epic.project?.substring(0,60)}{epic.project?.length>60?'...':''}</h2>
        <button className="btn btn-primary btn-sm" onClick={()=>{setEditing(null);setShowModal(true)}}><Plus size={14}/>Add Task</button>
      </div>
      <div className="content">
        <div className="epic-header">
          <h2>{epic.project}</h2>
          <div className="epic-meta">
            {epic.epicTicket && <div className="epic-meta-item"><span className="key">Ticket:</span>&nbsp;<JiraLink ticket={epic.epicTicket}/></div>}
            {epic.productArea && <div className="epic-meta-item"><span className="key">Area:</span>&nbsp;<span className="val">{epic.productArea}</span></div>}
            {epic.deliveryOwner && <div className="epic-meta-item"><span className="key">Owner:</span>&nbsp;<span className="val">{epic.deliveryOwner}</span></div>}
            {epic.status && <div className="epic-meta-item"><span className="key">Status:</span>&nbsp;{statusBadge(epic.status)}</div>}
            {epic.completionPct != null && <div className="epic-meta-item"><span className="key">Progress:</span>&nbsp;<Progress pct={epic.completionPct}/></div>}
            {epic.actualReleaseDate && <div className="epic-meta-item"><span className="key">Release:</span>&nbsp;<span className="val" style={{color:'#34d399'}}>{epic.actualReleaseDate}</span></div>}
            {!epic.actualReleaseDate && epic.plannedReleaseDate && <div className="epic-meta-item"><span className="key">Planned Release:</span>&nbsp;<span className="val">{epic.plannedReleaseDate}</span></div>}
          </div>
          {(epic.commentsOnProgress || epic.generalComments) && (
            <div style={{marginTop:12,fontSize:12,color:'var(--text2)',background:'var(--bg3)',padding:'8px 12px',borderRadius:'var(--radius-sm)',lineHeight:1.6}}>
              {epic.commentsOnProgress || epic.generalComments}
            </div>
          )}
        </div>

        {/* Sheet Selector */}
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14,flexWrap:'wrap'}}>
          <span style={{fontSize:12,color:'var(--text3)'}}>Detail Sheet:</span>
          {allSheets.map(s => (
            <button key={s} onClick={()=>setActiveSheet(s)}
              className="btn btn-sm" style={{
                background: activeSheet===s ? 'var(--accent)' : 'var(--bg3)',
                color: activeSheet===s ? '#fff' : 'var(--text2)',
                border: `1px solid ${activeSheet===s ? 'var(--accent)' : 'var(--border)'}`,
                fontSize: 11,
              }}>
              {s} ({(data.epicDetails[s]||[]).length})
            </button>
          ))}
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{minWidth:200}}>Task</th>
                <th>JIRA</th>
                <th>Component</th>
                <th>Owner</th>
                <th>State</th>
                <th>Sprint</th>
                <th>Dev Start</th>
                <th>Dev End</th>
                <th>QA Start</th>
                <th>QA End</th>
                <th>Release</th>
                <th>Dependencies</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tasks.map(task => (
                <tr key={task.id}>
                  <td style={{maxWidth:280}}>
                    <div style={{fontSize:12,lineHeight:1.4}}>{task.task}</div>
                    {task.epic && task.epic !== 'None' && <div style={{fontSize:11,color:'var(--text3)',marginTop:2}}>{task.epic}</div>}
                  </td>
                  <td><JiraLink ticket={task.jira}/></td>
                  <td style={{fontSize:12,color:'var(--text2)'}}>{task.component||'—'}</td>
                  <td style={{fontSize:12}}>{task.devOwner||task.owner||'—'}</td>
                  <td>{statusBadge(task.planningState)}</td>
                  <td style={{fontSize:11,color:'var(--text3)',maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{task.sprintDev||'—'}</td>
                  <td style={{fontSize:12,color:'var(--text2)'}}>{task.devStartDate||'—'}</td>
                  <td style={{fontSize:12,color:'var(--text2)'}}>{task.devEndDate||'—'}</td>
                  <td style={{fontSize:12,color:'var(--text2)'}}>{task.qaStartDate||'—'}</td>
                  <td style={{fontSize:12,color:'var(--text2)'}}>{task.qaEndDate||'—'}</td>
                  <td style={{fontSize:12,color:'var(--text2)'}}>{task.estimatedReleaseDate||'—'}</td>
                  <td><div className="note-cell" style={{maxWidth:160}}>{task.dependencies||'—'}</div></td>
                  <td style={{whiteSpace:'nowrap'}}>
                    <button className="btn-icon" onClick={()=>{setEditing(task);setShowModal(true)}}><Pencil size={13}/></button>
                    <button className="btn-icon" onClick={()=>deleteTask(task.id)}><Trash2 size={13}/></button>
                  </td>
                </tr>
              ))}
              {tasks.length === 0 && (
                <tr><td colSpan={13} className="empty"><p>No tasks in this sheet. Add one above.</p></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {showModal && (
        <Modal title={editing ? 'Edit Task' : 'Add Task'} onClose={()=>{setShowModal(false);setEditing(null)}} large>
          <TaskForm task={editing} sheetName={activeSheet} onSave={saveTask} onClose={()=>{setShowModal(false);setEditing(null)}} jiraCfg={jiraCfg}/>
        </Modal>
      )}
    </>
  )
}

// ─── Milestones Page ────────────────────────────────────────────────────
function MilestoneForm({ m, onSave, onClose, groups }) {
  const blank = { group: groups[0]||'', milestone:'', detail:'', owner:'', notes:'' }
  const [f, setF] = useState(m || blank)
  const set = k => e => setF(p => ({...p, [k]: e.target.value}))
  return (
    <>
      <div className="form-grid cols-1">
        <div className="form-group">
          <label>Milestone Group</label>
          <select value={f.group||''} onChange={set('group')}>
            {groups.map(g=><option key={g}>{g}</option>)}
            <option value="__new__">+ New Group...</option>
          </select>
          {f.group === '__new__' && <input type="text" placeholder="Group name e.g. July 30 Milestones" onChange={e=>setF(p=>({...p,group:e.target.value}))} style={{marginTop:6}} />}
        </div>
        <div className="form-group"><label>Milestone *</label><input type="text" value={f.milestone} onChange={set('milestone')} /></div>
        <div className="form-group"><label>Detail</label><textarea value={f.detail||''} onChange={set('detail')} /></div>
        <div className="form-group"><label>Owner</label><input type="text" value={f.owner||''} onChange={set('owner')} /></div>
        <div className="form-group"><label>Notes</label><textarea value={f.notes||''} onChange={set('notes')} /></div>
      </div>
      <div className="form-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={()=>onSave({...f, id: m?.id||Date.now()})}>Save Milestone</button>
      </div>
    </>
  )
}

function MilestonesPage({ data, setData }) {
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [collapsed, setCollapsed] = useState({})

  const milestones = data.milestones
  const groups = [...new Set(milestones.map(m=>m.group).filter(Boolean))]

  const saveMilestone = m => {
    setData(d => ({
      ...d,
      milestones: editing ? d.milestones.map(x=>x.id===m.id?m:x) : [...d.milestones, m]
    }))
    setShowModal(false); setEditing(null)
  }
  const deleteMilestone = id => {
    if (!confirm('Delete this milestone?')) return
    setData(d => ({ ...d, milestones: d.milestones.filter(m=>m.id!==id) }))
  }

  return (
    <>
      <div className="topbar">
        <h2>Milestones</h2>
        <button className="btn btn-primary btn-sm" onClick={()=>{setEditing(null);setShowModal(true)}}><Plus size={14}/>Add Milestone</button>
      </div>
      <div className="content">
        {groups.map(group => {
          const items = milestones.filter(m=>m.group===group)
          const isOpen = !collapsed[group]
          return (
            <div key={group} className="milestone-group">
              <div className="mg-header" onClick={()=>setCollapsed(c=>({...c,[group]:isOpen}))}>
                {isOpen ? <ChevronDown size={16} color="var(--text3)"/> : <ChevronRight size={16} color="var(--text3)"/>}
                <h3>{group}</h3>
                <span className="count">{items.length} items</span>
              </div>
              {isOpen && (
                <div className="table-wrap" style={{borderRadius:'0 0 var(--radius) var(--radius)'}}>
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th style={{minWidth:180}}>Milestone</th>
                        <th style={{minWidth:200}}>Detail</th>
                        <th>Owner</th>
                        <th style={{minWidth:200}}>Notes</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(m => (
                        <tr key={m.id}>
                          <td className="text-muted" style={{fontSize:12}}>{m.num}</td>
                          <td style={{fontWeight:500,fontSize:13}}>{m.milestone}</td>
                          <td style={{fontSize:12,color:'var(--text2)',maxWidth:260}}><div style={{overflow:'hidden',display:'-webkit-box',WebkitLineClamp:3,WebkitBoxOrient:'vertical'}}>{m.detail||'—'}</div></td>
                          <td style={{fontSize:12}}>{m.owner||'—'}</td>
                          <td><div className="note-cell" style={{maxWidth:240,whiteSpace:'normal',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden'}}>{m.notes||'—'}</div></td>
                          <td style={{whiteSpace:'nowrap'}}>
                            <button className="btn-icon" onClick={()=>{setEditing(m);setShowModal(true)}}><Pencil size={13}/></button>
                            <button className="btn-icon" onClick={()=>deleteMilestone(m.id)}><Trash2 size={13}/></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
        {milestones.length === 0 && <div className="empty"><p>No milestones yet.</p></div>}
      </div>
      {showModal && (
        <Modal title={editing ? 'Edit Milestone' : 'Add Milestone'} onClose={()=>{setShowModal(false);setEditing(null)}}>
          <MilestoneForm m={editing} onSave={saveMilestone} onClose={()=>{setShowModal(false);setEditing(null)}} groups={groups} />
        </Modal>
      )}
    </>
  )
}

// ─── Risks Page ────────────────────────────────────────────────────────
const RISK_STATUSES = ['Open','Planning','Closed']
const CATEGORIES = ['Attribution','Observability','Infrastructure','Product Enhancement','Production issues']
const IMPACTS = ['High','Medium','Low']
const PRIORITIES = ['P1','P2','P3']
const ACTIONS = ['Create Epic','Create Story','Create Task','Monitor']

function RiskForm({ risk, onSave, onClose }) {
  const blank = { problem:'', category:'', businessImpact:'High', priority:'P1', recommendedAction:'', owner:'', targetResolution:'', status:'Open', notes:'' }
  const [f, setF] = useState(risk || blank)
  const set = k => e => setF(p => ({...p, [k]: e.target.value}))
  return (
    <>
      <div className="form-grid">
        <div className="form-group span-2"><label>Problem / Opportunity *</label><textarea value={f.problem} onChange={set('problem')} /></div>
        <div className="form-group">
          <label>Category</label>
          <select value={f.category||''} onChange={set('category')}>
            <option value="">Select...</option>
            {CATEGORIES.map(c=><option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Business Impact</label>
          <select value={f.businessImpact||''} onChange={set('businessImpact')}>
            {IMPACTS.map(i=><option key={i}>{i}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Priority</label>
          <select value={f.priority||''} onChange={set('priority')}>
            {PRIORITIES.map(p=><option key={p}>{p}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Recommended Action</label>
          <select value={f.recommendedAction||''} onChange={set('recommendedAction')}>
            <option value="">Select...</option>
            {ACTIONS.map(a=><option key={a}>{a}</option>)}
          </select>
        </div>
        <div className="form-group"><label>Owner</label><input type="text" value={f.owner||''} onChange={set('owner')} /></div>
        <div className="form-group"><label>Target Resolution</label><input type="text" value={f.targetResolution||''} onChange={set('targetResolution')} placeholder="Q3 FY26 or date" /></div>
        <div className="form-group">
          <label>Status</label>
          <select value={f.status||''} onChange={set('status')}>
            {RISK_STATUSES.map(s=><option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-group span-2"><label>Notes</label><textarea value={f.notes||''} onChange={set('notes')} /></div>
      </div>
      <div className="form-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={()=>onSave({...f, id:risk?.id||Date.now()})}>Save Risk</button>
      </div>
    </>
  )
}

function RisksPage({ data, setData }) {
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [filterStatus, setFilterStatus] = useState('All')
  const [filterPriority, setFilterPriority] = useState('All')

  const risks = data.risks
  const filtered = risks.filter(r => {
    if (filterStatus !== 'All' && r.status !== filterStatus) return false
    if (filterPriority !== 'All' && r.priority !== filterPriority) return false
    return true
  })

  const saveRisk = r => {
    setData(d => ({ ...d, risks: editing ? d.risks.map(x=>x.id===r.id?r:x) : [...d.risks, r] }))
    setShowModal(false); setEditing(null)
  }
  const deleteRisk = id => {
    if (!confirm('Delete risk?')) return
    setData(d => ({ ...d, risks: d.risks.filter(r=>r.id!==id) }))
  }

  const p1 = risks.filter(r=>r.priority==='P1').length
  const open = risks.filter(r=>r.status==='Open' || r.status==='Planning').length

  return (
    <>
      <div className="topbar">
        <h2>Risk Register</h2>
        <button className="btn btn-primary btn-sm" onClick={()=>{setEditing(null);setShowModal(true)}}><Plus size={14}/>Add Risk</button>
      </div>
      <div className="content">
        <div className="stats-grid" style={{marginBottom:20}}>
          <div className="stat-card"><div className="label">Total Risks</div><div className="value">{risks.length}</div></div>
          <div className="stat-card"><div className="label">P1 Critical</div><div className="value" style={{color:'#f87171'}}>{p1}</div></div>
          <div className="stat-card"><div className="label">Open / Planning</div><div className="value" style={{color:'#fbbf24'}}>{open}</div></div>
          <div className="stat-card"><div className="label">Closed</div><div className="value" style={{color:'#34d399'}}>{risks.filter(r=>r.status==='Closed').length}</div></div>
        </div>
        <div className="filters-bar">
          <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
            <option>All</option>
            {RISK_STATUSES.map(s=><option key={s}>{s}</option>)}
          </select>
          <select value={filterPriority} onChange={e=>setFilterPriority(e.target.value)}>
            <option>All</option>
            {PRIORITIES.map(p=><option key={p}>{p}</option>)}
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th style={{minWidth:220}}>Problem / Opportunity</th>
                <th>Category</th>
                <th>Impact</th>
                <th>Priority</th>
                <th>Action</th>
                <th>Owner</th>
                <th>Target</th>
                <th>Status</th>
                <th style={{minWidth:180}}>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id}>
                  <td className="text-muted" style={{fontSize:12}}>{r.num}</td>
                  <td style={{fontWeight:500,maxWidth:260}}><div style={{overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>{r.problem}</div></td>
                  <td style={{fontSize:12,color:'var(--text2)'}}>{r.category||'—'}</td>
                  <td>{r.businessImpact ? <span className={`badge ${IMPACT_CLASS[r.businessImpact]||'badge-gray'}`}>{r.businessImpact}</span> : '—'}</td>
                  <td>{r.priority ? <span className={`badge ${PRIORITY_CLASS[r.priority]||'badge-gray'}`}>{r.priority}</span> : '—'}</td>
                  <td style={{fontSize:12,color:'var(--text2)'}}>{r.recommendedAction||'—'}</td>
                  <td style={{fontSize:12}}>{r.owner||'—'}</td>
                  <td style={{fontSize:12,color:'var(--text2)'}}>{r.targetResolution||'—'}</td>
                  <td>{r.status ? <span className={`badge ${RISK_STATUS_CLASS[r.status]||'badge-gray'}`}>{r.status}</span> : '—'}</td>
                  <td><div className="note-cell" style={{maxWidth:200}}>{r.notes||'—'}</div></td>
                  <td style={{whiteSpace:'nowrap'}}>
                    <button className="btn-icon" onClick={()=>{setEditing(r);setShowModal(true)}}><Pencil size={13}/></button>
                    <button className="btn-icon" onClick={()=>deleteRisk(r.id)}><Trash2 size={13}/></button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={11} className="empty"><p>No risks found.</p></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {showModal && (
        <Modal title={editing ? 'Edit Risk' : 'Add Risk'} onClose={()=>{setShowModal(false);setEditing(null)}}>
          <RiskForm risk={editing} onSave={saveRisk} onClose={()=>{setShowModal(false);setEditing(null)}} />
        </Modal>
      )}
    </>
  )
}

// ─── App Root ───────────────────────────────────────────────────────────
export default function App() {
  const [data, setData] = useData()
  const [jiraCfg, saveJiraCfg, clearJiraCfg] = useJiraConfig()
  const [page, setPage] = useState('epics')
  const [selectedEpic, setSelectedEpic] = useState(null)

  const nav = (p) => { setPage(p); setSelectedEpic(null) }

  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'})
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = 'ptw-data.json'; a.click()
  }
  const importData = () => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json'
    input.onchange = e => {
      const file = e.target.files[0]
      const reader = new FileReader()
      reader.onload = ev => { try { setData(JSON.parse(ev.target.result)); alert('Data imported!') } catch { alert('Invalid JSON file') } }
      reader.readAsText(file)
    }
    input.click()
  }
  const resetData = () => {
    if (confirm('Reset all data to original Excel import? This cannot be undone.')) {
      setData(initialData); localStorage.removeItem('ptw_data')
    }
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <h1>Plan the Work</h1>
          <p>Team APEX · {data.meta?.projectName||'Planning'}</p>
        </div>
        <div className="sidebar-section">
          <div className="sidebar-section-label">Planning</div>
          <div className={`nav-item ${(page==='epics'||page==='detail') ? 'active':''}`} onClick={()=>nav('epics')}>
            <LayoutDashboard size={15}/>Epics
            <span className="nav-badge">{data.epics.length}</span>
          </div>
          <div className={`nav-item ${page==='milestones'?'active':''}`} onClick={()=>nav('milestones')}>
            <ListChecks size={15}/>Milestones
            <span className="nav-badge">{data.milestones.length}</span>
          </div>
          <div className={`nav-item ${page==='risks'?'active':''}`} onClick={()=>nav('risks')}>
            <AlertTriangle size={15}/>Risks
            <span className="nav-badge">{data.risks.length}</span>
          </div>
        </div>
        <div className="sidebar-section">
          <div className="sidebar-section-label">Integrations</div>
          <div className={`nav-item ${page==='jira'?'active':''}`} onClick={()=>nav('jira')}>
            <Settings size={15}/>Jira
            {jiraCfg
              ? <span className="nav-badge" style={{background:'rgba(16,185,129,.2)',color:'#34d399'}}>●</span>
              : <span className="nav-badge">—</span>
            }
          </div>
        </div>
        <div className="sidebar-section" style={{marginTop:'auto',paddingTop:20}}>
          <div className="sidebar-section-label">Data</div>
          <div className="nav-item" onClick={exportData} style={{fontSize:12}}>Export JSON</div>
          <div className="nav-item" onClick={importData} style={{fontSize:12}}>Import JSON</div>
          <div className="nav-item" onClick={resetData} style={{fontSize:12,color:'var(--red)'}}>Reset to Original</div>
        </div>
      </aside>
      <main className="main">
        {page === 'epics' && !selectedEpic && (
          <EpicsPage data={data} setData={setData} jiraCfg={jiraCfg} onSelectEpic={e=>{setSelectedEpic(e);setPage('detail')}}/>
        )}
        {page === 'detail' && selectedEpic && (
          <EpicDetailPage epic={data.epics.find(e=>e.id===selectedEpic.id)||selectedEpic} data={data} setData={setData} jiraCfg={jiraCfg} onBack={()=>{setPage('epics');setSelectedEpic(null)}}/>
        )}
        {page === 'milestones' && <MilestonesPage data={data} setData={setData}/>}
        {page === 'risks' && <RisksPage data={data} setData={setData}/>}
        {page === 'jira' && <JiraSettingsPage jiraCfg={jiraCfg} saveJiraCfg={saveJiraCfg} clearJiraCfg={clearJiraCfg}/>}
      </main>
    </div>
  )
}
