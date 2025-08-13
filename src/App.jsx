import React, { useEffect, useMemo, useState } from 'react'

const TRAY_CAPACITY = 12
const BOX_SIZE = 70
const DEFROST_HOURS = 2
const MIN_PROVE_HOURS = 48
const WARN_HOURS = 84
const EXPIRE_HOURS = 120

const hoursBetween = (a, b) => (b - a) / (1000*60*60)
const fmt = (n) => new Intl.NumberFormat().format(Math.floor(n))

const now = () => Date.now()

export default function App(){
  const [batches, setBatches] = useState(()=>{
    const t = now()
    return [
      { id:'B-1001', qty:120, state:'READY', proveStart: t - 60*60*1000*60 },
      { id:'B-1002', qty:84,  state:'PROVING', proveStart: t - 60*60*1000*20 },
      { id:'B-1003', qty:48,  state:'DEFROSTING', defrostStart: t - 60*60*1000*1.2 },
      { id:'B-1004', qty:140, state:'FROZEN' },
    ]
  })
  const [forecastLunch, setForecastLunch] = useState(180)
  const [forecastDinner, setForecastDinner] = useState(220)
  const [safetyPct, setSafetyPct] = useState(10)
  const [minTrayBuffer, setMinTrayBuffer] = useState(2)
  const [tick, setTick] = useState(0)

  useEffect(()=>{
    const id = setInterval(()=> setTick(n=>n+1), 1000)
    return ()=> clearInterval(id)
  },[])

  useEffect(()=>{
    const t = now()
    setBatches(prev => prev.map(b=>{
      if (b.state === 'PROVING' || b.state === 'READY'){
        const h = b.proveStart ? hoursBetween(b.proveStart, t) : 0
        if (h >= EXPIRE_HOURS) return { ...b, state:'EXPIRED' }
        if (h >= MIN_PROVE_HOURS && b.state==='PROVING') return { ...b, state:'READY' }
      }
      return b
    }))
  },[tick])

  const traysReady = useMemo(()=> Math.floor(batches.filter(b=>b.state==='READY').reduce((s,b)=>s+b.qty,0) / TRAY_CAPACITY), [batches])
  const inboundReadyBy50h = useMemo(()=>{
    const t = now()
    const horizon = 50
    return Math.floor(
      batches.filter(b=>b.state==='PROVING')
        .filter(b=> (b.proveStart ? hoursBetween(b.proveStart,t) : 0) + horizon >= MIN_PROVE_HOURS)
        .reduce((s,b)=>s+b.qty,0) / TRAY_CAPACITY
    )
  },[batches, tick])

  const demandLunch = Math.ceil((forecastLunch*(1+safetyPct/100) + minTrayBuffer*TRAY_CAPACITY)/TRAY_CAPACITY)
  const demandDinner = Math.ceil((forecastDinner*(1+safetyPct/100) + minTrayBuffer*TRAY_CAPACITY)/TRAY_CAPACITY)
  const lunchShortfall = Math.max(0, demandLunch - traysReady - inboundReadyBy50h)
  const dinnerShortfall = Math.max(0, demandDinner - Math.max(0, traysReady - demandLunch) - inboundReadyBy50h)
  const totalTraysToStart = lunchShortfall + dinnerShortfall

  function pullFromFreezer(trays){
    if (trays<=0) return
    const balls = trays*TRAY_CAPACITY
    const t = now()
    setBatches(prev=>{
      const updated = [...prev]
      let remaining = balls
      for (let i=0;i<updated.length && remaining>0;i++){
        const b = updated[i]
        if (b.state !== 'FROZEN') continue
        const take = Math.min(remaining, b.qty)
        b.qty -= take
        updated[i] = { ...b }
        updated.push({ id: `B-${Math.random().toString(36).slice(2,7).toUpperCase()}`, qty: take, state:'DEFROSTING', defrostStart:t })
        remaining -= take
      }
      if (remaining>0){
        updated.push({ id:'B-NEWFZ', qty: Math.max(0, BOX_SIZE - remaining), state:'FROZEN' })
        updated.push({ id: `B-${Math.random().toString(36).slice(2,7).toUpperCase()}`, qty: remaining, state:'DEFROSTING', defrostStart:t })
      }
      return updated.filter(b=>b.qty>0)
    })
  }

  function moveDefrostToFridge(id){
    const t = now()
    setBatches(prev => prev.map(b=> b.id===id ? { ...b, state:'PROVING', proveStart:t } : b))
  }

  function consumeReady(trays){
    if (trays<=0) return
    const balls = trays*TRAY_CAPACITY
    setBatches(prev=>{
      const updated = [...prev]
      let remaining = balls
      for (let i=0;i<updated.length && remaining>0;i++){
        const b = updated[i]
        if (b.state !== 'READY') continue
        const take = Math.min(remaining, b.qty)
        b.qty -= take
        updated[i] = { ...b }
        remaining -= take
      }
      return updated.filter(b=>b.qty>0)
    })
  }

  const frozenQty = batches.filter(b=>b.state==='FROZEN').reduce((s,b)=>s+b.qty,0)
  const defrosting = batches.filter(b=>b.state==='DEFROSTING')
  const proving = batches.filter(b=>b.state==='PROVING')
  const ready = batches.filter(b=>b.state==='READY')
  const expired = batches.filter(b=>b.state==='EXPIRED')

  const bucket = (h)=> h<24?'0–24h': h<48?'24–48h': h<72?'48–72h': h<96?'72–96h':'96h+'

  const readyAgeBuckets = useMemo(()=>{
    const t = now()
    const map = {}
    ready.forEach(b=>{
      const h = b.proveStart ? hoursBetween(b.proveStart, t) : 0
      const key = bucket(h)
      map[key] = (map[key]||0) + b.qty
    })
    return map
  },[ready, tick])

  const ageBadge = (h)=> {
    if (h >= EXPIRE_HOURS) return <span className='pill expired'>Expired</span>
    if (h >= WARN_HOURS)   return <span className='pill old'>Old</span>
    if (h >= MIN_PROVE_HOURS) return <span className='pill ready'>Ready</span>
    return <span className='pill proving'>Proving</span>
  }

  const ageLabel = (h)=> h<1 ? `${Math.floor(h*60)}m` : `${Math.floor(h)}h`

  return (
    <div className="container">
      <h1>Dough Proving Manager – Prototype</h1>

      <div className="row">
        <div className="card">
          <div className="title">Ready now</div>
          <div className="big">{fmt(ready.reduce((s,b)=>s+b.qty,0))}</div>
          <div className="muted">balls • {fmt(traysReady)} trays</div>
        </div>
        <div className="card">
          <div className="title">Inbound by 50h</div>
          <div className="big">{fmt(inboundReadyBy50h*TRAY_CAPACITY)}</div>
          <div className="muted">balls • {fmt(inboundReadyBy50h)} trays</div>
        </div>
        <div className="card">
          <div className="title">Frozen stock</div>
          <div className="big">{fmt(frozenQty)}</div>
          <div className="muted">≈ {Math.ceil(frozenQty/BOX_SIZE)} boxes</div>
        </div>
        <div className="card">
          <div className="title">At risk</div>
          <div className="small">{expired.length} expired batches</div>
          <div className="small">{proving.filter(b=>{const h=b.proveStart?hoursBetween(b.proveStart,now()):0;return h>WARN_HOURS}).length} ageing fast</div>
        </div>
      </div>

      <div className="card section">
        <div className="title">Tomorrow plan (50h lead)</div>
        <div className="input-row">
          <div><div className="muted">Lunch forecast</div><input type="number" value={forecastLunch} onChange={e=>setForecastLunch(parseInt(e.target.value||'0'))}/></div>
          <div><div className="muted">Dinner forecast</div><input type="number" value={forecastDinner} onChange={e=>setForecastDinner(parseInt(e.target.value||'0'))}/></div>
          <div><div className="muted">Safety %</div><input type="number" value={safetyPct} onChange={e=>setSafetyPct(parseInt(e.target.value||'0'))}/></div>
          <div><div className="muted">Min tray buffer</div><input type="number" value={minTrayBuffer} onChange={e=>setMinTrayBuffer(parseInt(e.target.value||'0'))}/></div>
          <div><button disabled={totalTraysToStart===0} onClick={()=>pullFromFreezer(totalTraysToStart)}>Start {totalTraysToStart} trays now</button></div>
        </div>
        <div className="grid grid-2 section">
          <div className="card">
            <div className="title">Lunch</div>
            <div className="small">Demand: {demandLunch} trays • Shortfall: {lunchShortfall} trays</div>
          </div>
          <div className="card">
            <div className="title">Dinner</div>
            <div className="small">Demand: {demandDinner} trays • Shortfall: {dinnerShortfall} trays</div>
          </div>
        </div>
      </div>

      <div className="grid grid-2 section">
        <div className="card">
          <div className="title">Start List (Freezer → Defrost)</div>
          <div className="input-row" style={{gridTemplateColumns:'1fr auto'}}>
            <input id="traysToStart" type="number" placeholder="Trays to start" defaultValue={totalTraysToStart} />
            <button onClick={()=>{
              const n = parseInt(document.getElementById('traysToStart').value||'0')
              pullFromFreezer(n)
            }}>Start</button>
          </div>
          <div className="spacer"></div>
          {defrosting.length===0 && <div className='muted'>No batches defrosting.</div>}
          <div className="grid">
            {defrosting.map(b=>{
              const h = b.defrostStart ? hoursBetween(b.defrostStart, now()) : 0
              const done = h >= DEFROST_HOURS
              return (
                <div key={b.id} className='batch'>
                  <div><strong>Batch {b.id}</strong></div>
                  <div className='small'>{fmt(b.qty)} balls • ≈ {Math.ceil(b.qty/TRAY_CAPACITY)} trays</div>
                  <div className='muted small'>Defrosting for {h<1 ? Math.floor(h*60)+'m' : Math.floor(h)+'h'}</div>
                  <div className='spacer'></div>
                  <button disabled={!done} onClick={()=>moveDefrostToFridge(b.id)}>Move to fridge</button>
                  {!done && <div className='muted small'>Needs {h<DEFROST_HOURS ? (h<1?Math.ceil((DEFROST_HOURS-h)*60)+'m':Math.ceil(DEFROST_HOURS-h)+'h') : '0h'} more</div>}
                </div>
              )
            })}
          </div>
        </div>

        <div className="card">
          <div className="title">Consume ready trays</div>
          <div className="input-row" style={{gridTemplateColumns:'1fr auto'}}>
            <input id="consumeTrays" type="number" placeholder="Trays to consume" />
            <button onClick={()=>{
              const n = parseInt(document.getElementById('consumeTrays').value||'0')
              consumeReady(n)
            }}>Consume</button>
          </div>
          <div className="spacer"></div>
          <div className='grid'>
            <div className='small'>Frozen: <strong>{fmt(frozenQty)}</strong></div>
            <div className='small'>Defrosting: <strong>{fmt(defrosting.reduce((s,b)=>s+b.qty,0))}</strong></div>
            <div className='small'>Proving: <strong>{fmt(proving.reduce((s,b)=>s+b.qty,0))}</strong></div>
            <div className='small'>Ready: <strong>{fmt(ready.reduce((s,b)=>s+b.qty,0))}</strong></div>
            <div className='small'>Expired: <strong>{fmt(expired.reduce((s,b)=>s+b.qty,0))}</strong></div>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="title">Proving Board</div>
        <div className="columns-5">
          {['0–24h','24–48h','48–72h','72–96h','96h+'].map(col=> (
            <div className='card' key={col}>
              <div className='small' style={{fontWeight:700}}>{col}</div>
              <div className='grid' style={{marginTop:8}}>
                {proving.concat(ready).map(b=>{
                  const h = b.proveStart ? hoursBetween(b.proveStart, now()) : -1
                  if (h<0) return null
                  if ((col==='0–24h' && h<24) || (col==='24–48h' && h>=24 && h<48) || (col==='48–72h' && h>=48 && h<72) || (col==='72–96h' && h>=72 && h<96) || (col==='96h+' && h>=96)){
                    return (
                      <div className='batch' key={b.id}>
                        <div><strong>Batch {b.id}</strong></div>
                        <div className='small'>{fmt(b.qty)} balls • {ageLabel(h)}</div>
                        <div className='spacer'></div>
                        {ageBadge(h)}
                      </div>
                    )
                  }
                  return null
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className='footer'>Prototype only: data resets on refresh. Lead time = 2h defrost + 48h prove = 50h.</div>
    </div>
  )
}
