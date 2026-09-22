const $ = s => document.querySelector(s);
let tabId = null;

function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function stateLabel(s){return String(s||'').replaceAll('_',' ').toLowerCase();}

async function api(message){const r=await chrome.runtime.sendMessage(message);if(r?.error)throw new Error(r.error);return r;}

function renderCandidate(c){
  return `<div class="card"><div class="title">${esc(c.title||c.label||c.kind.toUpperCase())}</div><div class="meta">${esc(c.kind.toUpperCase())} · ${esc(c.source)}<br>${esc(c.url)}</div><div class="actions"><button class="primary" data-download="${esc(c.id)}">Download</button></div></div>`;
}
function renderJob(j){
  const p=j.progress||{};const pct=p.total?Math.min(100,Math.round((p.bytes||0)*100/p.total)):0;
  const seg=p.segmentsTotal?` · ${p.segmentsDone||0}/${p.segmentsTotal} segments`:'';
  const retry=['RECOVERABLE','FAILED_RETRYABLE'].includes(j.state);
  const cancellable=['PLANNED','ACQUIRING','PROCESSING','FINALIZING'].includes(j.state);
  return `<div class="card"><div class="title">${esc(j.candidate?.title||j.candidate?.label||'Download')}</div><div class="state">${esc(stateLabel(j.state))}${seg}${j.error?` · ${esc(j.error)}`:''}</div>${p.total?`<div class="bar"><i style="width:${pct}%"></i></div>`:''}<div class="actions">${retry?`<button data-retry="${j.id}">Retry</button>`:''}${cancellable?`<button data-cancel="${j.id}">Cancel</button>`:''}</div></div>`;
}

async function refresh(){
  try{
    const state=await api({type:'popup:getState',tabId});
    const c=$('#candidates');c.classList.toggle('empty',!state.candidates.length);c.innerHTML=state.candidates.length?state.candidates.map(renderCandidate).join(''):'Nothing detected yet. Start video playback, then refresh.';
    const j=$('#jobs');j.classList.toggle('empty',!state.jobs.length);j.innerHTML=state.jobs.length?state.jobs.map(renderJob).join(''):'No jobs.';
    $('#status').textContent='';
  }catch(e){$('#status').textContent=e.message;}
}

document.addEventListener('click',async e=>{
  const btn=e.target.closest('button');if(!btn)return;
  try{
    if(btn.dataset.download){btn.disabled=true;await api({type:'popup:start',tabId,candidateId:btn.dataset.download});}
    if(btn.dataset.cancel)await api({type:'popup:cancel',jobId:btn.dataset.cancel});
    if(btn.dataset.retry)await api({type:'popup:retry',jobId:btn.dataset.retry});
    if(btn.id==='clear')await api({type:'popup:clear',tabId});
    await refresh();
  }catch(err){$('#status').textContent=err.message;}
});
$('#refresh').addEventListener('click',refresh);

const [tab]=await chrome.tabs.query({active:true,currentWindow:true});tabId=tab?.id;$('#version').textContent=`v${chrome.runtime.getManifest().version}`;await refresh();setInterval(refresh,1000);
