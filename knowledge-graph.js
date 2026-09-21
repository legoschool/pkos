(function(root){
  'use strict';
  const defaults={body:50,title:25,similar:15,tag:15,folder:10};
  const aliases={ai:'인공지능',인공지능:'인공지능',피드백:'피드백',feedback:'피드백'};
  const stop=new Set('그리고 그러나 그래서 합니다 있습니다 이것 저것 기록 제목 없음 자료 파일 내용'.split(' '));
  function terms(text,stem,synonyms){
    const out=new Map();
    (String(text||'').toLowerCase().replace(/<[^>]*>/g,' ').match(/[가-힣a-z]{2,}/g)||[]).forEach(w=>{w=stem(w);if(synonyms)w=aliases[w]||w;if(!stop.has(w)&&w.length>1)out.set(w,(out.get(w)||0)+1);});
    return out;
  }
  function analyze(records,options){
    const o=Object.assign({mode:'all',threshold:1,minWords:1,synonyms:true,weights:defaults},options);
    const selected=new Set(o.selected|| (o.mode==='all'?[...Object.keys(defaults),'direct']:[o.mode]));
    const docs=records.map(n=>({n,body:terms(o.text(n),o.stem,false),title:terms(n.title,o.stem,false),alias:terms(n.title+' '+o.text(n),o.stem,true),path:o.path(n),tags:new Set((n.tags||[]).map(t=>t.trim().toLowerCase()))}));
    const df=new Map();docs.forEach(d=>new Set([...d.body.keys(),...d.title.keys()]).forEach(w=>df.set(w,(df.get(w)||0)+1)));
    function vector(m){let norm=0;const v=new Map();m.forEach((count,w)=>{const value=(1+Math.log(count))*(1+Math.log((docs.length+1)/((df.get(w)||0)+1)));v.set(w,value);norm+=value*value;});return {v,norm:Math.sqrt(norm)};}
    function cosine(a,b){let dot=0;a.v.forEach((v,w)=>dot+=v*(b.v.get(w)||0));return a.norm&&b.norm?dot/a.norm/b.norm:0;}
    docs.forEach(d=>{d.bv=vector(d.body);d.tv=vector(d.title);});
    const edges=[],degree=new Map(records.map(n=>[n.id,new Set()]));
    for(let i=0;i<docs.length;i++)for(let j=i+1;j<docs.length;j++){
      const a=docs[i],b=docs[j],words=[...a.body.keys()].filter(w=>b.body.has(w));
      const tags=[...a.tags].filter(t=>b.tags.has(t));
      const same=a.path.length&&JSON.stringify(a.path)===JSON.stringify(b.path);
      const parent=a.path.length>1&&b.path.length>1&&JSON.stringify(a.path.slice(0,-1))===JSON.stringify(b.path.slice(0,-1));
      const name=a.path.length&&b.path.length&&a.path.at(-1)===b.path.at(-1);
      const direct=o.links(a.n.id,b.n.id)||[];
      const aliasWords=o.synonyms?[...new Set(Object.values(aliases))].filter(w=>a.alias.has(w)&&b.alias.has(w)):[];
      const folderKinds=o.folderKinds||['same','parent','name'];
      const folderScore=Math.max(same&&folderKinds.includes('same')?1:0,parent&&!same&&folderKinds.includes('parent')?.5:0,name&&!same&&folderKinds.includes('name')?.25:0);
      const components={body:words.length>=o.minWords?cosine(a.bv,b.bv):0,title:Math.max(cosine(a.tv,b.tv),cosine(a.tv,b.bv),cosine(b.tv,a.bv)),similar:aliasWords.length?1:0,tag:tags.length/(new Set([...a.tags,...b.tags]).size||1),folder:folderScore};
      let score=0;
      let sum=0;Object.keys(defaults).forEach(k=>{if(!selected.has(k))return;const w=Number(o.weights[k])||0;sum+=w;score+=w*components[k];});score=sum?100*score/sum:0;
      if(selected.has('direct')&&direct.length)score=100;
      if(score<=0||score<o.threshold)continue;
      const reasons=[];
      if(selected.has('direct')&&direct.length)reasons.push('직접 연결: '+direct.join(', '));
      if(selected.has('body')&&components.body)reasons.push('공통어 '+words.length+'개: '+words.slice(0,12).map(w=>w+' ('+a.body.get(w)+'회 / '+b.body.get(w)+'회)').join(', '));
      if(selected.has('title')&&components.title)reasons.push('제목 관련도 '+Math.round(components.title*100)+'/100');
      if(selected.has('similar')&&aliasWords.length)reasons.push('유사어 사전: '+aliasWords.join(', '));
      if(selected.has('tag')&&tags.length)reasons.push('공통 태그: '+tags.join(', '));
      if(selected.has('folder')&&folderScore)reasons.push('폴더: '+(same?'같은 경로':parent?'같은 상위 폴더':'이름만 같음'));
      edges.push({a:a.n.id,b:b.n.id,score:Math.round(score),components,reasons,words,direct:selected.has('direct')&&direct.length>0});
      degree.get(a.n.id).add(b.n.id);degree.get(b.n.id).add(a.n.id);
    }
    return {edges:edges.sort((a,b)=>b.score-a.score),degree:new Map([...degree].map(([id,set])=>[id,set.size]))};
  }
  function shape(degree){return degree>=10?10:degree>=6?8:degree>=3?6:0;}
  function matches(record,query,fields,text,path){const words=String(query).toLowerCase().trim().split(/\s+/).filter(Boolean);const values={title:record.title||'',body:text(record),folder:path(record).join(' / '),tag:(record.tags||[]).join(' ')};const hay=fields.map(k=>values[k]||'').join(' ').toLowerCase();return words.every(w=>hay.includes(w));}
  root.PKOSGraph={analyze,shape,defaults,matches};
})(typeof window==='undefined'?globalThis:window);
